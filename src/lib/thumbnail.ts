/**
 * Client-side thumbnail generator using Canvas API.
 *
 * Generates 1280x720 YouTube thumbnails from artwork + optional text.
 *
 * Quality-pass improvements:
 *   - Three text modes: "none" | "title-only" | "artist-title"
 *     (default is "none" — image-only, most flexible for labels)
 *   - Safe text wrapping: long titles wrap to 2 lines and auto-scale down
 *     if still too wide, so they never overflow safe margins
 *   - Balanced typography per style preset (Clean / Bold / Moody)
 *   - Consistent safe-area margins across all styles
 *   - Moody style uses a proper gradient with left-aligned caption block
 */

export type StylePreset = "Clean" | "Bold" | "Moody";
export type ThumbnailTextMode = "none" | "title-only" | "artist-title";

interface ThumbnailOptions {
  artworkDataUrl: string;
  artistName: string;
  trackTitle: string;
  style: StylePreset;
  /** Defaults to "none" — no text overlay, just the artwork treatment. */
  textMode?: ThumbnailTextMode;
}

const WIDTH = 1280;
const HEIGHT = 720;
const SAFE_X = 72;
const SAFE_MAX_WIDTH = WIDTH - SAFE_X * 2;

type StyleConfig = {
  overlayKind: "flat" | "gradient";
  overlay: string;
  titleBaseSize: number;
  artistSize: number;
  titleColor: string;
  artistColor: string;
  textAlign: CanvasTextAlign;
  shadow: boolean;
  /** Vertical position of the baseline of the title block (center = 0.5) */
  titleYRatio: number;
  /** Gap between title and artist label (px) */
  gap: number;
};

const STYLE_CONFIG: Record<StylePreset, StyleConfig> = {
  Clean: {
    overlayKind: "flat",
    overlay: "rgba(0,0,0,0.32)",
    titleBaseSize: 76,
    artistSize: 30,
    titleColor: "#ffffff",
    artistColor: "rgba(255,255,255,0.85)",
    textAlign: "center",
    shadow: false,
    titleYRatio: 0.58,
    gap: 18,
  },
  Bold: {
    overlayKind: "flat",
    overlay: "rgba(0,0,0,0.5)",
    titleBaseSize: 96,
    artistSize: 34,
    titleColor: "#ffffff",
    artistColor: "#facc15",
    textAlign: "center",
    shadow: true,
    titleYRatio: 0.6,
    gap: 22,
  },
  Moody: {
    overlayKind: "gradient",
    overlay: "", // handled specially
    titleBaseSize: 64,
    artistSize: 26,
    titleColor: "rgba(255,255,255,0.95)",
    artistColor: "rgba(255,255,255,0.6)",
    textAlign: "left",
    shadow: false,
    titleYRatio: 0.82,
    gap: 14,
  },
};

