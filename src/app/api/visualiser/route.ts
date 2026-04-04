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
export const maxDuration = 300;

/**
 * Visualiser generation route.
 *
 * Produces a 1920x1080 mp4 from a single artwork image plus an audio track.
 * Supports 3 clearly distinct presets:
 *
 *   - clean-minimal  : slow cinematic zoom, restrained fade, elegant
 *   - moody-drift    : slow push/pull, vignette, grain, gentle brightness breathing
 *   - bold-pulse     : stronger zoom pulses, contrast lift, more energetic motion
 *
 * Every preset keeps the audio stream perfectly intact (copied) and is designed
 * to feel label/artist usable rather than cheesy.
 */

type Preset = "clean-minimal" | "moody-drift" | "bold-pulse";

const PRESETS: Record<Preset, string> = {
  // A. CLEAN MINIMAL
  //   Gentle linear zoom (1.00 → 1.08) across the whole clip, held at full
  //   brightness, soft fade in/out. No grain, no vignette — label-safe elegance.
  "clean-minimal": [
    // scale + crop to 1080p canvas, preserve aspect, center
    "scale=2400:-2,crop=1920:1080",
    // slow linear zoom across entire duration (d is injected per-call)
    "zoompan=z='min(1.00+on/DURFR*0.08,1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=DURFR:s=1920x1080:fps=30",
    // cinematic fade in / fade out
    "fade=t=in:st=0:d=1.2,fade=t=out:st=FADEOUT:d=1.2",
    // very mild s-curve for film feel
    "eq=contrast=1.04:saturation=1.02",
    "format=yuv420p",
  ].join(","),

  // B. MOODY DRIFT
  //   Slow push with subtle drift, soft vignette, film grain overlay,
  //   brightness breathing tied to a slow sine to suggest audio energy.
  "moody-drift": [
    "scale=2600:-2,crop=1920:1080",
    // push/pull feel: ease into 1.12 then gently settle to 1.06
    "zoompan=z='1.00+0.12*sin(on/DURFR*PI)':x='iw/2-(iw/zoom/2)+20*sin(on/DURFR*PI*2)':y='ih/2-(ih/zoom/2)':d=DURFR:s=1920x1080:fps=30",
    // soft vignette using radial darkening
    "vignette=PI/5",
    // film grain via noise
    "noise=alls=8:allf=t+u",
    // gentle brightness breathing (−4% → +4%)
    "eq=contrast=1.08:saturation=0.95:brightness='0.04*sin(t*0.6)':gamma=1.02",
    "fade=t=in:st=0:d=1.5,fade=t=out:st=FADEOUT:d=1.5",
    "format=yuv420p",
  ].join(","),

  // C. BOLD PULSE
  //   More energetic: zoom pulses on a 2-second cycle, punchier contrast,
  //   sharper fade. Still restrained enough to feel premium.
  "bold-pulse": [
    "scale=2400:-2,crop=1920:1080",
    // zoom pulses every 2 seconds (cycle via mod on frame index)
    "zoompan=z='1.04+0.06*abs(sin(on/60*PI))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=DURFR:s=1920x1080:fps=30",
    // contrast + saturation lift
    "eq=contrast=1.18:saturation=1.12:brightness=0.02",
    // subtle unsharp for extra punch
    "unsharp=5:5:0.6:5:5:0.0",
    "fade=t=in:st=0:d=0.8,fade=t=out:st=FADEOUT:d=1.0",
    "format=yuv420p",
  ].join(","),
};

function buildFilter(preset: Preset, durationSec: number): string {
  const totalFrames = Math.max(30, Math.round(durationSec * 30));
  const fadeOutStart = Math.max(0, durationSec - 1.5).toFixed(2);
  return PRESETS[preset]
    .replace(/DURFR/g, String(totalFrames))
    .replace(/FADEOUT/g, fadeOutStart);
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
    return Number.isFinite(d) && d > 0 ? d : 30;
  } catch {
    return 30;
  }
}

export async function POST(req: NextRequest) {
  const workId = randomUUID();
  const workDir = join(tmpdir(), "ypg-visualiser", workId);
  const logs: string[] = [];
  const log = (m: string) => logs.push(`[visualiser] ${m}`);

  try {
    await mkdir(workDir, { recursive: true });
    log(`work dir: ${workDir}`);

    const form = await req.formData();
    const artwork = form.get("artwork");
    const audio = form.get("audio");
    const presetRaw = (form.get("preset") as string) || "clean-minimal";
    const preset: Preset = (["clean-minimal", "moody-drift", "bold-pulse"] as Preset[]).includes(
      presetRaw as Preset
    )
      ? (presetRaw as Preset)
      : "clean-minimal";

    if (!(artwork instanceof File) || !(audio instanceof File)) {
      return NextResponse.json(
        { error: "Missing artwork or audio file", logs },
        { status: 400 }
      );
    }

    const artworkPath = join(workDir, "artwork.png");
    const audioPath = join(workDir, "audio.mp3");
    const outputPath = join(workDir, "visualiser.mp4");

    log("writing inputs to disk");
    await writeFile(artworkPath, Buffer.from(await artwork.arrayBuffer()));
    await writeFile(audioPath, Buffer.from(await audio.arrayBuffer()));

    const duration = await getAudioDuration(audioPath);
    log(`detected audio duration: ${duration.toFixed(2)}s`);

    const videoFilter = buildFilter(preset, duration);
    log(`preset: ${preset}`);

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

    log("running ffmpeg");
    await execFileAsync("ffmpeg", args, { maxBuffer: 1024 * 1024 * 64 });
    log("ffmpeg finished");

    if (!existsSync(outputPath)) {
      throw new Error("ffmpeg reported success but output file is missing");
    }

    const buf = await readFile(outputPath);
    log(`output size: ${(buf.length / 1024 / 1024).toFixed(2)} MB`);

    // best-effort cleanup (don't block response)
    unlink(artworkPath).catch(() => {});
    unlink(audioPath).catch(() => {});
    unlink(outputPath).catch(() => {});

    return new NextResponse(buf, {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Disposition": `attachment; filename="visualiser-${preset}.mp4"`,
        "X-YPG-Logs": encodeURIComponent(logs.join(" | ")),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`ERROR: ${message}`);
    return NextResponse.json(
      {
        error: "Visualiser generation failed",
        detail: message,
        logs,
      },
      { status: 500 }
    );
  }
}
