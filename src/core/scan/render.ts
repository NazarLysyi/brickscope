import sharp, { type OverlayOptions } from "sharp";
import { percentToPixels } from "./geometry.js";
import { fitInside, fromRaw } from "./load.js";
import type { PercentBox, PixelRect, RgbImage } from "./types.js";

/** Both previews stay under 2000px, the per-image limit for multi-image model requests. */
const PREVIEW_MAX_SIDE = 1600;
const SHEET_MAX_COLUMNS = 9;
const BOX_COLOR = "#ff2bd6";
const TILE_SIZE = 200;
const TILE_LABEL_HEIGHT = 30;
const TILE_GAP = 10;
const SHEET_BACKGROUND = "#1e1e1e";

/**
 * Draw a 10% grid and numbered region boxes directly over the photo, with no margins,
 * so percentages read off the image match the percent coordinates in the data.
 * Numbers are drawn as seven-segment paths, so no system fonts are needed.
 */
export async function renderAnnotated(
  working: RgbImage,
  regions: { id: number; box: PercentBox }[],
): Promise<Buffer> {
  const { data, info } = await fromRaw(working)
    .resize(fitInside(PREVIEW_MAX_SIDE))
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = info;
  const rects = regions.map((r) => percentToPixels(r.box, { width, height }));
  const labelHeight = Math.max(14, Math.round(Math.min(width, height) * 0.026));
  const placed: PixelRect[] = [];
  const labels = regions.map((region, index) => {
    const size = labelSize(String(region.id), labelHeight);
    const spot = placeLabel(rects[index], size, placed, width, height);
    placed.push(spot);
    return (
      `<rect x="${spot.left}" y="${spot.top}" width="${spot.width}" height="${spot.height}" fill="${BOX_COLOR}"/>` +
      digitsSvg(String(region.id), spot.left + size.padX, spot.top + size.padY, size.digitHeight, {
        fill: "#ffffff",
      })
    );
  });

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    gridSvg(width, height) +
    rects.map(boxSvg).join("") +
    labels.join("") +
    `</svg>`;

  return sharp(data, { raw: { width, height, channels: 3 } })
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .jpeg({ quality: 82 })
    .toBuffer();
}