export async function generateThumbnail(
  opts: ThumbnailOptions
): Promise<string> {
  const textMode: ThumbnailTextMode = opts.textMode ?? "none";

  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d")!;

  // Draw artwork background (cover fill)
  const img = await loadImage(opts.artworkDataUrl);
  drawCover(ctx, img, WIDTH, HEIGHT);

  const cfg = STYLE_CONFIG[opts.style];

  // Overlay
  // - "none" text mode still gets a very subtle darkening so the image
  //   reads cohesively, but stays light enough to showcase the artwork.
  if (cfg.overlayKind === "gradient") {
    const grad = ctx.createLinearGradient(0, 0, 0, HEIGHT);
    grad.addColorStop(0, "rgba(0,0,0,0.05)");
    grad.addColorStop(0.5, "rgba(0,0,0,0.25)");
    grad.addColorStop(1, "rgba(0,0,0,0.85)");
    ctx.fillStyle = grad;
  } else {
    ctx.fillStyle = textMode === "none" ? "rgba(0,0,0,0.12)" : cfg.overlay;
  }
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  if (textMode === "none") {
    return canvas.toDataURL("image/png");
  }

  // Text rendering path
  if (cfg.shadow) {
    ctx.shadowColor = "rgba(0,0,0,0.75)";
    ctx.shadowBlur = 22;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 4;
  }

  const centerX = WIDTH / 2;
  const textX = cfg.textAlign === "center" ? centerX : SAFE_X;
  ctx.textAlign = cfg.textAlign;
  ctx.textBaseline = "alphabetic";

  // Fit the title within safe width: start from base size, wrap to up to 2
  // lines, then shrink font if still too wide.
  const { lines: titleLines, fontSize: titleSize } = fitTitle(
    ctx,
    opts.trackTitle,
    cfg.titleBaseSize,
    SAFE_MAX_WIDTH
  );

  const lineHeight = titleSize * 1.08;
  const titleBlockHeight = titleLines.length * lineHeight;

  // Position the block around the style's titleYRatio
  const anchorY = HEIGHT * cfg.titleYRatio;
  // anchorY is the baseline of the LAST title line
  const firstBaselineY = anchorY - (titleLines.length - 1) * lineHeight;

  ctx.font = `${styleWeight(opts.style)} ${titleSize}px sans-serif`;
  ctx.fillStyle = cfg.titleColor;
  for (let i = 0; i < titleLines.length; i++) {
    ctx.fillText(titleLines[i], textX, firstBaselineY + i * lineHeight);
  }

  // Artist label (only in artist-title mode)
  if (textMode === "artist-title") {
    ctx.font = `${artistWeight(opts.style)} ${cfg.artistSize}px sans-serif`;
    ctx.fillStyle = cfg.artistColor;
    // sit above the title block with a tasteful gap, uppercased + letter-spaced
    const artistY = firstBaselineY - titleBlockHeight + titleSize - cfg.gap;
    const artistText = spaceOut(opts.artistName.toUpperCase());
    ctx.fillText(artistText, textX, Math.max(cfg.artistSize + 20, artistY));
  }

  // Reset shadow
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;

  return canvas.toDataURL("image/png");
}

function styleWeight(style: StylePreset): string {
  if (style === "Bold") return "900";
  if (style === "Moody") return "300";
  return "700";
}

function artistWeight(style: StylePreset): string {
  if (style === "Bold") return "700";
  if (style === "Moody") return "300";
  return "500";
}

function spaceOut(text: string): string {
  // cheap letter-spacing effect since canvas has no letter-spacing
  return text.split("").join("\u2009");
}

/**
 * Wrap a title into at most 2 lines, shrinking the font size until every
 * line fits within maxWidth. Returns the final lines and fontSize used.
 */
function fitTitle(
  ctx: CanvasRenderingContext2D,
  text: string,
  baseSize: number,
  maxWidth: number
): { lines: string[]; fontSize: number } {
  let size = baseSize;
  const minSize = Math.max(36, Math.round(baseSize * 0.55));

  while (size >= minSize) {
    ctx.font = `700 ${size}px sans-serif`;
    const lines = wrapToLines(ctx, text, maxWidth, 2);
    const allFit = lines.every((l) => ctx.measureText(l).width <= maxWidth);
    if (allFit) return { lines, fontSize: size };
    size -= 4;
  }
  // Last resort: single line, truncated with ellipsis
  ctx.font = `700 ${minSize}px sans-serif`;
  return { lines: [ellipsize(ctx, text, maxWidth)], fontSize: minSize };
}

function wrapToLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    const candidate = current ? `${current} ${w}` : w;
    if (ctx.measureText(candidate).width > maxWidth && current) {
      lines.push(current);
      current = w;
      if (lines.length === maxLines - 1) {
        // dump the rest into the last line
        const rest = [w, ...words.slice(words.indexOf(w) + 1)].join(" ");
        lines.push(rest);
        return lines;
      }
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function ellipsize(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string {
  let t = text;
  while (t.length > 0 && ctx.measureText(t + "…").width > maxWidth) {
    t = t.slice(0, -1);
  }
  return t + "…";
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  w: number,
  h: number
) {
  const scale = Math.max(w / img.width, h / img.height);
  const sw = img.width * scale;
  const sh = img.height * scale;
  ctx.drawImage(img, (w - sw) / 2, (h - sh) / 2, sw, sh);
}
