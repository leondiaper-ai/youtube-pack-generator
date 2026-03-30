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
 * POST /api/visualiser
 * Accepts multipart form data with:
 *   - artwork (image file)
 *   - audio (audio file)
 * Returns the generated mp4 as a binary stream.
 *
 * FFmpeg command: takes artwork, loops it for the duration of the audio,
 * applies a slow zoom (Ken Burns), and muxes the audio in.
 */
export async function POST(req: NextRequest) {
  const id = randomUUID().slice(0, 8);
  const artworkPath = join(TMP_DIR, `${id}-artwork.png`);
  const audioPath = join(TMP_DIR, `${id}-audio.mp3`);
  const outputPath = join(TMP_DIR, `${id}-visualiser.mp4`);

  try {
    // Ensure tmp dir exists
    if (!existsSync(TMP_DIR)) {
      await mkdir(TMP_DIR, { recursive: true });
    }

    const formData = await req.formData();
    const artwork = formData.get("artwork") as File | null;
    const audio = formData.get("audio") as File | null;

    if (!artwork || !audio) {
      return NextResponse.json(
        { error: "Both artwork and audio files are required." },
        { status: 400 }
      );
    }

    // Write uploaded files to disk
    await writeFile(artworkPath, Buffer.from(await artwork.arrayBuffer()));
    await writeFile(audioPath, Buffer.from(await audio.arrayBuffer()));

    // Get audio duration
    const { stdout: probeOut } = await exec("ffprobe", [
      "-v", "quiet",
      "-show_entries", "format=duration",
      "-of", "csv=p=0",
      audioPath,
    ]);
    const duration = parseFloat(probeOut.trim()) || 30;

    // Calculate zoom speed: zoom from 1.0 to 1.15 over the duration
    // zoompan filter: z increases each frame, d = total frames
    const fps = 24;
    const totalFrames = Math.ceil(duration * fps);

    // FFmpeg: loop image, apply slow zoom, mux audio, output mp4
    await exec(
      "ffmpeg",
      [
        "-y",
        "-loop", "1",
        "-i", artworkPath,
        "-i", audioPath,
        "-filter_complex",
        `[0:v]scale=1920:1080,zoompan=z='min(zoom+0.0003,1.15)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=1920x1080:fps=${fps}[v]`,
        "-map", "[v]",
        "-map", "1:a",
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "23",
        "-c:a", "aac",
        "-b:a", "192k",
        "-shortest",
        "-movflags", "+faststart",
        "-t", String(duration),
        outputPath,
      ],
      { timeout: 300_000 } // 5 min max
    );

    // Read output and return
    const videoBuffer = await readFile(outputPath);

    // Cleanup temp files (fire-and-forget)
    cleanup(artworkPath, audioPath, outputPath);

    return new NextResponse(videoBuffer, {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Disposition": `attachment; filename="visualiser.mp4"`,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Visualiser generation failed:", message);

    // Cleanup on error too
    cleanup(artworkPath, audioPath, outputPath);

    return NextResponse.json(
      { error: `Generation failed: ${message}` },
      { status: 500 }
    );
  }
}

function cleanup(...paths: string[]) {
  for (const p of paths) {
    unlink(p).catch(() => {});
  }
}
