"use client";

import { useState } from "react";
import {
  generateThumbnail,
  type StylePreset,
  type ThumbnailTextMode,
} from "@/lib/thumbnail";
import {
  generateMetadata,
  type MetadataOutput,
  type ArtistProfile,
} from "@/lib/metadata";

/* ─────────────────────────────────────────────────────────────
   Types — kept in sync with the server routes in
   src/app/api/{visualiser,lyric-video,shorts}/route.ts
   ───────────────────────────────────────────────────────────── */
type VisPreset = "clean-minimal" | "moody-drift" | "bold-pulse";
type LyricTransition = "fade" | "slide" | "cut";
type LyricLayout = "centered" | "lower-third";
type JobStatus = "idle" | "generating" | "done" | "error";

interface FormData {
  artistName: string;
  trackTitle: string;
  audioFile: File | null;
  lyrics: string;
  artworkFile: File | null;
  stylePreset: StylePreset;
  thumbnailTextMode: ThumbnailTextMode;
  visPreset: VisPreset;
  lyricTransition: LyricTransition;
  lyricLayout: LyricLayout;
  shortsLockup: boolean;
  genre: string;
  tone: string;
  spotifyUrl: string;
  appleUrl: string;
  instagramUrl: string;
}

interface ShortItem {
  index: number;
  hook: string;
  status: "ok" | "error";
  detail?: string;
  url?: string;
}

/* ─────────────────────────────────────────────────────────────
   Home
   ───────────────────────────────────────────────────────────── */
