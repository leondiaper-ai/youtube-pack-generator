/**
 * Client-side thumbnail generator using Canvas API.
 * Draws artwork background, applies style treatment, overlays text.
 * Returns a data URL (PNG).
 */

export type StylePreset = "Clean" | "Bold" | "Moody";

interface ThumbnailOptions {
  artworkDataUrl: string;
  artistName: string;
  trackTitle: string;
  style: StylePreset;
}

const WIDTH = 1280;
const HEIGHT = 720;

const STYLE_CONFIG: Record<
  StylePreset,
  {
    overlay: string;
    titleFont: string;
    artistFont: string;
    titleColor: string;
    artistColor: string;
    textAlign: CanvasTextAlign;
    titleY: number;
    artistY: number;
    shadow: boolean;
  }
> = {
  Clean: {
    overlay: "rgba(0,0,0,0.35)",
    titleFont: "bold 72px sans-serif",
    artistFont: "400 36px sans-serif",
    titleColor: "#ffffff",
    artistColor: "rgba(255,255,255,0.85)",
    textAlign: "center",
    titleY: HEIGHT * 0.52,
    artistY: HEIGHT * 0.52 - 80,
    shadow: false,
  },
  Bold: {
    overlay: "rgba(0,0,0,0.5)",
    titleFont: "900 84px sans-serif",
    artistFont: "700 40px sans-serif",
    titleColor: "#ffffff",
    artistColor: "#facc15",
    textAlign: "center",
    titleY: HEIGHT * 0.55,
    artistY: HEIGHT * 0.55 - 90,
    shadow: true,
  },
  Moody: {
    overlay:
      "linear-gradient", // handled specially
    titleFont: "300 64px sans-serif",
    artistFont: "300 30px sans-serif",
    titleColor: "rgba(255,255,255,0.9)",
    artistColor: "rgba(255,255,255,0.55)",
    textAlign: "left",
    titleY: HEIGHT * 0.75,
    artistY: HEIGHT * 0.75 - 70,
    shadow: false,
  },
};

export async function generateThumbnail(
  opts: ThumbnailOptions
): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d")!;

  // Draw artwork background (cover fill)
  const img = await loadImage(opts.artworkDataUrl);
  drawCover(ctx, img, WIDTH, HEIGHT);

  // Style-specific overlay
  const cfg = STYLE_CONFIG[opts.style];

  if (opts.style === "Moody") {
    // Gradient from transparent top to dark bottom
    const grad = ctx.createLinearGradient(0, 0, 0, HEIGHT);
    grad.addColorStop(0, "rgba(0,0,0,0.1)");
    grad.addColorStop(0.5, "rgba(0,0,0,0.3)");
    grad.addColorStop(1, "rgba(0,0,0,0.85)");
    ctx.fillStyle = grad;
  } else {
    ctx.fillStyle = cfg.overlay;
  }
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Text shadow for Bold
  if (cfg.shadow) {
    ctx.shadowColor = "rgba(0,0,0,0.7)";
    ctx.shadowBlur = 20;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 4;
  }

  const textX = cfg.textAlign === "center" ? WIDTH / 2 : 60;

  // Artist name
  ctx.font = cfg.artistFont;
  ctx.fillStyle = cfg.artistColor;
  ctx.textAlign = cfg.textAlign;
  ctx.fillText(opts.artistName.toUpperCase(), textX, cfg.artistY);

  // Track title
  ctx.font = cfg.titleFont;
  ctx.fillStyle = cfg.titleColor;
  ctx.fillText(opts.trackTitle, textX, cfg.titleY);

  // Reset shadow
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;

  return canvas.toDataURL("image/png");
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
