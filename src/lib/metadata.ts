/**
 * Enhanced YouTube metadata generator.
 * Produces content-type-aware copy for visualiser, lyric video, shorts.
 * Supports artist profile for recurring info.
 */

export type StylePreset = "Clean" | "Bold" | "Moody";

export interface ArtistProfile {
  name: string;
  genre: string;
  tone: string; // e.g. "moody", "energetic", "minimal"
  tags: string[]; // recurring tags
  links: {
    spotify?: string;
    apple?: string;
    youtube?: string;
    instagram?: string;
    twitter?: string;
    tiktok?: string;
  };
}

interface MetadataInput {
  artistName: string;
  trackTitle: string;
  style: StylePreset;
  lyrics?: string;
  profile?: ArtistProfile;
}

export interface ContentTypeCopy {
  titles: string[]; // 2-3 title options
  shortDescription: string;
  fullDescription: string;
  hashtags: string;
  tags: string;
}

export interface MetadataOutput {
  visualiser: ContentTypeCopy;
  lyricVideo: ContentTypeCopy;
  shorts: ContentTypeCopy;
  pinnedComment: string;
  communityPost: string;
}

export function generateMetadata(input: MetadataInput): MetadataOutput {
  const { artistName, trackTitle, style, lyrics, profile } = input;
  const artist = profile?.name || artistName || "Artist";
  const track = trackTitle || "Track Title";
  const year = new Date().getFullYear();
  const genre = profile?.genre || "music";
  const tone = profile?.tone || style.toLowerCase();

  // Tone-driven language
  const vibeMap: Record<string, { tagline: string; cta: string; mood: string }> = {
    moody: {
      tagline: "Listen in the dark.",
      cta: "Close your eyes. Press play.",
      mood: "atmospheric",
    },
    bold: {
      tagline: "Out now. Turn it up.",
      cta: "Play it loud.",
      mood: "high-energy",
    },
    energetic: {
      tagline: "New heat. Out now.",
      cta: "Don't miss this one.",
      mood: "vibrant",
    },
    minimal: {
      tagline: "New music. Out now.",
      cta: "Stream everywhere.",
      mood: "minimal",
    },
    clean: {
      tagline: "Available everywhere.",
      cta: "Stream now.",
      mood: "clean",
    },
  };
  const vibe = vibeMap[tone] || vibeMap.clean;

  // Links
  const links = profile?.links || {};
  const streamBlock = [
    links.spotify ? `Spotify: ${links.spotify}` : "Spotify: https://open.spotify.com/",
    links.apple ? `Apple Music: ${links.apple}` : "Apple Music: https://music.apple.com/",
    links.youtube ? `YouTube Music: ${links.youtube}` : "YouTube Music: https://music.youtube.com/",
  ].join("\n");

  const socialBlock = [
    links.instagram ? `Instagram: ${links.instagram}` : `Instagram: https://instagram.com/${slug(artist)}`,
    links.twitter ? `Twitter: ${links.twitter}` : `Twitter: https://twitter.com/${slug(artist)}`,
    links.tiktok ? `TikTok: ${links.tiktok}` : `TikTok: https://tiktok.com/@${slug(artist)}`,
  ].join("\n");

  // Extract a hook from lyrics (first non-empty line or chorus-like line)
  const lyricHook = extractHook(lyrics);

  // Recurring tags from profile
  const baseTags = [
    artist.toLowerCase(),
    track.toLowerCase(),
    `${artist.toLowerCase()} ${track.toLowerCase()}`,
    genre,
    `new music ${year}`,
    `${artist.toLowerCase()} new song`,
    vibe.mood,
    ...(profile?.tags || []),
  ];

  // ── Visualiser ──
  const visualiser: ContentTypeCopy = {
    titles: [
      `${artist} — ${track} (Visualiser)`,
      `${artist} — ${track} [Official Visualiser]`,
      `${artist} — ${track} | ${vibe.mood.charAt(0).toUpperCase() + vibe.mood.slice(1)} Visualiser`,
    ],
    shortDescription: `${artist} — ${track}. ${vibe.tagline}\n\n${vibe.cta}`,
    fullDescription: `${artist} — ${track} (Official Visualiser)

${vibe.tagline}

${lyricHook ? `"${lyricHook}"\n` : ""}
Stream "${track}" everywhere:
${streamBlock}

Follow ${artist}:
${socialBlock}

Music by ${artist}.

#${slugify(artist)} #${slugify(track)} #Visualiser #NewMusic${year} #${slugify(genre)}`,
    hashtags: `#${slugify(artist)} #${slugify(track)} #Visualiser #NewMusic${year} #${slugify(genre)} #OfficialAudio`,
    tags: [...baseTags, "visualiser", "official audio", "music visualiser"].join(", "),
  };

  // ── Lyric Video ──
  const lyricVideo: ContentTypeCopy = {
    titles: [
      `${artist} — ${track} (Official Lyric Video)`,
      `${artist} — ${track} [Lyrics]`,
      `${artist} — ${track} | Lyric Video`,
    ],
    shortDescription: `${artist} — ${track}. ${vibe.tagline}\n\nFull lyrics on screen.`,
    fullDescription: `${artist} — ${track} (Official Lyric Video)

${vibe.tagline}

${lyricHook ? `"${lyricHook}"\n` : ""}
Stream "${track}" everywhere:
${streamBlock}

Follow ${artist}:
${socialBlock}

Lyrics, music, and vocals by ${artist}.

#${slugify(artist)} #${slugify(track)} #LyricVideo #NewMusic${year} #OfficialLyricVideo`,
    hashtags: `#${slugify(artist)} #${slugify(track)} #LyricVideo #Lyrics #NewMusic${year}`,
    tags: [...baseTags, "lyric video", "official lyric video", "lyrics", "official video"].join(", "),
  };

  // ── Shorts ──
  const shorts: ContentTypeCopy = {
    titles: [
      `${artist} — ${track} #shorts`,
      `"${track}" out now #${slug(artist)}`,
      `${track} | ${artist} #newmusic`,
    ],
    shortDescription: `${artist} — ${track}. ${vibe.cta}\n\nFull track out now.`,
    fullDescription: `${artist} — ${track}

${vibe.tagline}

Full song: link in bio
${streamBlock}

#${slugify(artist)} #${slugify(track)} #shorts #NewMusic${year}`,
    hashtags: `#shorts #${slugify(artist)} #${slugify(track)} #NewMusic${year} #${slugify(genre)}`,
    tags: [...baseTags, "shorts", "short", "music shorts", "viral"].join(", "),
  };

  // ── Pinned Comment ──
  const pinnedComment = lyricHook
    ? `"${lyricHook}" — which line hits hardest? Drop it below.\n\nStream "${track}" everywhere: ${links.spotify || "link in bio"}`
    : `Stream "${track}" everywhere. Link in bio.\n\nWhat do you think? Drop a comment.`;

  // ── Community Post ──
  const communityPost = `New one just dropped.\n\n${artist} — ${track}\n${vibe.tagline}\n\nWatch the full lyric video now. Link in latest upload.\n\n${vibe.cta}`;

  return { visualiser, lyricVideo, shorts, pinnedComment, communityPost };
}

function extractHook(lyrics?: string): string | null {
  if (!lyrics) return null;
  const lines = lyrics.split("\n").map((l) => l.trim()).filter((l) => l.length > 5);
  if (lines.length === 0) return null;
  // Pick a line from the first third (likely chorus/hook area) that's medium length
  const candidates = lines.slice(0, Math.max(Math.ceil(lines.length / 3), 3));
  return candidates.reduce((best, line) =>
    line.length > 15 && line.length < 80 ? line : best,
    candidates[0]
  );
}

function slug(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "").replace(/[^a-z0-9]/g, "");
}

function slugify(s: string): string {
  return s.replace(/\s+/g, "").replace(/[^a-zA-Z0-9]/g, "");
}
