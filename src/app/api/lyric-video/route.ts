import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir, unlink, readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { randomUUID } from "crypto";
import { tmpdir } from "os";

const execFileAsync = promisify(execFile);

export const runtime = "nodejs";
export const maxDuration = 600;

/**
 * Lyric video generation.
 *
 * Turns an artwork + audio + lyrics into a watchable 1920x1080 mp4
 * with cleanly chunked, cleanly timed on-screen lyrics.
 *
 * Key improvements vs. previous version:
 *   - lyrics are intelligently chunked into 1-2 readable lines per card
 *   - each card is allocated a duration based on its share of total characters
 *     (rather than equal splits), so long lines stay readable and short
 *     interjections don't linger
 *   - timing is clamped to a readable range (min 1.8s, max 6.0s)
 *   - text is rendered via ASS subtitles (reliable, ffmpeg-native, good wrapping)
 *   - max line length enforced so nothing overflows safe margins
 *   - supports 2 layouts that actually differ: centered and lower-third
 *   - supports 3 transition styles that actually feel different: fade, slide, cut
 *   - text uses a shadow + semi-transparent box for readability over any artwork
 */

type Layout = "centered" | "lower-third";
type Transition = "fade" | "slide" | "cut";

const MAX_LINE_CHARS = 38; // hard safety wrap
const MIN_CARD_SECONDS = 1.8;
const MAX_CARD_SECONDS = 6.0;
const FADE_SECONDS = 0.35;

function sanitize(text: string): string {
  return text.replace(/\r/g, "").trim();
}

/** Split lyrics into lines, dropping empty rows and collapsing whitespace. */
function splitLines(lyrics: string): string[] {
  return sanitize(lyrics)
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 0);
}

/** Wrap a single line into up to two display rows, each <= MAX_LINE_CHARS. */
function wrapLine(line: string): string[] {
  if (line.length <= MAX_LINE_CHARS) return [line];
  const words = line.split(" ");
  const rows: string[] = [];
  let current = "";
  for (const w of words) {
    const candidate = current ? `${current} ${w}` : w;
    if (candidate.length > MAX_LINE_CHARS) {
      if (current) rows.push(current);
      current = w;
    } else {
      current = candidate;
    }
  }
  if (current) rows.push(current);
  // collapse to at most 2 rows by merging any extras into the last row
  if (rows.length > 2) {
    const head = rows.slice(0, 1);
    const tail = rows.slice(1).join(" ");
    return [head[0], tail];
  }
  return rows;
}

/**
 * Group raw lyric lines into display cards (1-2 rows each).
 * Short consecutive lines get merged together so we aren't flashing 3-word
 * fragments on screen.
 */
function groupIntoCards(rawLines: string[]): string[][] {
  const cards: string[][] = [];
  let buffer: string[] = [];
  let bufferLen = 0;

  const flush = () => {
    if (buffer.length > 0) {
      cards.push([...buffer]);
      buffer = [];
      bufferLen = 0;
    }
  };

  for (const line of rawLines) {
    const wrapped = wrapLine(line);
    // if a single wrapped line is already 2 rows, it becomes its own card
    if (wrapped.length === 2) {
      flush();
      cards.push(wrapped);
      continue;
    }
    const row = wrapped[0];
    // merge short lines into current buffer if they still fit visually
    if (buffer.length < 2 && bufferLen + row.length < MAX_LINE_CHARS * 2 - 4) {
      buffer.push(row);
      bufferLen += row.length + 1;
    } else {
      flush();
      buffer.push(row);
      bufferLen = row.length + 1;
    }
  }
  flush();
  return cards;
}

/**
 * Allocate a duration to each card proportional to its character count,
 * clamped to a readable range. The last card is extended to cover any tail.
 */