export default function Home() {
  const [form, setForm] = useState<FormData>({
    artistName: "",
    trackTitle: "",
    audioFile: null,
    lyrics: "",
    artworkFile: null,
    stylePreset: "Clean",
    thumbnailTextMode: "none",
    visPreset: "clean-minimal",
    lyricTransition: "fade",
    lyricLayout: "centered",
    shortsLockup: true,
    genre: "",
    tone: "",
    spotifyUrl: "",
    appleUrl: "",
    instagramUrl: "",
  });

  const [artworkPreview, setArtworkPreview] = useState<string | null>(null);

  // Generation states
  const [loading, setLoading] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<MetadataOutput | null>(null);

  const [visStatus, setVisStatus] = useState<JobStatus>("idle");
  const [visUrl, setVisUrl] = useState<string | null>(null);
  const [visError, setVisError] = useState<string | null>(null);
  const [visLogs, setVisLogs] = useState<string[]>([]);

  const [lyricStatus, setLyricStatus] = useState<JobStatus>("idle");
  const [lyricUrl, setLyricUrl] = useState<string | null>(null);
  const [lyricError, setLyricError] = useState<string | null>(null);
  const [lyricLogs, setLyricLogs] = useState<string[]>([]);

  const [shorts, setShorts] = useState<ShortItem[]>([]);
  const [shortsStatus, setShortsStatus] = useState<JobStatus>("idle");
  const [shortsError, setShortsError] = useState<string | null>(null);
  const [shortsLogs, setShortsLogs] = useState<string[]>([]);

  const [showProfile, setShowProfile] = useState(false);

  const update = <K extends keyof FormData>(field: K, value: FormData[K]) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleArtworkChange = (file: File | null) => {
    update("artworkFile", file);
    if (file && file.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = (e) => setArtworkPreview(e.target?.result as string);
      reader.readAsDataURL(file);
    } else {
      setArtworkPreview(null);
    }
  };

  const buildProfile = (): ArtistProfile | undefined => {
    if (!form.genre && !form.tone && !form.spotifyUrl) return undefined;
    return {
      name: form.artistName,
      genre: form.genre || "music",
      tone: form.tone || form.stylePreset.toLowerCase(),
      tags: form.genre ? [form.genre.toLowerCase()] : [],
      links: {
        spotify: form.spotifyUrl || undefined,
        apple: form.appleUrl || undefined,
        instagram: form.instagramUrl || undefined,
      },
    };
  };

  /* ── Main generate ───────────────────────────────────── */
  const handleGenerate = async () => {
    setLoading(true);
    setGenerated(false);
    setThumbnailUrl(null);
    setMetadata(null);
    setVisStatus("idle"); setVisUrl(null); setVisError(null); setVisLogs([]);
    setLyricStatus("idle"); setLyricUrl(null); setLyricError(null); setLyricLogs([]);
    setShorts([]); setShortsStatus("idle"); setShortsError(null); setShortsLogs([]);

    try {
      // 1. Thumbnail (instant, client-side)
      if (artworkPreview) {
        const thumb = await generateThumbnail({
          artworkDataUrl: artworkPreview,
          artistName: form.artistName,
          trackTitle: form.trackTitle,
          style: form.stylePreset,
          textMode: form.thumbnailTextMode,
        });
        setThumbnailUrl(thumb);
      }

      // 2. Metadata (instant, client-side)
      const meta = generateMetadata({
        artistName: form.artistName,
        trackTitle: form.trackTitle,
        style: form.stylePreset,
        lyrics: form.lyrics || undefined,
        profile: buildProfile(),
      });
      setMetadata(meta);
      setGenerated(true);
    } catch (err) {
      console.error("Generation error:", err);
    } finally {
      setLoading(false);
    }

    // 3. Kick off video generation in parallel
    const hasArtworkAndAudio = !!(form.artworkFile && form.audioFile);
    if (hasArtworkAndAudio) {
      handleVisualiser();
      if (form.lyrics.trim()) {
        handleLyricVideo();
      }
      handleShorts();
    }
  };

  /* ── Visualiser ──────────────────────────────────────── */
  const handleVisualiser = async () => {
    if (!form.artworkFile || !form.audioFile) return;
    setVisStatus("generating"); setVisError(null); setVisUrl(null); setVisLogs([]);
    try {
      const fd = new window.FormData();
      fd.append("artwork", form.artworkFile);
      fd.append("audio", form.audioFile);
      fd.append("preset", form.visPreset);
      const res = await fetch("/api/visualiser", { method: "POST", body: fd });
      // structured logs come via X-YPG-Logs header on success, or JSON body on error
      const headerLogs = res.headers.get("X-YPG-Logs");
      if (headerLogs) setVisLogs(decodeURIComponent(headerLogs).split(" | "));
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (Array.isArray(body.logs)) setVisLogs(body.logs);
        throw new Error(body.error || body.detail || `Error ${res.status}`);
      }
      setVisUrl(URL.createObjectURL(await res.blob()));
      setVisStatus("done");
    } catch (err) {
      setVisError(err instanceof Error ? err.message : "Unknown error");
      setVisStatus("error");
    }
  };

  /* ── Lyric Video ─────────────────────────────────────── */
  const handleLyricVideo = async () => {
    if (!form.artworkFile || !form.audioFile || !form.lyrics.trim()) return;
    setLyricStatus("generating"); setLyricError(null); setLyricUrl(null); setLyricLogs([]);
    try {
      const fd = new window.FormData();
      fd.append("artwork", form.artworkFile);
      fd.append("audio", form.audioFile);
      fd.append("lyrics", form.lyrics);
      fd.append("layout", form.lyricLayout);
      fd.append("transition", form.lyricTransition);
      const res = await fetch("/api/lyric-video", { method: "POST", body: fd });
      const headerLogs = res.headers.get("X-YPG-Logs");
      if (headerLogs) setLyricLogs(decodeURIComponent(headerLogs).split(" | "));
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (Array.isArray(body.logs)) setLyricLogs(body.logs);
        throw new Error(body.error || body.detail || `Error ${res.status}`);
      }
      setLyricUrl(URL.createObjectURL(await res.blob()));
      setLyricStatus("done");
    } catch (err) {
      setLyricError(err instanceof Error ? err.message : "Unknown error");
      setLyricStatus("error");
    }
  };

  /* ── Shorts (single API call, returns 3) ─────────────── */
  const handleShorts = async () => {
    if (!form.artworkFile || !form.audioFile) return;
    setShortsStatus("generating"); setShortsError(null); setShorts([]); setShortsLogs([]);
    try {
      const fd = new window.FormData();
      fd.append("artwork", form.artworkFile);
      fd.append("audio", form.audioFile);
      fd.append("lyrics", form.lyrics || "");
      fd.append("artist", form.artistName || "");
      fd.append("title", form.trackTitle || "");
      fd.append("showLockup", String(form.shortsLockup));
      const res = await fetch("/api/shorts", { method: "POST", body: fd });
      const body = await res.json().catch(() => ({}));
      if (Array.isArray(body.logs)) setShortsLogs(body.logs);
      if (!res.ok && !body.ok) {
        throw new Error(body.error || body.detail || `Error ${res.status}`);
      }
      const rawShorts: Array<{ index: number; hook: string; status: "ok" | "error"; detail?: string; data?: string }> = body.shorts || [];
      const items: ShortItem[] = rawShorts.map((s) => {
        if (s.status === "ok" && s.data) {
          const bin = Uint8Array.from(atob(s.data), (c) => c.charCodeAt(0));
          const blob = new Blob([bin], { type: "video/mp4" });
          return { index: s.index, hook: s.hook, status: "ok", url: URL.createObjectURL(blob) };
        }
        return { index: s.index, hook: s.hook, status: "error", detail: s.detail };
      });
      setShorts(items);
      // Partial-success: as long as at least one short rendered, mark "done".
      // ErrorBlocks still show for any that failed.
      const anyOk = items.some((s) => s.status === "ok");
      if (anyOk) {
        setShortsStatus("done");
      } else {
        throw new Error("All 3 shorts failed to render");
      }
    } catch (err) {
      setShortsError(err instanceof Error ? err.message : "Unknown error");
      setShortsStatus("error");
    }
  };

  /* ── Completeness ────────────────────────────────────── */
  const okShortsCount = shorts.filter((s) => s.status === "ok").length;
  const completeness = {
    thumbnail: !!thumbnailUrl,
    visualiser: visStatus === "done",
    lyricVideo: lyricStatus === "done",
    shorts: okShortsCount,
    metadata: !!metadata,
  };
  const totalDone = [
    completeness.thumbnail,
    completeness.visualiser,
    completeness.lyricVideo,
    completeness.shorts === 3,
    completeness.metadata,
  ].filter(Boolean).length;

  const inputClass =
    "w-full rounded-lg bg-gray-800 border border-gray-700 px-4 py-2.5 text-sm text-gray-100 placeholder-gray-500 focus:border-indigo-500 focus:outline-none transition";

  const hasMedia = !!(form.artworkFile && form.audioFile);

  return (
    <main className="max-w-3xl mx-auto px-4 py-12">
      {/* Header */}
      <header className="mb-10 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-white">
          YouTube Pack Generator
        </h1>
        <p className="mt-2 text-gray-400">
          Turn one track into a full YouTube asset pack
        </p>
      </header>

      {/* ── Input Section ── */}
      <section className="space-y-4 mb-8">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <InputField label="Artist Name" placeholder="e.g. Frank Ocean" value={form.artistName} onChange={(v) => update("artistName", v)} />
          <InputField label="Track Title" placeholder="e.g. Nights" value={form.trackTitle} onChange={(v) => update("trackTitle", v)} />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1.5">Audio File</label>
          <input type="file" accept="audio/*" className={inputClass + " file:mr-3 file:rounded file:border-0 file:bg-indigo-600 file:text-white file:px-3 file:py-1.5 file:text-xs"} onChange={(e) => update("audioFile", e.target.files?.[0] || null)} />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1.5">Lyrics</label>
          <textarea rows={5} placeholder="Paste lyrics here..." className={inputClass + " resize-none"} value={form.lyrics} onChange={(e) => update("lyrics", e.target.value)} />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1.5">Artwork (PNG/JPG)</label>
          <input type="file" accept="image/*" className={inputClass + " file:mr-3 file:rounded file:border-0 file:bg-indigo-600 file:text-white file:px-3 file:py-1.5 file:text-xs"} onChange={(e) => handleArtworkChange(e.target.files?.[0] || null)} />
        </div>

        {/* Preset selectors */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <SelectField
            label="Thumbnail Style"
            value={form.stylePreset}
            onChange={(v) => update("stylePreset", v as StylePreset)}
            options={[["Clean", "Clean"], ["Bold", "Bold"], ["Moody", "Moody"]]}
          />
          <SelectField
            label="Thumbnail Text"
            value={form.thumbnailTextMode}
            onChange={(v) => update("thumbnailTextMode", v as ThumbnailTextMode)}
            options={[
              ["none", "No Text"],
              ["title-only", "Title Only"],
              ["artist-title", "Artist + Title"],
            ]}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <SelectField
            label="Visualiser Preset"
            value={form.visPreset}
            onChange={(v) => update("visPreset", v as VisPreset)}
            options={[
              ["clean-minimal", "Clean Minimal"],
              ["moody-drift", "Moody Drift"],
              ["bold-pulse", "Bold Pulse"],
            ]}
          />
          <SelectField
            label="Shorts Lockup"
            value={form.shortsLockup ? "on" : "off"}
            onChange={(v) => update("shortsLockup", v === "on")}
            options={[
              ["on", "Show Artist + Title on first short"],
              ["off", "No lockup"],
            ]}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <SelectField
            label="Lyric Layout"
            value={form.lyricLayout}
            onChange={(v) => update("lyricLayout", v as LyricLayout)}
            options={[
              ["centered", "Centered"],
              ["lower-third", "Lower Third"],
            ]}
          />
          <SelectField
            label="Lyric Transition"
            value={form.lyricTransition}
            onChange={(v) => update("lyricTransition", v as LyricTransition)}
            options={[
              ["fade", "Fade"],
              ["slide", "Slide Up"],
              ["cut", "Cut"],
            ]}
          />
        </div>

        {/* Artist Profile (collapsible) */}
        <div>
          <button onClick={() => setShowProfile(!showProfile)} className="text-xs text-indigo-400 hover:text-indigo-300 transition">
            {showProfile ? "Hide" : "Show"} Artist Profile (optional)
          </button>
          {showProfile && (
            <div className="mt-3 space-y-3 rounded-lg bg-gray-800/50 border border-gray-700 p-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <InputField label="Genre" placeholder="e.g. R&B, Hip-Hop" value={form.genre} onChange={(v) => update("genre", v)} />
                <SelectField
                  label="Tone"
                  value={form.tone}
                  onChange={(v) => update("tone", v)}
                  options={[
                    ["", "Auto"],
                    ["chill", "Chill"],
                    ["energetic", "Energetic"],
                    ["moody", "Moody"],
                    ["uplifting", "Uplifting"],
                  ]}
                />
              </div>
              <InputField label="Spotify URL" placeholder="https://open.spotify.com/..." value={form.spotifyUrl} onChange={(v) => update("spotifyUrl", v)} />
              <InputField label="Apple Music URL" placeholder="https://music.apple.com/..." value={form.appleUrl} onChange={(v) => update("appleUrl", v)} />
              <InputField label="Instagram URL" placeholder="https://instagram.com/..." value={form.instagramUrl} onChange={(v) => update("instagramUrl", v)} />
            </div>
          )}
        </div>
      </section>

      {/* Generate Button */}
      <button onClick={handleGenerate} disabled={loading} className="w-full rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-3 transition">
        {loading ? <Spinner text="Generating..." /> : "Generate Full YouTube Pack"}
      </button>
      {hasMedia && (
        <p className="text-xs text-gray-500 text-center mt-2">
          Generates thumbnail, metadata, visualiser{form.lyrics.trim() ? ", lyric video" : ""}, and 3 shorts
        </p>
      )}

      {/* ── Output Section ── */}
      {generated && (
        <section className="mt-10 space-y-8">
          {/* Completeness */}
          <div className="rounded-lg bg-gray-800 border border-gray-700 p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-white">Pack Status</h2>
              <span className="text-xs text-gray-400">{totalDone}/5 complete</span>
            </div>
            <div className="flex gap-2 flex-wrap">
              <StatusBadge label="Thumbnail" done={completeness.thumbnail} />
              <StatusBadge label="Visualiser" done={completeness.visualiser} />
              <StatusBadge label="Lyric Video" done={completeness.lyricVideo} />
              <StatusBadge label={`Shorts ${completeness.shorts}/3`} done={completeness.shorts === 3} />
              <StatusBadge label="Metadata" done={completeness.metadata} />
            </div>
          </div>

          {/* Thumbnail */}
          <OutputSection title="Thumbnail">
            {thumbnailUrl ? (
              <div className="space-y-2">
                <img src={thumbnailUrl} alt="Thumbnail" className="rounded-lg border border-gray-700 w-full max-w-lg" />
                <DownloadBtn href={thumbnailUrl} filename={`${form.artistName}-${form.trackTitle}-thumbnail.png`} label="Download PNG" />
              </div>
            ) : (
              <Placeholder label="Upload artwork to generate thumbnail" />
            )}
          </OutputSection>

          {/* Visualiser */}
          <OutputSection title="Visualiser">
            <VideoJobOutput
              status={visStatus}
              url={visUrl}
              error={visError}
              logs={visLogs}
              filename={`${form.artistName}-${form.trackTitle}-visualiser.mp4`}
              onGenerate={handleVisualiser}
              onRetry={handleVisualiser}
              canGenerate={hasMedia}
              generateLabel="Generate Visualiser"
              loadingLabel="Rendering visualiser..."
              disabledLabel="Upload artwork + audio to enable"
            />
          </OutputSection>

          {/* Lyric Video */}
          <OutputSection title="Lyric Video">
            <VideoJobOutput
              status={lyricStatus}
              url={lyricUrl}
              error={lyricError}
              logs={lyricLogs}
              filename={`${form.artistName}-${form.trackTitle}-lyric-video.mp4`}
              onGenerate={handleLyricVideo}
              onRetry={handleLyricVideo}
              canGenerate={hasMedia && !!form.lyrics.trim()}
              generateLabel="Generate Lyric Video"
              loadingLabel="Rendering lyric video..."
              disabledLabel="Upload artwork + audio + paste lyrics to enable"
            />
          </OutputSection>

          {/* Shorts */}
          <OutputSection title="Shorts">
            <ShortsOutput
              status={shortsStatus}
              shorts={shorts}
              error={shortsError}
              logs={shortsLogs}
              onRetry={handleShorts}
              hasMedia={hasMedia}
              artistName={form.artistName}
            />
          </OutputSection>

          {/* Metadata Copy */}
          {metadata && (
            <>
              <OutputSection title="Visualiser Copy">
                <CopyOptions data={metadata.visualiser} />
              </OutputSection>
              <OutputSection title="Lyric Video Copy">
                <CopyOptions data={metadata.lyricVideo} />
              </OutputSection>
              <OutputSection title="Shorts Copy">
                <CopyOptions data={metadata.shorts} />
              </OutputSection>
              <OutputSection title="Extras">
                <CopyBlock label="Pinned Comment" text={metadata.pinnedComment} />
                <CopyBlock label="Community Post" text={metadata.communityPost} />
              </OutputSection>
            </>
          )}
        </section>
      )}
    </main>
  );
}

