"use client";

import { useState, useRef } from "react";
import { generateThumbnail, type StylePreset } from "@/lib/thumbnail";
import { generateMetadata, type MetadataOutput } from "@/lib/metadata";

interface FormData {
  artistName: string;
  trackTitle: string;
  audioFile: File | null;
  lyrics: string;
  artworkFile: File | null;
  stylePreset: StylePreset;
}

type VisualiserStatus = "idle" | "generating" | "done" | "error";

export default function Home() {
  const [form, setForm] = useState<FormData>({
    artistName: "",
    trackTitle: "",
    audioFile: null,
    lyrics: "",
    artworkFile: null,
    stylePreset: "Clean",
  });

  // Artwork preview data URL (read on file select)
  const [artworkPreview, setArtworkPreview] = useState<string | null>(null);

  // Outputs
  const [loading, setLoading] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<MetadataOutput | null>(null);

  // Visualiser
  const [visStatus, setVisStatus] = useState<VisualiserStatus>("idle");
  const [visUrl, setVisUrl] = useState<string | null>(null);
  const [visError, setVisError] = useState<string | null>(null);

  const audioRef = useRef<HTMLInputElement>(null);
  const artworkRef = useRef<HTMLInputElement>(null);

  const update = (field: keyof FormData, value: string | File | null) => {
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

  const handleGenerate = async () => {
    setLoading(true);
    setGenerated(false);
    setThumbnailUrl(null);
    setMetadata(null);
    setVisStatus("idle");
    setVisUrl(null);
    setVisError(null);

    try {
      // 1. Generate thumbnail (client-side, instant)
      if (artworkPreview) {
        const thumb = await generateThumbnail({
          artworkDataUrl: artworkPreview,
          artistName: form.artistName,
          trackTitle: form.trackTitle,
          style: form.stylePreset,
        });
        setThumbnailUrl(thumb);
      }

      // 2. Generate metadata copy (client-side, instant)
      const meta = generateMetadata({
        artistName: form.artistName,
        trackTitle: form.trackTitle,
        style: form.stylePreset,
      });
      setMetadata(meta);

      setGenerated(true);
    } catch (err) {
      console.error("Generation error:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleVisualiser = async () => {
    if (!form.artworkFile || !form.audioFile) return;

    setVisStatus("generating");
    setVisError(null);
    setVisUrl(null);

    try {
      const fd = new window.FormData();
      fd.append("artwork", form.artworkFile);
      fd.append("audio", form.audioFile);

      const res = await fetch("/api/visualiser", {
        method: "POST",
        body: fd,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(body.error || `Server error ${res.status}`);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setVisUrl(url);
      setVisStatus("done");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setVisError(msg);
      setVisStatus("error");
    }
  };

  const inputClass =
    "w-full rounded-lg bg-gray-800 border border-gray-700 px-4 py-2.5 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition";

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

      {/* Input Section */}
      <section className="space-y-4 mb-8">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">
              Artist Name
            </label>
            <input
              type="text"
              placeholder="e.g. Frank Ocean"
              className={inputClass}
              value={form.artistName}
              onChange={(e) => update("artistName", e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">
              Track Title
            </label>
            <input
              type="text"
              placeholder="e.g. Nights"
              className={inputClass}
              value={form.trackTitle}
              onChange={(e) => update("trackTitle", e.target.value)}
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1.5">
            Audio File
          </label>
          <input
            ref={audioRef}
            type="file"
            accept="audio/*"
            className={
              inputClass +
              " file:mr-3 file:rounded file:border-0 file:bg-indigo-600 file:px-3 file:py-1 file:text-xs file:text-white file:cursor-pointer"
            }
            onChange={(e) => update("audioFile", e.target.files?.[0] ?? null)}
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1.5">
            Lyrics
          </label>
          <textarea
            rows={5}
            placeholder="Paste lyrics here..."
            className={inputClass + " resize-none"}
            value={form.lyrics}
            onChange={(e) => update("lyrics", e.target.value)}
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1.5">
            Artwork or Source Video
          </label>
          <input
            ref={artworkRef}
            type="file"
            accept="image/*,video/*"
            className={
              inputClass +
              " file:mr-3 file:rounded file:border-0 file:bg-indigo-600 file:px-3 file:py-1 file:text-xs file:text-white file:cursor-pointer"
            }
            onChange={(e) =>
              handleArtworkChange(e.target.files?.[0] ?? null)
            }
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1.5">
            Style Preset
          </label>
          <select
            className={inputClass}
            value={form.stylePreset}
            onChange={(e) =>
              update("stylePreset", e.target.value as StylePreset)
            }
          >
            <option value="Clean">Clean</option>
            <option value="Bold">Bold</option>
            <option value="Moody">Moody</option>
          </select>
        </div>
      </section>

      {/* Generate Button */}
      <button
        onClick={handleGenerate}
        disabled={loading}
        className="w-full rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed py-3 text-sm font-semibold text-white transition"
      >
        {loading ? <Spinner text="Generating..." /> : "Generate YouTube Pack"}
      </button>

      {/* Output Section */}
      {generated && (
        <section className="mt-10 space-y-8">
          <h2 className="text-lg font-semibold text-white">
            Your YouTube Pack
          </h2>

          {/* ── Thumbnail ── */}
          <div>
            <h3 className="text-sm font-medium text-gray-400 mb-2">
              Thumbnail
            </h3>
            {thumbnailUrl ? (
              <div className="space-y-2">
                <img
                  src={thumbnailUrl}
                  alt="Generated thumbnail"
                  className="rounded-lg border border-gray-700 w-full max-w-lg"
                />
                <a
                  href={thumbnailUrl}
                  download={`${form.artistName || "artist"}-${form.trackTitle || "track"}-thumbnail.png`}
                  className="inline-block text-xs bg-gray-800 hover:bg-gray-700 text-indigo-400 px-3 py-1.5 rounded transition"
                >
                  Download PNG
                </a>
              </div>
            ) : (
              <Placeholder label="Upload artwork to generate thumbnail" />
            )}
          </div>

          {/* ── Visualiser ── */}
          <div>
            <h3 className="text-sm font-medium text-gray-400 mb-2">
              Visualiser
            </h3>
            {visStatus === "done" && visUrl ? (
              <div className="space-y-2">
                <video
                  src={visUrl}
                  controls
                  className="rounded-lg border border-gray-700 w-full max-w-lg"
                />
                <a
                  href={visUrl}
                  download={`${form.artistName || "artist"}-${form.trackTitle || "track"}-visualiser.mp4`}
                  className="inline-block text-xs bg-gray-800 hover:bg-gray-700 text-indigo-400 px-3 py-1.5 rounded transition"
                >
                  Download MP4
                </a>
              </div>
            ) : visStatus === "generating" ? (
              <div className="aspect-video max-w-lg rounded-lg bg-gray-800 border border-gray-700 flex items-center justify-center">
                <Spinner text="Rendering visualiser... this may take a minute" />
              </div>
            ) : visStatus === "error" ? (
              <div className="space-y-2">
                <div className="rounded-lg bg-red-900/30 border border-red-800 p-3 text-xs text-red-300">
                  {visError}
                </div>
                <button
                  onClick={handleVisualiser}
                  className="text-xs bg-gray-800 hover:bg-gray-700 text-indigo-400 px-3 py-1.5 rounded transition"
                >
                  Retry
                </button>
              </div>
            ) : form.artworkFile && form.audioFile ? (
              <div className="space-y-2">
                <Placeholder label="Visualiser ready to generate" />
                <button
                  onClick={handleVisualiser}
                  className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded transition"
                >
                  Generate Visualiser (requires FFmpeg)
                </button>
              </div>
            ) : (
              <Placeholder label="Upload artwork + audio to enable visualiser" />
            )}
          </div>

          {/* ── Placeholders for future features ── */}
          <div>
            <h3 className="text-sm font-medium text-gray-400 mb-2">
              Lyric Video
            </h3>
            <Placeholder label="Coming soon" />
          </div>
          <div>
            <h3 className="text-sm font-medium text-gray-400 mb-2">Shorts</h3>
            <div className="grid grid-cols-3 gap-3">
              <Placeholder label="Coming soon" aspect="short" />
              <Placeholder label="Coming soon" aspect="short" />
              <Placeholder label="Coming soon" aspect="short" />
            </div>
          </div>

          {/* ── Metadata Copy ── */}
          {metadata && (
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-gray-400">
                YouTube Copy
              </h3>
              <CopyBlock
                label="Lyric Video Title"
                text={metadata.lyricVideoTitle}
              />
              <CopyBlock
                label="Visualiser Title"
                text={metadata.visualiserTitle}
              />
              <CopyBlock
                label="Short Description"
                text={metadata.shortDescription}
              />
              <CopyBlock
                label="Full Description"
                text={metadata.longDescription}
              />
              <CopyBlock label="Tags" text={metadata.tags} />
            </div>
          )}
        </section>
      )}
    </main>
  );
}

/* ── Helper components ── */

function Spinner({ text }: { text: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-gray-300">
      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
        />
      </svg>
      {text}
    </span>
  );
}

function Placeholder({
  label,
  aspect,
}: {
  label: string;
  aspect?: "video" | "short" | "thumb";
}) {
  const aspectClass =
    aspect === "short"
      ? "aspect-[9/16]"
      : "aspect-video max-w-lg";

  return (
    <div
      className={`${aspectClass} rounded-lg bg-gray-800 border border-gray-700 flex items-center justify-center`}
    >
      <span className="text-xs text-gray-500">{label}</span>
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
        <button
          onClick={copy}
          className="text-xs text-indigo-400 hover:text-indigo-300 transition"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre className="text-xs text-gray-300 whitespace-pre-wrap font-sans leading-relaxed">
        {text}
      </pre>
    </div>
  );
}
