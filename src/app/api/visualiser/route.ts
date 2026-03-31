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
 * Visualiser presets — each controls zoom, pan, colour grading, and texture.
 * All implemented as FFmpeg filter chains.
 */
type VisPreset = "moody-drift" | "pulse" | "parallax";

interface PresetConfig {
  /** zoompan filter expression for z (zoom level per frame) */
  zoom: string;
  /** zoompan x expression (pan horizontal) */
  panX: string;
  /** zoompan y expression (pan vertical) */
  panY: string;
  /** Extra video filters applied after zoompan (colour grade, grain, vignette) */
  postFilters: string;
}

function getPresetConfig(preset: VisPreset, totalFrames: number): PresetConfig {
  switch (preset) {
    case "moody-drift":
      return {
        // Slow zoom in + gentle drift right and down
        zoom: "min(zoom+0.00015,1.08)",
        panX: `iw/2-(iw/zoom/2)+${Math.round(totalFrames * 0.02)}*on/${totalFrames}`,
        panY: `ih/2-(ih/zoom/2)+${Math.round(totalFrames * 0.01)}*on/${totalFrames}`,
        // Desaturate slightly, add vignette, warm tint, film grain
        postFilters: [
          "eq=saturation=0.75:contrast=1.1:brightness=-0.03",
          "vignette=PI/4",
          "colorbalance=rs=0.05:gs=0.0:bs=-0.05:rm=0.03:gm=0.0:bm=-0.03",
          "noise=alls=6:allf=t",
        ].join(","),
      };

    case "pulse":
      return {
        // Breathing zoom: oscillates between 1.0 and 1.06 using sine wave
        zoom: `1.0+0.06*abs(sin(on/${Math.max(Math.round(totalFrames / 4), 1)}*PI))`,
        panX: "iw/2-(iw/zoom/2)",
        panY: "ih/2-(ih/zoom/2)",
        // High contrast, slight bloom via unsharp, vibrant
        postFilters: [
          "eq=saturation=1.15:contrast=1.15:brightness=0.02",
          "unsharp=3:3:1.5:3:3:0",
          "noise=alls=3:allf=t",
        ].join(","),
      };

    case "parallax":
      return {
        // Slow horizontal pan + gentle zoom for depth feel
        zoom: "min(zoom+0.0001,1.05)",
        panX: `iw/4+iw/2*on/${totalFrames}-(iw/zoom/2)`,
        panY: "ih/2-(ih/zoom/2)",
        // Cool tones, vignette, subtle blur edges, grain
        postFilters: [
          "eq=saturation=0.85:contrast=1.05",
          "vignette=PI/3.5",
          "colorbalance=rs=-0.03:gs=0.0:bs=0.06:rm=-0.02:gm=0.0:bm=0.04",
          "noise=alls=4:allf=t",
        ].join(","),
      };
  }
}

/**
 * POST /api/visualiser
 * Form fields: artwork, audio, preset (moody-drift | pulse | parallax)
 * Returns mp4 binary.
 */
export async function POST(req: NextRequest) {
  const id = randomUUID().slice(0, 8);
  const artworkPath = join(TMP_DIR, `${id}-artwork.png`);
  const audioPath = join(TMP_DIR, `${id}-audio.mp3`);
  const outputPath = join(TMP_DIR, `${id}-visualiser.mp4`);

  try {
    if (!existsSync(TMP_DIR)) await mkdir(TMP_DIR, { recursive: true });

    const formData = await req.formData();
    const artwork = formData.get("artwork") as File | null;
    const audio = formData.get("audio") as File | null;
    const preset = (formData.get("preset") as VisPreset) || "moody-drift";

    if (!artwork || !audio) {
      return NextResponse.json(
        { error: "Both artwork and audio files are required." },
        { status: 400 }
      );
    }

    await writeFile(artworkPath, Buffer.from(await artwork.arrayBuffer()));
    await writeFile(audioPath, Buffer.from(await audio.arrayBuffer()));

    // Probe audio duration
    const { stdout: probeOut } = await exec("ffprobe", [
      "-v", "quiet",
      "-show_entries", "format=duration",
      "-of", "csv=p=0",
      audioPath,
    ]);
    const duration = parseFloat(probeOut.trim()) || 30;
    const fps = 24;
    const totalFrames = Math.ceil(duration * fps);

    const cfg = getPresetConfig(preset, totalFrames);

    // Build filter chain
    const filterComplex = [
      `[0:v]scale=1920:1080,`,
      `zoompan=z='${cfg.zoom}'`,
      `:x='${cfg.panX}'`,
      `:y='${cfg.panY}'`,
      `:d=${totalFrames}:s=1920x1080:fps=${fps},`,
      cfg.postFilters,
      `[v]`,
    ].join("");

    await exec(
      "ffmpeg",
      [
        "-y",
        "-loop", "1",
        "-i", artworkPath,
        "-i", audioPath,
        "-filter_complex", filterComplex,
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
    cleanup(artworkPath, audioPath, outputPath);
    return NextResponse.json({ error: `Generation failed: ${message}` }, { status: 500 });
  }
}

function cleanup(...paths: string[]) {
  for (const p of paths) unlink(p).catch(() => {});
}
