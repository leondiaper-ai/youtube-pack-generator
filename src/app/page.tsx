"use client";

import { useState } from "react";
import { generateThumbnail } from "@/lib/thumbnail";
import { generateMetadata, type MetadataOutput, type ArtistProfile } from "@/lib/metadata";

type StylePreset = "Clean" | "Bold" | "Moody";
type VisPreset = "moody-drift" | "pulse" | "parallax";
type LyricStyle = "fade" | "highlight" | "reveal";
type LyricLayout = "center" | "lower-third" | "fullscreen";
type JobStatus = "idle" | "generating" | "done" | "error";

interface FormData {
  artistName: string;
  trackTitle: string;
  audioFile: File | null;
  lyrics: string;
  artworkFile: File | null;
  stylePreset: StylePreset;
  visPreset: VisPreset;
  lyricStyle: LyricStyle;
  lyricLayout: LyricLayout;
  genre: string;
  tone: string;
  spotifyUrl: string;
  appleUrl: string;
  instagramUrl: string;
}

interface ShortResult {
  url: string;
  type: "hook" | "loop" | "lyric";
  title: string;
  caption: string;
}

/* ───────────────────────────────────────────── */

export default function Home() {
  const [form, setForm] = useState<FormData>({
    artistName: "",
    trackTitle: "",
    audioFile: null,
    lyrics: "",
    artworkFile: null,
    stylePreset: "Clean",
    visPreset: "moody-drift",
    lyricStyle: "fade",
    lyricLayout: "center",
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

  const [lyricStatus, setLyricStatus] = useState<JobStatus>("idle");
  const [lyricUrl, setLyricUrl] = useState<string | null>(null);
  const [lyricError, setLyricError] = useState<string | null>(null);

  const [shorts, setShorts] = useState<ShortResult[]>([]);
  const [shortsStatus, setShortsStatus] = useState<JobStatus>("idle");
  const [shortsError, setShortsError] = useState<string | null>(null);

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

  /* ── Build artist profile from form ── */
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

  /* ── Main generate (thumbnail + metadata — instant) ── */
  const handleGenerate = async () => {
    setLoading(true);
    setGenerated(false);
    setThumbnailUrl(null);
    setMetadata(null);
    setVisStatus("idle"); setVisUrl(null); setVisError(null);
    setLyricStatus("idle"); setLyricUrl(null); setLyricError(null);
    setShorts([]); setShortsStatus("idle"); setShortsError(null);

    try {
      if (artworkPreview) {
        const thumb = await generateThumbnail({
          artworkDataUrl: artworkPreview,
          artistName: form.artistName,
          trackTitle: form.trackTitle,
          style: form.stylePreset,
        });
        setThumbnailUrl(thumb);
      }

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
  };

  /* ── Visualiser ── */
  const handleVisualiser = async () => {
    if (!form.artworkFile || !form.audioFile) return;
    setVisStatus("generating"); setVisError(null); setVisUrl(null);
    try {
      const fd = new window.FormData();
      fd.append("artwork", form.artworkFile);
      fd.append("audio", form.audioFile);
      fd.append("preset", form.visPreset);
      const res = await fetch("/api/visualiser", { method: "POST", body: fd });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Error ${res.status}`);
      setVisUrl(URL.createObjectURL(await res.blob()));
      setVisStatus("done");
    } catch (err) {
      setVisError(err instanceof Error ? err.message : "Unknown error");
      setVisStatus("error");
    }
  };

  /* ── Lyric Video ── */
  const handleLyricVideo = async () => {
    if (!form.artworkFile || !form.audioFile || !form.lyrics.trim()) return;
    setLyricStatus("generating"); setLyricError(null); setLyricUrl(null);
    try {
      const fd = new window.FormData();
      fd.append("artwork", form.artworkFile);
      fd.append("audio", form.audioFile);
      fd.append("lyrics", form.lyrics);
      fd.append("style", form.lyricStyle);
      fd.append("layout", form.lyricLayout);
      fd.append("textColor", "#FFFFFF");
      const res = await fetch("/api/lyric-video", { method: "POST", body: fd });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Error ${res.status}`);
      setLyricUrl(URL.createObjectURL(await res.blob()));
      setLyricStatus("done");
    } catch (err) {
      setLyricError(err instanceof Error ? err.message : "Unknown error");
      setLyricStatus("error");
    }
  };

  /* ── Shorts (all 3) ── */
  const handleShorts = async () => {
    if (!form.artworkFile || !form.audioFile) return;
    setShortsStatus("generating"); setShortsError(null); setShorts([]);

    // Pick a hook lyric line and a standalone lyric line
    const lyricLines = (form.lyrics || "").split("\n").map(l => l.trim()).filter(l => l.length > 5);
    const hookText = lyricLines.length > 0
      ? lyricLines[Math.min(2, lyricLines.length - 1)]
      : form.trackTitle;
    const lyricText = lyricLines.length > 3
      ? lyricLines[Math.floor(lyricLines.length * 0.4)]
      : hookText;

    const shortDefs: { type: "hook" | "loop" | "lyric"; text: string; title: string; caption: string }[] = [
      { type: "hook", text: hookText, title: `${form.trackTitle} — Hook`, caption: `"${hookText}" — ${form.artistName}` },
      { type: "loop", text: "", title: `${form.trackTitle} — Visual Loop`, caption: `${form.artistName} — ${form.trackTitle}` },
      { type: "lyric", text: lyricText, title: `${form.trackTitle} — Lyric`, caption: `"${lyricText}" — ${form.artistName}` },
    ];

    try {
      const results: ShortResult[] = [];
      for (const def of shortDefs) {
        const fd = new window.FormData();
        fd.append("artwork", form.artworkFile!);
        fd.append("audio", form.audioFile!);
        fd.append("type", def.type);
        fd.append("text", def.text);
        fd.append("artistName", form.artistName || "Artist");
        const res = await fetch("/api/shorts", { method: "POST", body: fd });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Error ${res.status}`);
        results.push({
          url: URL.createObjectURL(await res.blob()),
          type: def.type,
          title: def.title,
          caption: def.caption,
        });
      }
      setShorts(results);
      setShortsStatus("done");
    } catch (err) {
      setShortsError(err instanceof Error ? err.message : "Unknown error");
      setShortsStatus("error");
    }
  };

  /* ── Completeness ── */
  const completeness = {
    thumbnail: !!thumbnailUrl,
    visualiser: visStatus === "done",
    lyricVideo: lyricStatus === "done",
    shorts: shorts.length,
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
    "w-full rounded-lg bg-gray-800 border border-gray-700 px-4 py-2.5 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition";

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
          <input type="file" accept="audio/*" className={inputClass + " file:mr-3 file:rounded file:border-0 file:bg-indigo-600 file:px-3 file:py-1 file:text-xs file:text-white file:cursor-pointer"} onChange={(e) => update("audioFile", e.target.files?.[0] ?? null)} />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1.5">Lyrics</label>
          <textarea rows={5} placeholder="Paste lyrics here..." className={inputClass + " resize-none"} value={form.lyrics} onChange={(e) => update("lyrics", e.target.value)} />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1.5">Artwork or Source Video</label>
          <input type="file" accept="image/*,video/*" className={inputClass + " file:mr-3 file:rounded file:border-0 file:bg-indigo-600 file:px-3 file:py-1 file:text-xs file:text-white file:cursor-pointer"} onChange={(e) => handleArtworkChange(e.target.files?.[0] ?? null)} />
        </div>

        {/* Preset selectors */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <SelectField label="Style Preset" value={form.stylePreset} onChange={(v) => update("stylePreset", v as StylePreset)} options={[["Clean", "Clean"], ["Bold", "Bold"], ["Moody", "Moody"]]} />
          <SelectField label="Visualiser Preset" value={form.visPreset} onChange={(v) => update("visPreset", v as VisPreset)} options={[["moody-drift", "Moody Drift"], ["pulse", "Pulse"], ["parallax", "Parallax"]]} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <SelectField label="Lyric Style" value={form.lyricStyle} onChange={(v) => update("lyricStyle", v as LyricStyle)} options={[["fade", "Fade In/Out"], ["highlight", "Highlight Line"], ["reveal", "Word Reveal"]]} />
          <SelectField label="Lyric Layout" value={form.lyricLayout} onChange={(v) => update("lyricLayout", v as LyricLayout)} options={[["center", "Centered"], ["lower-third", "Lower Third"], ["fullscreen", "Fullscreen"]]} />
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
                <SelectField label="Tone" value={form.tone} onChange={(v) => update("tone", v)} options={[["", "Auto (from style)"], ["moody", "Moody"], ["energetic", "Energetic"], ["minimal", "Minimal"], ["bold", "Bold"]]} />
              </div>
              <InputField label="Spotify URL" placeholder="https://open.spotify.com/..." value={form.spotifyUrl} onChange={(v) => update("spotifyUrl", v)} />
              <InputField label="Apple Music URL" placeholder="https://music.apple.com/..." value={form.appleUrl} onChange={(v) => update("appleUrl", v)} />
              <InputField label="Instagram URL" placeholder="https://instagram.com/..." value={form.instagramUrl} onChange={(v) => update("instagramUrl", v)} />
            </div>
          )}
        </div>
      </section>

      {/* Generate Button */}
      <button onClick={handleGenerate} disabled={loading} className="w-full rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed py-3 text-sm font-semibold text-white transition">
        {loading ? <Spinner text="Generating..." /> : "Generate YouTube Pack"}
      </button>

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

          {/* ── Thumbnail ── */}
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

          {/* ── Visualiser ── */}
          <OutputSection title="Visualiser">
            <VideoJobOutput
              status={visStatus}
              url={visUrl}
              error={visError}
              filename={`${form.artistName}-${form.trackTitle}-visualiser.mp4`}
              onGenerate={handleVisualiser}
              onRetry={handleVisualiser}
              canGenerate={hasMedia}
              generateLabel="Generate Visualiser"
              loadingLabel="Rendering visualiser..."
              disabledLabel="Upload artwork + audio to enable"
            />
          </OutputSection>

          {/* ── Lyric Video ── */}
          <OutputSection title="Lyric Video">
            <VideoJobOutput
              status={lyricStatus}
              url={lyricUrl}
              error={lyricError}
              filename={`${form.artistName}-${form.trackTitle}-lyric-video.mp4`}
              onGenerate={handleLyricVideo}
              onRetry={handleLyricVideo}
              canGenerate={hasMedia && !!form.lyrics.trim()}
              generateLabel="Generate Lyric Video"
              loadingLabel="Rendering lyric video..."
              disabledLabel="Upload artwork + audio + paste lyrics to enable"
            />
          </OutputSection>

          {/* ── Shorts ── */}
          <OutputSection title="Shorts">
            {shortsStatus === "done" && shorts.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {shorts.map((s) => (
                  <div key={s.type} className="space-y-2">
                    <video src={s.url} controls className="rounded-lg border border-gray-700 w-full aspect-[9/16] object-cover" />
                    <p className="text-xs text-gray-300 font-medium">{s.title}</p>
                    <p className="text-xs text-gray-500">{s.caption}</p>
                    <DownloadBtn href={s.url} filename={`${form.artistName}-short-${s.type}.mp4`} label="Download" />
                  </div>
                ))}
              </div>
            ) : shortsStatus === "generating" ? (
              <div className="rounded-lg bg-gray-800 border border-gray-700 p-8 flex items-center justify-center">
                <Spinner text="Generating 3 Shorts... this takes a moment" />
              </div>
            ) : shortsStatus === "error" ? (
              <ErrorBlock message={shortsError} onRetry={handleShorts} />
            ) : hasMedia ? (
              <div className="space-y-2">
                <Placeholder label="3 Shorts ready to generate: Hook, Loop, Lyric" />
                <button onClick={handleShorts} className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded transition">
                  Generate All Shorts
                </button>
              </div>
            ) : (
              <Placeholder label="Upload artwork + audio to enable" />
            )}
          </OutputSection>

          {/* ── Metadata Copy ── */}
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

/* ══════════════════════════════════════════════
   Helper Components
   ══════════════════════════════════════════════ */

function InputField({ label, placeholder, value, onChange }: { label: string; placeholder: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-400 mb-1.5">{label}</label>
      <input type="text" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-lg bg-gray-800 border border-gray-700 px-4 py-2.5 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition" />
    </div>
  );
}

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-400 mb-1.5">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-lg bg-gray-800 border border-gray-700 px-4 py-2.5 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition">
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
    <span className={`text-xs px-2.5 py-1 rounded-full border ${done ? "border-green-700 bg-green-900/30 text-green-400" : "border-gray-600 bg-gray-800 text-gray-500"}`}>
      {done ? "\u2713" : "\u25CB"} {label}
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
    <a href={href} download={filename} className="inline-block text-xs bg-gray-800 hover:bg-gray-700 text-indigo-400 px-3 py-1.5 rounded transition">
      {label}
    </a>
  );
}

function ErrorBlock({ message, onRetry }: { message: string | null; onRetry: () => void }) {
  return (
    <div className="space-y-2">
      <div className="rounded-lg bg-red-900/30 border border-red-800 p-3 text-xs text-red-300">{message}</div>
      <button onClick={onRetry} className="text-xs bg-gray-800 hover:bg-gray-700 text-indigo-400 px-3 py-1.5 rounded transition">Retry</button>
    </div>
  );
}

interface VideoJobOutputProps {
  status: JobStatus;
  url: string | null;
  error: string | null;
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
    return <ErrorBlock message={props.error} onRetry={props.onRetry} />;
  }
  if (props.canGenerate) {
    return (
      <div className="space-y-2">
        <Placeholder label="Ready to generate" />
        <button onClick={props.onGenerate} className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded transition">
          {props.generateLabel}
        </button>
      </div>
    );
  }
  return <Placeholder label={props.disabledLabel} />;
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
