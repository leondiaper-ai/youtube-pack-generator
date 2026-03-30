/**
 * YouTube metadata copy generator.
 * Produces titles, descriptions, and tags from track info.
 */

export type StylePreset = "Clean" | "Bold" | "Moody";

interface MetadataInput {
  artistName: string;
  trackTitle: string;
  style: StylePreset;
}

export interface MetadataOutput {
  lyricVideoTitle: string;
  visualiserTitle: string;
  shortDescription: string;
  longDescription: string;
  tags: string;
}

export function generateMetadata(input: MetadataInput): MetadataOutput {
  const { artistName, trackTitle, style } = input;
  const artist = artistName || "Artist";
  const track = trackTitle || "Track Title";
  const year = new Date().getFullYear();

  // Style affects tone slightly
  const vibe =
    style === "Bold"
      ? "Out now. Turn it up."
      : style === "Moody"
        ? "Listen in the dark."
        : "Available everywhere.";

  const lyricVideoTitle = `${artist} — ${track} (Official Lyric Video)`;
  const visualiserTitle = `${artist} — ${track} (Visualiser)`;

  const shortDescription = `${artist} — ${track}. ${vibe}\n\nStream: https://link.example.com/${encodeSlug(track)}`;

  const longDescription = `${artist} — ${track} (Official Lyric Video)

${vibe}

Stream "${track}" everywhere:
Spotify: https://open.spotify.com/track/example
Apple Music: https://music.apple.com/example
YouTube Music: https://music.youtube.com/example

Follow ${artist}:
Instagram: https://instagram.com/${encodeSlug(artist)}
Twitter: https://twitter.com/${encodeSlug(artist)}
TikTok: https://tiktok.com/@${encodeSlug(artist)}

Lyrics, music, and vocals by ${artist}.

#${slugify(artist)} #${slugify(track)} #LyricVideo #NewMusic${year} #OfficialVideo`;

  const tagList = [
    artist.toLowerCase(),
    track.toLowerCase(),
    `${artist.toLowerCase()} ${track.toLowerCase()}`,
    "lyric video",
    "official lyric video",
    "visualiser",
    `new music ${year}`,
    `${artist.toLowerCase()} new song`,
    "official audio",
    "music video",
    style.toLowerCase() + " aesthetic",
  ];

  return {
    lyricVideoTitle,
    visualiserTitle,
    shortDescription,
    longDescription,
    tags: tagList.join(", "),
  };
}

function encodeSlug(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "").replace(/[^a-z0-9]/g, "");
}

function slugify(s: string): string {
  return s.replace(/\s+/g, "").replace(/[^a-zA-Z0-9]/g, "");
}