/** A contact sheet of numbered crops: the exact JPEGs sent to Brickognize, outlined. */
export async function renderCropSheet(
  crops: { id: number; jpeg: Buffer }[],
): Promise<Buffer | null> {
  if (crops.length === 0) {
    return null;
  }

  const columns = Math.min(
    crops.length,
    SHEET_MAX_COLUMNS,
    Math.ceil(Math.sqrt(crops.length * 1.5)),
  );
  const rows = Math.ceil(crops.length / columns);
  const cellHeight = TILE_LABEL_HEIGHT + TILE_SIZE;
  const width = columns * TILE_SIZE + (columns + 1) * TILE_GAP;
  const height = rows * cellHeight + (rows + 1) * TILE_GAP;

  const tiles = await Promise.all(
    crops.map((crop) =>
      sharp(crop.jpeg)
        .resize({ width: TILE_SIZE, height: TILE_SIZE, fit: "inside" })
        .png()
        .toBuffer({ resolveWithObject: true }),
    ),
  );

  const composites: OverlayOptions[] = [];
  const overlay: string[] = [];
  tiles.forEach(({ data, info }, index) => {
    const cellLeft = TILE_GAP + (index % columns) * (TILE_SIZE + TILE_GAP);
    const cellTop = TILE_GAP + Math.floor(index / columns) * (cellHeight + TILE_GAP);
    const left = cellLeft + Math.floor((TILE_SIZE - info.width) / 2);
    const top = cellTop + TILE_LABEL_HEIGHT + Math.floor((TILE_SIZE - info.height) / 2);
    composites.push({ input: data, left, top });
    overlay.push(
      `<rect x="${left - 1}" y="${top - 1}" width="${info.width + 2}" height="${info.height + 2}" fill="none" stroke="${BOX_COLOR}" stroke-width="2"/>`,
      digitsSvg(String(crops[index].id), cellLeft + 2, cellTop + 4, TILE_LABEL_HEIGHT - 10, {
        fill: "#ffffff",
      }),
    );
  });

  const sheet = await sharp({
    create: { width, height, channels: 3, background: SHEET_BACKGROUND },
  })
    .composite([
      ...composites,
      {
        input: Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${overlay.join("")}</svg>`,
        ),
        left: 0,
        top: 0,
      },
    ])
    .raw()
    .toBuffer({ resolveWithObject: true });

  return sharp(sheet.data, { raw: sheet.info })
    .resize(fitInside(PREVIEW_MAX_SIDE))
    .jpeg({ quality: 85 })
    .toBuffer();
}

function gridSvg(width: number, height: number): string {
  const digitHeight = Math.max(10, Math.round(Math.min(width, height) * 0.016));
  const halo = { fill: "#ffffff", stroke: "#000000" };
  const parts: string[] = [];

  for (let step = 1; step < 10; step++) {
    const x = Math.round((width * step) / 10);
    const y = Math.round((height * step) / 10);
    const label = String(step * 10);
    parts.push(
      `<line x1="${x}" y1="0" x2="${x}" y2="${height}" stroke="#000" stroke-opacity="0.35" stroke-width="3"/>`,
      `<line x1="${x}" y1="0" x2="${x}" y2="${height}" stroke="#fff" stroke-opacity="0.7" stroke-width="1"/>`,
      `<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="#000" stroke-opacity="0.35" stroke-width="3"/>`,
      `<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="#fff" stroke-opacity="0.7" stroke-width="1"/>`,
      digitsSvg(label, x + 4, 4, digitHeight, halo),
      digitsSvg(label, 4, y - digitHeight - 4, digitHeight, halo),
    );
  }

  return parts.join("");
}

function boxSvg(rect: PixelRect): string {
  const attrs = `x="${rect.left}" y="${rect.top}" width="${rect.width}" height="${rect.height}" fill="none"`;
  return (
    `<rect ${attrs} stroke="#000" stroke-opacity="0.6" stroke-width="5"/>` +
    `<rect ${attrs} stroke="${BOX_COLOR}" stroke-width="3"/>`
  );
}

interface LabelSize {
  width: number;
  height: number;
  digitHeight: number;
  padX: number;
  padY: number;
}

function labelSize(text: string, height: number): LabelSize {
  const padY = Math.round(height * 0.18);
  const digitHeight = height - 2 * padY;
  const padX = Math.round(height * 0.22);
  return { width: digitsWidth(text, digitHeight) + 2 * padX, height, digitHeight, padX, padY };
}

/** First candidate spot for a box's label that stays in the image and clears earlier labels. */
function placeLabel(
  box: PixelRect,
  size: LabelSize,
  placed: PixelRect[],
  width: number,
  height: number,
): PixelRect {
  const right = box.left + box.width - size.width;
  const bottom = box.top + box.height;
  const candidates = [
    [box.left, box.top - size.height],
    [box.left, box.top],
    [box.left, bottom],
    [right, box.top - size.height],
    [right, bottom - size.height],
    [box.left, bottom - size.height],
  ].map(([x, y]) => ({
    left: Math.min(Math.max(0, x), Math.max(0, width - size.width)),
    top: Math.min(Math.max(0, y), Math.max(0, height - size.height)),
    width: size.width,
    height: size.height,
  }));

  return candidates.find((c) => !placed.some((p) => overlaps(c, p))) ?? candidates[0];
}

function overlaps(a: PixelRect, b: PixelRect): boolean {
  return (
    a.left < b.left + b.width &&
    b.left < a.left + a.width &&
    a.top < b.top + b.height &&
    b.top < a.top + a.height
  );
}

// ---------------------------------------------------------------------------
// Seven-segment digits
// ---------------------------------------------------------------------------

const SEGMENTS: Record<string, string> = {
  "0": "abcdef",
  "1": "bc",
  "2": "abged",
  "3": "abgcd",
  "4": "fgbc",
  "5": "afgcd",
  "6": "afgedc",
  "7": "abc",
  "8": "abcdefg",
  "9": "abcdfg",
};

function digitWidth(height: number): number {
  return Math.round(height * 0.56);
}

function digitsWidth(text: string, height: number): number {
  const gap = Math.round(height * 0.22);
  return text.length * digitWidth(height) + (text.length - 1) * gap;
}

/** A path of filled segment rectangles for the digits in `text`, top-left at (x, y). */
function digitsSvg(
  text: string,
  x: number,
  y: number,
  height: number,
  paint: { fill: string; stroke?: string },
): string {
  const w = digitWidth(height);
  const gap = Math.round(height * 0.22);
  const t = Math.max(2, Math.round(height * 0.15));
  const half = Math.round(height / 2);
  const rect = (rx: number, ry: number, rw: number, rh: number) =>
    `M${rx} ${ry}h${rw}v${rh}h${-rw}Z`;

  const d = [...text]
    .map((char, index) => {
      const ox = x + index * (w + gap);
      const shapes: Record<string, string> = {
        a: rect(ox, y, w, t),
        b: rect(ox + w - t, y, t, half + Math.ceil(t / 2)),
        c: rect(ox + w - t, y + half - Math.floor(t / 2), t, height - half + Math.floor(t / 2)),
        d: rect(ox, y + height - t, w, t),
        e: rect(ox, y + half - Math.floor(t / 2), t, height - half + Math.floor(t / 2)),
        f: rect(ox, y, t, half + Math.ceil(t / 2)),
        g: rect(ox, y + half - Math.floor(t / 2), w, t),
      };
      return [...(SEGMENTS[char] ?? "")].map((segment) => shapes[segment]).join("");
    })
    .join("");

  const stroke = paint.stroke
    ? ` stroke="${paint.stroke}" stroke-width="2" stroke-opacity="0.8" paint-order="stroke"`
    : "";
  return `<path d="${d}" fill="${paint.fill}"${stroke}/>`;
}
