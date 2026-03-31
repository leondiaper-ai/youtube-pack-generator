import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir, unlink, readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { randomUUID } from "crypto";

const exec = promisify(execFile);
const TMP_DIR = join(process.cwd(), "tmp");

/**
 * Lyric animation styles — each becomes an ASS subtitle style + FFmpeg filter.
 *
 * "fade"      — each line fades in/out centered
 * "highlight" — all lines visible, current line highlighted
 * "reveal"    — word-by-word reveal (approximated per line)
 */
type LyricStyle = "fade" | "highlight" | "reveal";
type LyricLayout = "center" | "lower-third" | "fullscreen";

interface LyricLine {
  text: string;
  startMs: number;
  endMs: number;
}

function parseAndTimeLyrics(raw: string, durationSec: number): LyricLine[] {
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) return [];

  // Equal spacing with small gaps
  const totalMs = durationSec * 1000;
  const gap = 200; // 200ms gap between lines
  const lineTime = (totalMs - gap * lines.length) / lines.length;

  return lines.map((text, i) => ({
    text,
    startMs: Math.round(i * (lineTime + gap)),
    endMs: Math.round(i * (lineTime + gap) + lineTime),
  }));
}

function msToAss(ms: number): string {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const cs = Math.floor((ms % 1000) / 10);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function buildAssSubtitles(
  lines: LyricLine[],
  style: LyricStyle,
  layout: LyricLayout,
  textColor: string
): string {
  // ASS alignment: 2=bottom-center, 5=center, 8=top-center
  const alignment = layout === "lower-third" ? 2 : layout === "fullscreen" ? 5 : 5;
  const fontSize = layout === "fullscreen" ? 56 : layout === "lower-third" ? 42 : 48;
  const marginV = layout === "lower-third" ? 80 : layout === "fullscreen" ? 20 : 40;

  // Convert hex colour to ASS BGR format (e.g. #FFFFFF -> &HFFFFFF&)
  const assColor = `&H${textColor.replace("#", "").match(/.{2}/g)?.reverse().join("") || "FFFFFF"}&`;

  let header = `[Script Info]
Title: Lyric Video
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,${fontSize},${assColor},${assColor},&H40000000&,&H80000000&,0,0,0,0,100,100,2,0,1,3,2,${alignment},40,40,${marginV},1
Style: Dim,Arial,${fontSize},&H60AAAAAA&,&H60AAAAAA&,&H40000000&,&H80000000&,0,0,0,0,100,100,2,0,1,2,1,${alignment},40,40,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const events: string[] = [];

  if (style === "fade") {
    // Each line fades in over 300ms, holds, fades out over 300ms
    for (const line of lines) {
      const fadeIn = 300;
      const fadeOut = 300;
      events.push(
        `Dialogue: 0,${msToAss(line.startMs)},${msToAss(line.endMs)},Default,,0,0,0,,{\\fad(${fadeIn},${fadeOut})}${line.text}`
      );
    }
  } else if (style === "highlight") {
    // Show all lines dimmed, highlight current one
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Current line bright
      events.push(
        `Dialogue: 1,${msToAss(line.startMs)},${msToAss(line.endMs)},Default,,0,0,0,,{\\fad(200,200)}${line.text}`
      );
      // Show surrounding context lines dimmed
      const contextRange = 2;
      for (let j = Math.max(0, i - contextRange); j <= Math.min(lines.length - 1, i + contextRange); j++) {
        if (j === i) continue;
        const ctx = lines[j];
        const offsetY = (j - i) * (fontSize + 20);
        events.push(
          `Dialogue: 0,${msToAss(line.startMs)},${msToAss(line.endMs)},Dim,,0,0,0,,{\\pos(960,${540 + offsetY})\\fad(150,150)}${ctx.text}`
        );
      }
    }
  } else {
    // "reveal" — approximate word-by-word by splitting line duration across words
    for (const line of lines) {
      const words = line.text.split(/\s+/);
      const lineDur = line.endMs - line.startMs;
      const wordDur = lineDur / words.length;
      let builtText = "";
      for (let w = 0; w < words.length; w++) {
        builtText += (w > 0 ? " " : "") + words[w];
        const wStart = Math.round(line.startMs + w * wordDur);
        const wEnd = Math.round(line.startMs + (w + 1) * wordDur);
        events.push(
          `Dialogue: 0,${msToAss(wStart)},${msToAss(wEnd)},Default,,0,0,0,,{\\fad(100,0)}${builtText}`
        );
      }
    }
  }

  return header + events.join("\n") + "\n";
}

/**
 * POST /api/lyric-video
 * Form fields: artwork, audio, lyrics, style, layout, textColor
 */
export async function POST(req: NextRequest) {
  const id = randomUUID().slice(0, 8);
  const artworkPath = join(TMP_DIR, `${id}-artwork.png`);
  const audioPath = join(TMP_DIR, `${id}-audio.mp3`);
  const assPath = join(TMP_DIR, `${id}-lyrics.ass`);
  const outputPath = join(TMP_DIR, `${id}-lyricvideo.mp4`);

  try {
    if (!existsSync(TMP_DIR)) await mkdir(TMP_DIR, { recursive: true });

    const formData = await req.formData();
    const artwork = formData.get("artwork") as File | null;
    const audio = formData.get("audio") as File | null;
    const lyrics = (formData.get("lyrics") as string) || "";
    const style = (formData.get("style") as LyricStyle) || "fade";
    const layout = (formData.get("layout") as LyricLayout) || "center";
    const textColor = (formData.get("textColor") as string) || "#FFFFFF";

    if (!artwork || !audio || !lyrics.trim()) {
      return NextResponse.json(
        { error: "Artwork, audio, and lyrics are all required." },
        { status: 400 }
      );
    }

    await writeFile(artworkPath, Buffer.from(await artwork.arrayBuffer()));
    await writeFile(audioPath, Buffer.from(await audio.arrayBuffer()));

    // Probe duration
    const { stdout: probeOut } = await exec("ffprobe", [
      "-v", "quiet",
      "-show_entries", "format=duration",
      "-of", "csv=p=0",
      audioPath,
    ]);
    const duration = parseFloat(probeOut.trim()) || 60;

    // Build ASS subtitle file
    const timedLines = parseAndTimeLyrics(lyrics, duration);
    const assContent = buildAssSubtitles(timedLines, style, layout, textColor);
    await writeFile(assPath, assContent, "utf-8");

    const fps = 24;
    const totalFrames = Math.ceil(duration * fps);

    // FFmpeg: artwork background with slow zoom + subtitle overlay
    // Escape colons and backslashes in ASS path for FFmpeg on all platforms
    const escapedAssPath = assPath.replace(/\\/g, "/").replace(/:/g, "\\:");

    await exec(
      "ffmpeg",
      [
        "-y",
        "-loop", "1",
        "-i", artworkPath,
        "-i", audioPath,
        "-filter_complex",
        [
          `[0:v]scale=1920:1080,`,
          `zoompan=z='min(zoom+0.00008,1.04)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=1920x1080:fps=${fps},`,
          `eq=saturation=0.8:brightness=-0.05,`,
          `ass='${escapedAssPath}'`,
          `[v]`,
        ].join(""),
        "-map", "[v]",
        "-map", "1:a",
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "22",
        "-c:a", "aac",
        "-b:a", "192k",
        "-shortest",
        "-movflags", "+faststart",
        "-t", String(duration),
        outputPath,
      ],
      { timeout: 600_000 }
    );

    const videoBuffer = await readFile(outputPath);
    cleanup(artworkPath, audioPath, assPath, outputPath);

    return new NextResponse(videoBuffer, {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Disposition": `attachment; filename="lyric-video.mp4"`,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Lyric video generation failed:", message);
    cleanup(artworkPath, audioPath, assPath, outputPath);
    return NextResponse.json({ error: `Generation failed: ${message}` }, { status: 500 });
  }
}

function cleanup(...paths: string[]) {
  for (const p of paths) unlink(p).catch(() => {});
}
