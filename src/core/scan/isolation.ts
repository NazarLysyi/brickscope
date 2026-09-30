import { percentToPixels } from "./geometry.js";
import type { Segmentation } from "./segment.js";
import type { PercentBox, PixelRect } from "./types.js";

/** A part belongs to a box when at least this share of its bounding box lies inside it. */
const OWNED_SHARE = 0.8;

export interface IsolationPlan {
  /** Per region (0-based): indices into `segmentation.parts` to paint out of its crop. */
  erase: Set<number>[];
  owners: number[];
  /** Per region: 1-based ids of the other regions whose parts get painted out. */
  paintedOut: number[][];
}

function area(r: PixelRect): number {
  return r.width * r.height;
}

function overlap(a: PixelRect, b: PixelRect): number {
  const w = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
  const h = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Decide which detected parts to paint out of each region's crop, so Brickognize sees one
 * part per crop. A part belongs to the smallest box that holds its centroid and most of it
 * (a pin lying inside a bent liftarm's box belongs to the pin's own box); a region's crop
 * paints out parts that belong to other regions. Parts that fit no single box (touching
 * parts, shadows) are left alone, and so are duplicate boxes, so a region never loses the
 * part it is about.
 */
export function planIsolation(
  segmentation: Segmentation,
  boxes: PercentBox[],
  cropBoxes: PercentBox[],
  duplicates: [number, number][],
): IsolationPlan {
  const size = { width: segmentation.width, height: segmentation.height };
  const regions = boxes.map((box) => percentToPixels(box, size));
  const crops = cropBoxes.map((box) => percentToPixels(box, size));
  const duplicate = new Set(
    duplicates.flatMap(([a, b]) => [`${a - 1}:${b - 1}`, `${b - 1}:${a - 1}`]),
  );

  const owners = segmentation.parts.map((part) => {
    let owner = -1;
    regions.forEach((region, index) => {
      const holdsCentroid =
        part.cx >= region.left &&
        part.cx < region.left + region.width &&
        part.cy >= region.top &&
        part.cy < region.top + region.height;
      const holdsMost = overlap(part.rect, region) >= OWNED_SHARE * area(part.rect);
      if (holdsCentroid && holdsMost && (owner < 0 || area(region) < area(regions[owner]))) {
        owner = index;
      }
    });
    return owner;
  });

  const countsIn = (rect: PixelRect) => {
    const counts = new Map<number, number>();
    for (let y = rect.top; y < rect.top + rect.height; y++) {
      for (let x = rect.left; x < rect.left + rect.width; x++) {
        const label = segmentation.labels[y * segmentation.width + x];
        if (label >= 0) counts.set(label, (counts.get(label) ?? 0) + 1);
      }
    }
    return counts;
  };
  // A region's own parts are those it owns. With none (its part merged with a neighbor into
  // one component), the largest component in the box still contains this target.
  const ownParts = regions.map((region, index) => {
    const owned = owners.flatMap((owner, part) => (owner === index ? [part] : []));
    if (owned.length > 0) return new Set(owned);
    const counts = countsIn(region);
    const largest = Math.max(0, ...counts.values());
    return new Set([...counts].filter(([, count]) => count === largest).map(([label]) => label));
  });
  const cropParts = crops.map(countsIn);

  const erase = regions.map(() => new Set<number>());
  const paintedOut = regions.map(() => new Set<number>());
  segmentation.parts.forEach((part, partIndex) => {
    const owner = owners[partIndex];
    if (owner < 0) return;
    crops.forEach((_crop, region) => {
      if (region === owner || duplicate.has(`${region}:${owner}`)) return;
      if (ownParts[region].has(partIndex) || !cropParts[region].has(partIndex)) return;
      erase[region].add(partIndex);
      paintedOut[region].add(owner + 1);
    });
  });

  return { erase, owners, paintedOut: paintedOut.map((ids) => [...ids].sort((a, b) => a - b)) };
}

export interface CropIsolation {
  /** Part labels at the segmentation's resolution. */
  labels: Int32Array;
  width: number;
  height: number;
  erase: Set<number>;
  onPaint?: (labels: Set<number>) => void;
}

/**
 * Paint the listed parts out of a raw RGB crop with the crop's own background color. The
 * crop is `rect` of an image `imageWidth`×`imageHeight`; labels are mapped onto it, grown
 * by one label pixel so part edges and fringes go too.
 */
export function paintOut(
  data: Uint8Array,
  rect: PixelRect,
  imageWidth: number,
  imageHeight: number,
  isolation: CropIsolation,
): void {
  const { labels, width: lw, height: lh, erase } = isolation;
  const sx = lw / imageWidth;
  const sy = lh / imageHeight;
  const labelAt = (x: number, y: number) => {
    const lx = Math.min(lw - 1, Math.floor((rect.left + x + 0.5) * sx));
    const ly = Math.min(lh - 1, Math.floor((rect.top + y + 0.5) * sy));
    return { lx, ly };
  };
  const painted = new Set<number>();
  const erased = (lx: number, ly: number) => {
    const own = labels[ly * lw + lx];
    if (own >= 0 && !erase.has(own)) return false;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = lx + dx;
        const y = ly + dy;
        if (x < 0 || y < 0 || x >= lw || y >= lh) continue;
        const label = labels[y * lw + x];
        if (erase.has(label)) {
          painted.add(label);
          return true;
        }
      }
    }
    return false;
  };

  const paint = new Uint8Array(rect.width * rect.height);
  const background: number[][] = [[], [], []];
  for (let y = 0; y < rect.height; y++) {
    for (let x = 0; x < rect.width; x++) {
      const { lx, ly } = labelAt(x, y);
      const i = y * rect.width + x;
      if (erased(lx, ly)) {
        paint[i] = 1;
      } else if (labels[ly * lw + lx] < 0 && i % 3 === 0) {
        for (let c = 0; c < 3; c++) background[c].push(data[i * 3 + c]);
      }
    }
  }

  const median = (values: number[]) => values.sort((a, b) => a - b)[values.length >> 1] ?? 0;
  const fill = background[0].length > 0 ? background.map(median) : [255, 255, 255];
  for (let i = 0; i < paint.length; i++) {
    if (paint[i]) data.set(fill, i * 3);
  }
  isolation.onPaint?.(painted);
}