/* ─────────────────────────────────────────────────────────────
   Helper Components
   ───────────────────────────────────────────────────────────── */

function InputField({ label, placeholder, value, onChange }: { label: string; placeholder: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-400 mb-1.5">{label}</label>
      <input type="text" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-lg bg-gray-800 border border-gray-700 px-4 py-2.5 text-sm text-gray-100 placeholder-gray-500 focus:border-indigo-500 focus:outline-none transition" />
    </div>
  );
}

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-400 mb-1.5">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-lg bg-gray-800 border border-gray-700 px-4 py-2.5 text-sm text-gray-100 focus:border-indigo-500 focus:outline-none transition">
        {options.map(([val, lbl]) => <option key={val} value={val}>{lbl}</option>)}
      </select>
    </div>
  );
}

function OutputSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-medium text-gray-400 mb-2">{title}</h3>
      {children}
    </div>
  );
}

function StatusBadge({ label, done }: { label: string; done: boolean }) {
  return (
    <span className={`text-xs px-2.5 py-1 rounded-full border ${done ? "border-green-700 bg-green-900/30 text-green-300" : "border-gray-700 bg-gray-800 text-gray-400"}`}>
      {done ? "✓" : "○"} {label}
    </span>
  );
}

function Spinner({ text }: { text: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-gray-300">
      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      {text}
    </span>
  );
}

