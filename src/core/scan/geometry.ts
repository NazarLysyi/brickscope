import { invalidInput } from "../utils/errors.js";
import type { PercentBox, PixelRect, Size } from "./types.js";

/** IoU above which two boxes most likely cover the same part. */
const DUPLICATE_IOU = 0.6;
/** Share of the smaller box inside the larger one above which it is a duplicate. */
const DUPLICATE_CONTAINMENT = 0.85;
/** ...as long as the larger box is at most this many times bigger (not a frame around parts). */
const DUPLICATE_MAX_AREA_RATIO = 4;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Scale a percentage to pixels, trimming float noise so exact edges don't round outwards. */
function toPixels(percent: number, extent: number): number {
  return Math.round((percent / 100) * extent * 1e6) / 1e6;
}

/**
 * Convert a percent box to a pixel rect of a raster of the given size.
 * Edges round outwards (floor left/top, ceil right/bottom) and the rect is at least 1x1.
 */
export function percentToPixels(box: PercentBox, size: Size): PixelRect {
  const left = clamp(Math.floor(toPixels(box[0], size.width)), 0, size.width - 1);
  const top = clamp(Math.floor(toPixels(box[1], size.height)), 0, size.height - 1);
  const right = clamp(Math.ceil(toPixels(box[2], size.width)), left + 1, size.width);
  const bottom = clamp(Math.ceil(toPixels(box[3], size.height)), top + 1, size.height);
  return { left, top, width: right - left, height: bottom - top };
}

/** Convert a pixel rect to a percent box, rounding outwards to 2 decimals. */
export function pixelsToPercent(rect: PixelRect, size: Size): PercentBox {
  const floor2 = (v: number) => Math.floor(Math.round(v * 1e8) / 1e4) / 100;
  const ceil2 = (v: number) => Math.ceil(Math.round(v * 1e8) / 1e4) / 100;
  return [
    clamp(floor2(rect.left / size.width), 0, 100),
    clamp(floor2(rect.top / size.height), 0, 100),
    clamp(ceil2((rect.left + rect.width) / size.width), 0, 100),
    clamp(ceil2((rect.top + rect.height) / size.height), 0, 100),
  ];
}

/** Grow a rect on every side by `padding` times its longer side, clamped to the raster. */
export function expandRect(rect: PixelRect, padding: number, size: Size): PixelRect {
  const pad = Math.round(padding * Math.max(rect.width, rect.height));
  const left = Math.max(0, rect.left - pad);
  const top = Math.max(0, rect.top - pad);
  const right = Math.min(size.width, rect.left + rect.width + pad);
  const bottom = Math.min(size.height, rect.top + rect.height + pad);
  return { left, top, width: right - left, height: bottom - top };
}

function area(box: PercentBox): number {
  return (box[2] - box[0]) * (box[3] - box[1]);
}

function intersection(a: PercentBox, b: PercentBox): number {
  const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  return ix * iy;
}

/** Intersection over union of two percent boxes. */
export function iou(a: PercentBox, b: PercentBox): number {
  const shared = intersection(a, b);
  const union = area(a) + area(b) - shared;
  return union > 0 ? shared / union : 0;
}

/**
 * Pairs of 1-based box ids that likely cover the same part twice: heavy overlap, or one
 * box mostly inside another of similar size (e.g. a box kept next to the halves it was
 * split into). A frame box around many parts is not a duplicate of each of them.
 */
export function findDuplicateBoxes(boxes: PercentBox[]): [number, number][] {
  const pairs: [number, number][] = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const smaller = Math.min(area(boxes[i]), area(boxes[j]));
      const larger = Math.max(area(boxes[i]), area(boxes[j]));
      const contained =
        smaller > 0 &&
        larger <= DUPLICATE_MAX_AREA_RATIO * smaller &&
        intersection(boxes[i], boxes[j]) / smaller >= DUPLICATE_CONTAINMENT;
      if (iou(boxes[i], boxes[j]) > DUPLICATE_IOU || contained) {
        pairs.push([i + 1, j + 1]);
      }
    }
  }
  return pairs;
}

/**
 * Validate caller-supplied boxes: an array of [x1, y1, x2, y2] in percent. An empty array
 * is valid and means "no approved regions".
 */
export function validateBoxes(input: unknown, limit: number): PercentBox[] {
  if (!Array.isArray(input)) {
    throw invalidInput("boxes must be an array of [x1, y1, x2, y2] boxes in percent (0–100).");
  }
  if (input.length > limit) {
    throw invalidInput(`Too many boxes: ${input.length}. Maximum is ${limit} per scan.`);
  }

  const boxes = input.map((entry, index) => {
    const label = `Box #${index + 1}`;
    if (
      !Array.isArray(entry) ||
      entry.length !== 4 ||
      !entry.every((v) => typeof v === "number" && Number.isFinite(v))
    ) {
      throw invalidInput(`${label} must be [x1, y1, x2, y2] with four numbers.`);
    }
    const box = entry as PercentBox;
    if (box.some((v) => v < 0 || v > 100)) {
      throw invalidInput(`${label} has values outside 0–100. Boxes are in percent of the image.`);
    }
    if (box[0] >= box[2] || box[1] >= box[3]) {
      throw invalidInput(`${label} must have x1 < x2 and y1 < y2.`);
    }
    return box;
  });

  return boxes;
}
