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
 * Shorts generation.
 *
 * Simplified, reliable MVP approach:
 *   - Always produce 3 vertical 1080x1920 mp4s
 *   - Animated artwork background (slow push with subtle motion)
 *   - Pick 3 strong "hook" moments from the lyrics (caption text)
 *   - Each short is ~15 seconds and features a large readable caption
 *   - Optional artist + track lockup at the start of the clip
 *
 * This deliberately avoids AI scene selection or source-video editing.
 * It favours reliability and decent visual quality over complexity.
 */

const SHORT_SECONDS = 15;
const OUT_W = 1080;
const OUT_H = 1920;
const MAX_CAPTION_CHARS = 28;

type ShortResult = {
  index: number;
  hook: string;
  status: "ok" | "error";
  detail?: string;
  /** base64 mp4 payload when status === "ok" */
  data?: string;
};

function sanitize(text: string): string {
  return text.replace(/\r/g, "").trim();
}

function scoreLine(line: string): number {
  // Heuristic: prefer 4-10 word lines, punchy, no filler
  const words = line.split(/\s+/).filter(Boolean);
  if (words.length < 3 || words.length > 14) return 0;
  let score = 10;
  if (words.length >= 4 && words.length <= 9) score += 5;
  // reward hook-y punctuation
  if (/[!?]/.test(line)) score += 2;
  // reward short words (more chant-like)
  const avgWord = words.reduce((a, w) => a + w.length, 0) / words.length;
  if (avgWord <= 5) score += 2;
  // punish filler
  if (/^(yeah|oh|woah|ah|uh|hmm|la la)\b/i.test(line)) score -= 6;
  // punish all-caps shouting (often chorus labels)
  if (/^[A-Z\s]+$/.test(line) && line.length > 4) score -= 4;
  return score;
}

function pickHooks(lyrics: string, count: number): string[] {
  const lines = sanitize(lyrics)
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) return [];

  const scored = lines
    .map((line, i) => ({ line, i, score: scoreLine(line) }))
    .sort((a, b) => b.score - a.score);

  // take top N unique by text, preferring spread across the song
  const picked: string[] = [];
  const seen = new Set<string>();
  for (const s of scored) {
    if (picked.length >= count) break;
    const key = s.line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(s.line);
  }

  // fallback if not enough
  while (picked.length < count && lines.length > 0) {
    picked.push(lines[Math.min(lines.length - 1, picked.length)]);
  }
  return picked.slice(0, count);
}

function wrapCaption(text: string): string[] {
  if (text.length <= MAX_CAPTION_CHARS) return [text];
  const words = text.split(" ");
  const rows: string[] = [];
  let current = "";
  for (const w of words) {
    const candidate = current ? `${current} ${w}` : w;
    if (candidate.length > MAX_CAPTION_CHARS) {
      if (current) rows.push(current);
      current = w;
    } else {
      current = candidate;
    }
  }
  if (current) rows.push(current);
  // max 3 rows for caption
  if (rows.length > 3) {
    return [rows[0], rows[1], rows.slice(2).join(" ")];
  }
  return rows;
}

function assTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s - h * 3600 - m * 60;
  const whole = Math.floor(sec);
  const cs = Math.round((sec - whole) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(whole).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function buildShortAss(opts: {
  hook: string;
  artist: string;
  title: string;
  showLockup: boolean;
  duration: number;
}): string {
  const { hook, artist, title, showLockup, duration } = opts;

  const captionRows = wrapCaption(hook);
  const captionText = captionRows.join("\\N");

  // Styles:
  //  - Caption: big, center-bottom-ish, high contrast, box background
  //  - Lockup: smaller, top, for artist + title at start
  const captionStyle = [
    "Style: Caption",
    "Roboto",
    "96",
    "&H00FFFFFF",
    "&H000000FF",
    "&H00000000",
    "&H99000000",
    "1",
    "0",
    "0",
    "0",
    "100",
    "100",
    "0",
    "0",
    "3",
    "4",
    "4",
    "2",
    "80",
    "80",
    "260",
    "1",
  ].join(",");

  const lockupStyle = [
    "Style: Lockup",
    "Roboto",
    "54",
    "&H00FFFFFF",
    "&H000000FF",
    "&H00000000",
    "&H66000000",
    "1",
    "0",
    "0",
    "0",
    "100",
    "100",
    "0",
    "0",
    "3",
    "2",
    "2",
    "8",
    "80",
    "80",
    "140",
    "1",
  ].join(",");

  const events: string[] = [];

  // Caption: appears at 0.4s, stays until end, with fade in/out
  events.push(
    `Dialogue: 0,${assTime(0.4)},${assTime(duration - 0.3)},Caption,,0,0,0,,{\\fad(400,400)}${captionText}`
  );

  if (showLockup) {
    const lockText = `${artist}\\N${title}`;
    events.push(
      `Dialogue: 0,${assTime(0.2)},${assTime(3.2)},Lockup,,0,0,0,,{\\fad(300,400)}${lockText}`
    );
  }

  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${OUT_W}
PlayResY: ${OUT_H}
ScaledBorderAndShadow: yes
WrapStyle: 2

[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
${captionStyle}
${lockupStyle}

[Events]
Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
${events.join("\n")}
`;
}

/**
 * Build the video filter for a single short.
 * Variant parameter lets each of the 3 shorts feel slightly different
 * (different push direction, slight variation in intensity).
 */
function buildShortFilter(
  durationSec: number,
  variant: 0 | 1 | 2,
  subtitlePath: string
): string {
  const totalFrames = Math.round(durationSec * 30);

  // crop to vertical 9:16 first (from square/landscape artwork)
  // scale up so there's headroom for zoompan
  const base = `scale=1600:-2,crop=${OUT_W}:${OUT_H}`;

  // variant-specific motion
  let zoompan: string;
  if (variant === 0) {
    // gentle push in
    zoompan = `zoompan=z='min(1.00+on/${totalFrames}*0.12,1.12)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=${OUT_W}x${OUT_H}:fps=30`;
  } else if (variant === 1) {
    // slow pull out from 1.14 to 1.02
    zoompan = `zoompan=z='max(1.14-on/${totalFrames}*0.12,1.02)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=${OUT_W}x${OUT_H}:fps=30`;
  } else {
    // push with slight drift
    zoompan = `zoompan=z='1.04+0.06*sin(on/${totalFrames}*PI)':x='iw/2-(iw/zoom/2)+30*sin(on/${totalFrames}*PI*2)':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=${OUT_W}x${OUT_H}:fps=30`;
  }

  // eq: slightly richer look for shorts
  const eq = "eq=contrast=1.10:saturation=1.10:brightness=-0.02";

  // overlay subtitles
  const escapedSubs = subtitlePath.replace(/\\/g, "\\\\").replace(/:/g, "\\:");
  const subs = `subtitles='${escapedSubs}'`;

  const fade = `fade=t=in:st=0:d=0.4,fade=t=out:st=${(durationSec - 0.5).toFixed(2)}:d=0.5`;

  return [base, zoompan, eq, subs, fade, "format=yuv420p"].join(",");
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

/**
 * Pick a reasonable audio offset for each short so they don't all use
 * the first 15 seconds. Intro, middle, and last-third.
 */
function offsetFor(variant: 0 | 1 | 2, totalDuration: number): number {
  const safe = Math.max(0, totalDuration - SHORT_SECONDS - 1);
  if (safe <= 0) return 0;
  if (variant === 0) return Math.min(safe, 0); // start
  if (variant === 1) return Math.min(safe, safe * 0.45); // middle
  return safe; // near the end
}

export async function POST(req: NextRequest) {
  const workId = randomUUID();
  const workDir = join(tmpdir(), "ypg-shorts", workId);
  const logs: string[] = [];
  const log = (m: string) => logs.push(`[shorts] ${m}`);

  try {
    await mkdir(workDir, { recursive: true });
    log(`work dir: ${workDir}`);

    const form = await req.formData();
    const artwork = form.get("artwork");
    const audio = form.get("audio");
    const lyrics = (form.get("lyrics") as string) || "";
    const artist = sanitize((form.get("artist") as string) || "");
    const title = sanitize((form.get("title") as string) || "");
    const showLockup = (form.get("showLockup") as string) === "true";

    if (!(artwork instanceof File) || !(audio instanceof File)) {
      return NextResponse.json(
        { error: "Missing artwork or audio file", logs },
        { status: 400 }
      );
    }

    const artworkPath = join(workDir, "artwork.png");
    const audioPath = join(workDir, "audio.mp3");
    await writeFile(artworkPath, Buffer.from(await artwork.arrayBuffer()));
    await writeFile(audioPath, Buffer.from(await audio.arrayBuffer()));

    const totalDuration = await getAudioDuration(audioPath);
    log(`audio duration: ${totalDuration.toFixed(2)}s`);

    const hooks =
      pickHooks(lyrics, 3).length > 0
        ? pickHooks(lyrics, 3)
        : [title || "Out now", artist || "New single", "Listen now"];
    log(`picked hooks: ${hooks.join(" | ")}`);

    const results: ShortResult[] = [];

    for (let i = 0; i < 3; i++) {
      const variant = i as 0 | 1 | 2;
      const subsPath = join(workDir, `subs-${i}.ass`);
      const outPath = join(workDir, `short-${i}.mp4`);
      const offset = offsetFor(variant, totalDuration);
      const hook = hooks[i];

      try {
        const ass = buildShortAss({
          hook,
          artist,
          title,
          showLockup: showLockup && i === 0, // lockup only on first short
          duration: SHORT_SECONDS,
        });
        await writeFile(subsPath, ass, "utf-8");

        const filter = buildShortFilter(SHORT_SECONDS, variant, subsPath);

        const args = [
          "-y",
          "-loop",
          "1",
          "-i",
          artworkPath,
          "-ss",
          offset.toFixed(2),
          "-t",
          String(SHORT_SECONDS),
          "-i",
          audioPath,
          "-filter_complex",
          `[0:v]${filter}[v]`,
          "-map",
          "[v]",
          "-map",
          "1:a",
          "-t",
          String(SHORT_SECONDS),
          "-c:v",
          "libx264",
          "-preset",
          "medium",
          "-crf",
          "21",
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
          outPath,
        ];

        log(`rendering short ${i + 1}/3 (variant=${variant}, offset=${offset.toFixed(1)}s, hook="${hook}")`);
        await execFileAsync("ffmpeg", args, { maxBuffer: 1024 * 1024 * 64 });

        if (!existsSync(outPath)) {
          throw new Error("ffmpeg reported success but output file is missing");
        }

        const buf = await readFile(outPath);
        results.push({
          index: i,
          hook,
          status: "ok",
          data: buf.toString("base64"),
        });
        log(`short ${i + 1} OK (${(buf.length / 1024 / 1024).toFixed(2)} MB)`);

        unlink(outPath).catch(() => {});
        unlink(subsPath).catch(() => {});
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        log(`short ${i + 1} FAILED: ${detail}`);
        results.push({ index: i, hook, status: "error", detail });
      }
    }

    unlink(artworkPath).catch(() => {});
    unlink(audioPath).catch(() => {});

    const anyOk = results.some((r) => r.status === "ok");
    return NextResponse.json(
      {
        ok: anyOk,
        shorts: results,
        logs,
      },
      { status: anyOk ? 200 : 500 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`ERROR: ${message}`);
    return NextResponse.json(
      { error: "Shorts generation failed", detail: message, logs },
      { status: 500 }
    );
  }
}