function Placeholder({ label }: { label: string }) {
  return (
    <div className="aspect-video max-w-lg rounded-lg bg-gray-800 border border-gray-700 flex items-center justify-center">
      <span className="text-xs text-gray-500">{label}</span>
    </div>
  );
}

function DownloadBtn({ href, filename, label }: { href: string; filename: string; label: string }) {
  return (
    <a href={href} download={filename} className="inline-block text-xs bg-gray-800 hover:bg-gray-700 text-indigo-400 border border-gray-700 px-3 py-1.5 rounded transition">
      {label}
    </a>
  );
}

function ErrorBlock({ message, logs, onRetry }: { message: string | null; logs?: string[]; onRetry: () => void }) {
  const [showLogs, setShowLogs] = useState(false);
  return (
    <div className="space-y-2">
      <div className="rounded-lg bg-red-900/30 border border-red-800 p-3 text-xs text-red-300">
        {message || "Unknown error"}
      </div>
      {logs && logs.length > 0 && (
        <div>
          <button onClick={() => setShowLogs((v) => !v)} className="text-xs text-gray-400 hover:text-gray-300 transition">
            {showLogs ? "Hide logs" : "Show logs"}
          </button>
          {showLogs && (
            <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-gray-900 border border-gray-700 p-3 text-[10px] text-gray-400 whitespace-pre-wrap">
              {logs.join("\n")}
            </pre>
          )}
        </div>
      )}
      <button onClick={onRetry} className="text-xs bg-gray-800 hover:bg-gray-700 text-indigo-400 px-3 py-1.5 rounded border border-gray-700 transition">
        Retry
      </button>
    </div>
  );
}