function allocateDurations(cards: string[][], totalSeconds: number): number[] {
  const weights = cards.map((c) => Math.max(4, c.join(" ").length));
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const rawDurations = weights.map((w) => (w / weightSum) * totalSeconds);
  // clamp each, then re-normalize the clamped result
  const clamped = rawDurations.map((d) =>
    Math.min(MAX_CARD_SECONDS, Math.max(MIN_CARD_SECONDS, d))
  );
  const clampedSum = clamped.reduce((a, b) => a + b, 0);
  const scale = totalSeconds / clampedSum;
  const scaled = clamped.map((d) => d * scale);
  // fixup rounding drift: push residual into last card
  const sum = scaled.reduce((a, b) => a + b, 0);
  if (scaled.length > 0) scaled[scaled.length - 1] += totalSeconds - sum;
  return scaled;
}

/** Convert seconds to ASS timestamp h:mm:ss.cs */
function assTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s - h * 3600 - m * 60;
  const whole = Math.floor(sec);
  const cs = Math.round((sec - whole) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(whole).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function buildAss(
  cards: string[][],
  durations: number[],
  layout: Layout,
  transition: Transition
): string {
  // 1920x1080 canvas. Use Roboto (good default across linux ffmpeg builds)
  const playResX = 1920;
  const playResY = 1080;

  // Layout-specific alignment + margins
  // ASS alignments (numpad): 2 = bottom center, 5 = middle center
  const alignment = layout === "lower-third" ? 2 : 5;
  const marginV = layout === "lower-third" ? 140 : 0;

  // Semi-transparent box behind text for readability (BorderStyle=3 = opaque box)
  const styleLine = [
    "Style: Lyric",
    "Roboto",
    "72", // size
    "&H00FFFFFF", // primary: white
    "&H000000FF", // secondary
    "&H00000000", // outline: black
    "&H80000000", // back color: 50% transparent black box
    "1", // bold
    "0",
    "0",
    "0",
    "100",
    "100",
    "0",
    "0",
    "3", // border style = opaque box
    "3", // outline width
    "4", // shadow depth
    String(alignment),
    "120",
    "120",
    String(marginV),
    "1",
  ].join(",");

  // Transition effects via \fad or \move
  let cursor = 0;
  const events: string[] = [];
  for (let i = 0; i < cards.length; i++) {
    const startT = cursor;
    const endT = cursor + durations[i];
    cursor = endT;

    const text = cards[i].join("\\N");
    let effect = "";
    if (transition === "fade") {
      const fadeMs = Math.round(FADE_SECONDS * 1000);
      effect = `{\\fad(${fadeMs},${fadeMs})}`;
    } else if (transition === "slide") {
      // slide up from 60px below final position over 0.4s
      const yEnd = layout === "lower-third" ? playResY - 200 : playResY / 2;
      const yStart = yEnd + 60;
      effect = `{\\move(${playResX / 2},${yStart},${playResX / 2},${yEnd},0,400)\\fad(250,250)}`;
    } else {
      effect = ""; // cut
    }

    events.push(
      `Dialogue: 0,${assTime(startT)},${assTime(endT)},Lyric,,0,0,0,,${effect}${text}`
    );
  }

  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${playResX}
PlayResY: ${playResY}
ScaledBorderAndShadow: yes
WrapStyle: 2

[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
${styleLine}

[Events]
Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
${events.join("\n")}
`;
}

async function getAudioDuration(audioPath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      audioPath,
    ]);
    const d = parseFloat(stdout.trim());
    return Number.isFinite(d) && d > 0 ? d : 60;
  } catch {
    return 60;
  }
}

export async function POST(req: NextRequest) {
  const workId = randomUUID();
  const workDir = join(tmpdir(), "ypg-lyric", workId);
  const logs: string[] = [];
  const log = (m: string) => logs.push(`[lyric-video] ${m}`);

  try {
    await mkdir(workDir, { recursive: true });
    log(`work dir: ${workDir}`);

    const form = await req.formData();
    const artwork = form.get("artwork");
    const audio = form.get("audio");
    const lyrics = (form.get("lyrics") as string) || "";
    const layoutRaw = (form.get("layout") as string) || "centered";
    const transitionRaw = (form.get("transition") as string) || "fade";
    const layout: Layout =
      layoutRaw === "lower-third" ? "lower-third" : "centered";
    const transition: Transition = ["fade", "slide", "cut"].includes(transitionRaw)
      ? (transitionRaw as Transition)
      : "fade";

    if (!(artwork instanceof File) || !(audio instanceof File)) {
      return NextResponse.json(
        { error: "Missing artwork or audio file", logs },
        { status: 400 }
      );
    }
    if (!lyrics.trim()) {
      return NextResponse.json(
        { error: "Lyrics are required for a lyric video", logs },
        { status: 400 }
      );
    }

    const artworkPath = join(workDir, "artwork.png");
    const audioPath = join(workDir, "audio.mp3");
    const subsPath = join(workDir, "subs.ass");
    const outputPath = join(workDir, "lyric-video.mp4");

    log("writing inputs to disk");
    await writeFile(artworkPath, Buffer.from(await artwork.arrayBuffer()));
    await writeFile(audioPath, Buffer.from(await audio.arrayBuffer()));

    const duration = await getAudioDuration(audioPath);
    log(`audio duration: ${duration.toFixed(2)}s`);

    const rawLines = splitLines(lyrics);
    if (rawLines.length === 0) {
      return NextResponse.json(
        { error: "No usable lyric lines found", logs },
        { status: 400 }
      );
    }
    log(`parsed ${rawLines.length} lyric lines`);

    const cards = groupIntoCards(rawLines);
    const durations = allocateDurations(cards, duration);
    log(`grouped into ${cards.length} cards, avg duration ${(duration / cards.length).toFixed(2)}s`);

    const ass = buildAss(cards, durations, layout, transition);
    await writeFile(subsPath, ass, "utf-8");
    log(`wrote ASS subtitle file (${ass.length} bytes)`);

    // escape subtitle path for ffmpeg filter
    const escapedSubs = subsPath.replace(/\\/g, "\\\\").replace(/:/g, "\\:");

    // Background: gentle slow push on the artwork so it doesn't feel static
    const videoFilter = [
      "scale=2400:-2,crop=1920:1080",
      `zoompan=z='min(1.00+on/${Math.round(duration * 30)}*0.06,1.06)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${Math.round(duration * 30)}:s=1920x1080:fps=30`,
      "eq=contrast=1.04:saturation=1.02:brightness=-0.02",
      `subtitles='${escapedSubs}'`,
      "format=yuv420p",
    ].join(",");

    const args = [
      "-y",
      "-loop",
      "1",
      "-i",
      artworkPath,
      "-i",
      audioPath,
      "-filter_complex",
      `[0:v]${videoFilter}[v]`,
      "-map",
      "[v]",
      "-map",
      "1:a",
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "20",
      "-pix_fmt",
      "yuv420p",
      "-r",
      "30",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-shortest",
      "-movflags",
      "+faststart",
      outputPath,
    ];

    log("running ffmpeg with subtitles filter");
    await execFileAsync("ffmpeg", args, { maxBuffer: 1024 * 1024 * 64 });
    log("ffmpeg finished");

    if (!existsSync(outputPath)) {
      throw new Error("ffmpeg reported success but output file is missing");
    }

    const buf = await readFile(outputPath);
    log(`output size: ${(buf.length / 1024 / 1024).toFixed(2)} MB`);

    unlink(artworkPath).catch(() => {});
    unlink(audioPath).catch(() => {});
    unlink(subsPath).catch(() => {});
    unlink(outputPath).catch(() => {});

    return new NextResponse(buf, {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Disposition": `attachment; filename="lyric-video-${layout}-${transition}.mp4"`,
        "X-YPG-Logs": encodeURIComponent(logs.join(" | ")),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`ERROR: ${message}`);
    return NextResponse.json(
      { error: "Lyric video generation failed", detail: message, logs },
      { status: 500 }
    );
  }
}
