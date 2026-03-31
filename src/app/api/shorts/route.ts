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
 * Short types:
 * "hook"    — bold text overlay on artwork, 15s clip from audio
 * "loop"    — artwork loop with minimal text, 10s
 * "lyric"   — single lyric line animated, 12s
 */
type ShortType = "hook" | "loop" | "lyric";

function buildShortFilter(
  type: ShortType,
  text: string,
  artistName: string,
  fps: number,
  totalFrames: number
): string {
  // Escape FFmpeg drawtext special chars
  const safeText = text.replace(/'/g, "'\\''").replace(/:/g, "\\:").replace(/\\/g, "\\\\");
  const safeArtist = artistName.replace(/'/g, "'\\''").replace(/:/g, "\\:").replace(/\\/g, "\\\\");

  switch (type) {
    case "hook":
      // Zoom in, bold centered text with glow
      return [
        `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,`,
        `zoompan=z='min(zoom+0.0004,1.12)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=1080x1920:fps=${fps},`,
        `eq=saturation=1.1:contrast=1.15,`,
        // Dark overlay
        `drawbox=x=0:y=0:w=1080:h=1920:color=black@0.4:t=fill,`,
        // Main text
        `drawtext=text='${safeText}':fontsize=64:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2:`,
        `borderw=3:bordercolor=black@0.6,`,
        // Artist name bottom
        `drawtext=text='${safeArtist}':fontsize=32:fontcolor=white@0.7:x=(w-text_w)/2:y=h-120:`,
        `borderw=2:bordercolor=black@0.5`,
        `[v]`,
      ].join("");

    case "loop":
      // Slow drift, minimal text at bottom
      return [
        `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,`,
        `zoompan=z='1.0+0.04*abs(sin(on/${Math.max(Math.round(totalFrames / 3), 1)}*PI))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=1080:1920:fps=${fps},`,
        `eq=saturation=0.85:brightness=-0.02,`,
        `vignette=PI/4,`,
        `noise=alls=5:allf=t,`,
        // Subtle artist watermark
        `drawtext=text='${safeArtist}':fontsize=28:fontcolor=white@0.5:x=(w-text_w)/2:y=h-100:`,
        `borderw=1:bordercolor=black@0.3`,
        `[v]`,
      ].join("");

    case "lyric":
      // Lyric line centered with fade, artwork bg dimmed
      return [
        `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,`,
        `zoompan=z='min(zoom+0.0002,1.06)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=1080:1920:fps=${fps},`,
        `eq=saturation=0.7:brightness=-0.08,`,
        `drawbox=x=0:y=0:w=1080:h=1920:color=black@0.5:t=fill,`,
        // Lyric text with glow
        `drawtext=text='${safeText}':fontsize=52:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2:`,
        `borderw=4:bordercolor=black@0.5,`,
        // Artist credit
        `drawtext=text='${safeArtist}':fontsize=26:fontcolor=white@0.6:x=(w-text_w)/2:y=h-140:`,
        `borderw=1:bordercolor=black@0.3`,
        `[v]`,
      ].join("");
  }
}

/**
 * POST /api/shorts
 * Form fields: artwork, audio, type (hook|loop|lyric), text, artistName
 * Returns mp4 binary (9:16 vertical).
 */
export async function POST(req: NextRequest) {
  const id = randomUUID().slice(0, 8);
  const artworkPath = join(TMP_DIR, `${id}-artwork.png`);
  const audioPath = join(TMP_DIR, `${id}-audio.mp3`);
  const outputPath = join(TMP_DIR, `${id}-short.mp4`);

  try {
    if (!existsSync(TMP_DIR)) await mkdir(TMP_DIR, { recursive: true });

    const formData = await req.formData();
    const artwork = formData.get("artwork") as File | null;
    const audio = formData.get("audio") as File | null;
    const type = (formData.get("type") as ShortType) || "hook";
    const text = (formData.get("text") as string) || "";
    const artistName = (formData.get("artistName") as string) || "Artist";

    if (!artwork || !audio) {
      return NextResponse.json(
        { error: "Artwork and audio are required." },
        { status: 400 }
      );
    }

    await writeFile(artworkPath, Buffer.from(await artwork.arrayBuffer()));
    await writeFile(audioPath, Buffer.from(await audio.arrayBuffer()));

    // Short durations by type
    const durationMap: Record<ShortType, number> = { hook: 15, loop: 10, lyric: 12 };
    const duration = durationMap[type];
    const fps = 30;
    const totalFrames = duration * fps;

    // Get a random offset into the audio (avoid first/last 5s)
    const { stdout: probeOut } = await exec("ffprobe", [
      "-v", "quiet",
      "-show_entries", "format=duration",
      "-of", "csv=p=0",
      audioPath,
    ]);
    const audioDuration = parseFloat(probeOut.trim()) || 60;
    const maxStart = Math.max(0, audioDuration - duration - 5);
    // Start around 20-40% into the track for a good hook
    const audioStart = Math.min(Math.round(audioDuration * 0.25), maxStart);

    const filter = buildShortFilter(type, text, artistName, fps, totalFrames);

    await exec(
      "ffmpeg",
      [
        "-y",
        "-loop", "1",
        "-i", artworkPath,
        "-ss", String(audioStart),
        "-i", audioPath,
        "-filter_complex", filter,
        "-map", "[v]",
        "-map", "1:a",
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "23",
        "-c:a", "aac",
        "-b:a", "128k",
        "-shortest",
        "-t", String(duration),
        "-movflags", "+faststart",
        outputPath,
      ],
      { timeout: 120_000 }
    );

    const videoBuffer = await readFile(outputPath);
    cleanup(artworkPath, audioPath, outputPath);

    return new NextResponse(videoBuffer, {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Disposition": `attachment; filename="short-${type}.mp4"`,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`Short (${id}) generation failed:`, message);
    cleanup(artworkPath, audioPath, outputPath);
    return NextResponse.json({ error: `Generation failed: ${message}` }, { status: 500 });
  }
}

function cleanup(...paths: string[]) {
  for (const p of paths) unlink(p).catch(() => {});
}