interface VideoJobOutputProps {
  status: JobStatus;
  url: string | null;
  error: string | null;
  logs: string[];
  filename: string;
  onGenerate: () => void;
  onRetry: () => void;
  canGenerate: boolean;
  generateLabel: string;
  loadingLabel: string;
  disabledLabel: string;
}

function VideoJobOutput(props: VideoJobOutputProps) {
  if (props.status === "done" && props.url) {
    return (
      <div className="space-y-2">
        <video src={props.url} controls className="rounded-lg border border-gray-700 w-full max-w-lg" />
        <DownloadBtn href={props.url} filename={props.filename} label="Download MP4" />
      </div>
    );
  }
  if (props.status === "generating") {
    return (
      <div className="aspect-video max-w-lg rounded-lg bg-gray-800 border border-gray-700 flex items-center justify-center">
        <Spinner text={props.loadingLabel} />
      </div>
    );
  }
  if (props.status === "error") {
    return <ErrorBlock message={props.error} logs={props.logs} onRetry={props.onRetry} />;
  }
  if (props.canGenerate) {
    return (
      <div className="space-y-2">
        <Placeholder label="Ready to generate" />
        <button onClick={props.onGenerate} className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded transition">
          {props.generateLabel}
        </button>
      </div>
    );
  }
  return <Placeholder label={props.disabledLabel} />;
}

function ShortsOutput({
  status,
  shorts,
  error,
  logs,
  onRetry,
  hasMedia,
  artistName,
}: {
  status: JobStatus;
  shorts: ShortItem[];
  error: string | null;
  logs: string[];
  onRetry: () => void;
  hasMedia: boolean;
  artistName: string;
}) {
  if (status === "generating") {
    return (
      <div className="rounded-lg bg-gray-800 border border-gray-700 p-8 flex items-center justify-center">
        <Spinner text="Rendering 3 shorts… this takes a moment" />
      </div>
    );
  }
  if (status === "error") {
    return <ErrorBlock message={error} logs={logs} onRetry={onRetry} />;
  }
  if (status === "done" && shorts.length > 0) {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {shorts.map((s) => (
            <div key={s.index} className="space-y-2">
              {s.status === "ok" && s.url ? (
                <>
                  <video src={s.url} controls className="rounded-lg border border-gray-700 w-full aspect-[9/16] object-cover" />
                  <p className="text-xs text-gray-300 font-medium">“{s.hook}”</p>
                  <DownloadBtn href={s.url} filename={`${artistName}-short-${s.index + 1}.mp4`} label="Download" />
                </>
              ) : (
                <div className="rounded-lg bg-red-900/20 border border-red-800 p-3 aspect-[9/16] flex items-center justify-center">
                  <span className="text-[10px] text-red-300 text-center">
                    Short {s.index + 1} failed
                    {s.detail ? `:\n${s.detail}` : ""}
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
        {logs.length > 0 && (
          <details className="text-xs text-gray-500">
            <summary className="cursor-pointer hover:text-gray-400">Show logs</summary>
            <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-gray-900 border border-gray-700 p-3 text-[10px] text-gray-400 whitespace-pre-wrap">
              {logs.join("\n")}
            </pre>
          </details>
        )}
      </div>
    );
  }
  if (hasMedia) {
    return (
      <div className="space-y-2">
        <Placeholder label="3 vertical shorts ready to generate" />
        <button onClick={onRetry} className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded transition">
          Generate Shorts
        </button>
      </div>
    );
  }
  return <Placeholder label="Upload artwork + audio to enable" />;
}

function CopyOptions({ data }: { data: { titles: string[]; shortDescription: string; fullDescription: string; hashtags: string; tags: string } }) {
  return (
    <div className="space-y-2">
      {data.titles.map((t, i) => (
        <CopyBlock key={i} label={`Title Option ${i + 1}`} text={t} />
      ))}
      <CopyBlock label="Short Description" text={data.shortDescription} />
      <CopyBlock label="Full Description" text={data.fullDescription} />
      <CopyBlock label="Hashtags" text={data.hashtags} />
      <CopyBlock label="Tags" text={data.tags} />
    </div>
  );
}

function CopyBlock({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div className="rounded-lg bg-gray-800 border border-gray-700 p-3">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-medium text-gray-400">{label}</span>
        <button onClick={copy} className="text-xs text-indigo-400 hover:text-indigo-300 transition">
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre className="text-xs text-gray-300 whitespace-pre-wrap font-sans leading-relaxed">{text}</pre>
    </div>
  );
}
