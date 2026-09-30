import { rgbToLab, type Lab3 } from "./color.js";
import { expandRect, percentToPixels } from "./geometry.js";
import type { Segmentation } from "./segment.js";
import type { PercentBox, PixelRect } from "./types.js";

/** A part belongs to a box when at least this share of its bounding box lies inside it. */
const OWNED_SHARE = 0.8;
/**
 * When touching parts are split between their boxes, each box also claims pixels up to this
 * share of its longer side outside it: boxes are drawn by eye and often a little tight.
 */
const CLAIM_MARGIN = 0.08;
/** Lightness counts half when splitting: shading changes it along one part, hue much less. */
const SPLIT_L_WEIGHT = 0.5;
/** A box's part color is the median of at least this many pixels only that box claims. */
const MIN_REFERENCE_PIXELS = 20;
/** A pixel claimed by several boxes seeds a part this many times closer to its color. */
const SEED_RATIO = 0.5;
/** Every box must end up with this share of a split component, or the split is dropped. */
const MIN_SPLIT_SHARE = 0.03;
/** Color costs are bucketed by whole ΔE units up to this value. */
const MAX_COST = 255;

export interface IsolationPlan {
  /**
   * Part labels per pixel at the segmentation's resolution: the segmentation's own, except
   * that a component split between boxes gets one new label per box.
   */
  labels: Int32Array;
  /** Per region (0-based): labels to paint out of its crop. */
  erase: Set<number>[];
  /** Per label: the region it belongs to, or -1. */
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
 * paints out parts that belong to other regions. Touching parts merge into one component;
 * when each has its own box, the component is split between those boxes (see
 * splitComponent). Parts that fit no single box (shadows, touching parts boxed together, a
 * part boxed inside a same-colored part's box) are left alone, and so are duplicate boxes,
 * so a region never loses the part it is about.
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

  const countsIn = (labels: Int32Array, rect: PixelRect) => {
    const counts = new Map<number, number>();
    for (let y = rect.top; y < rect.top + rect.height; y++) {
      for (let x = rect.left; x < rect.left + rect.width; x++) {
        const label = labels[y * segmentation.width + x];
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
    const counts = countsIn(segmentation.labels, region);
    const largest = Math.max(0, ...counts.values());
    return new Set([...counts].filter(([, count]) => count === largest).map(([label]) => label));
  });

  // A component that several boxes are about holds touching parts: give each box its piece.
  let labels = segmentation.labels;
  segmentation.parts.forEach((_part, partIndex) => {
    const claimants = regions.flatMap((_region, index) =>
      ownParts[index].has(partIndex) ? [index] : [],
    );
    if (claimants.length < 2) return;
    if (claimants.some((a) => claimants.some((b) => duplicate.has(`${a}:${b}`)))) return;
    const pieces = splitComponent(
      segmentation,
      partIndex,
      claimants.map((index) => regions[index]),
    );
    if (!pieces) return;
    if (labels === segmentation.labels) labels = Int32Array.from(labels);
    claimants.forEach((region, k) => {
      const piece = owners.push(region) - 1;
      for (const i of pieces[k]) labels[i] = piece;
      ownParts[region].delete(partIndex);
      ownParts[region].add(piece);
    });
    owners[partIndex] = -1;
  });
  const cropParts = crops.map((crop) => countsIn(labels, crop));

  const erase = regions.map(() => new Set<number>());
  const paintedOut = regions.map(() => new Set<number>());
  owners.forEach((owner, label) => {
    if (owner < 0) return;
    crops.forEach((_crop, region) => {
      if (region === owner || duplicate.has(`${region}:${owner}`)) return;
      if (ownParts[region].has(label) || !cropParts[region].has(label)) return;
      erase[region].add(label);
      paintedOut[region].add(owner + 1);
    });
  });

  return {
    labels,
    erase,
    owners,
    paintedOut: paintedOut.map((ids) => [...ids].sort((a, b) => a - b)),
  };
}

/**
 * Split one component between the boxes of the touching parts it holds, e.g. a gear lying
 * against a beam, both boxed. Returns the pixel indices for each box, or null when a box
 * would get next to nothing, e.g. a box inside another box on a part of the same color.
 *
 * Each box gets a reference color: the median of the pixels only it claims, or, for a box
 * inside another box (the gear's inside the beam's), of its half of pixels least like the
 * other parts. From seeds (pixels only one box claims, or clearly closer to the color of a
 * box without such pixels), each part grows over the component's core, cheapest color match
 * first, staying within its own claim. A pixel enclosed by one part can only be reached
 * through it, so the dark middle of a gear stays the gear's even though black is the closer
 * color. Where touching parts look alike, the growing goes by distance and meets midway.
 * The edge fringe (often shadow) goes to the nearest assigned pixel.
 */
function splitComponent(
  segmentation: Segmentation,
  label: number,
  regions: PixelRect[],
): number[][] | null {
  // Claims are bit flags per pixel.
  if (regions.length > 31) return null;
  const { width, image } = segmentation;
  const { left, top, width: w, height: h } = segmentation.parts[label].rect;
  // Everything below works in the component's bounding box: index i ↔ pixel (left + x, top + y).
  const n = w * h;
  const global = (i: number) => (top + Math.floor(i / w)) * width + left + (i % w);

  const inPart = new Uint8Array(n);
  let size = 0;
  for (let i = 0; i < n; i++) {
    if (segmentation.labels[global(i)] === label) {
      inPart[i] = 1;
      size++;
    }
  }

  const claims = regions.map((region) => expandRect(region, CLAIM_MARGIN, segmentation));
  const claimed = new Uint32Array(n);
  const lab = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    if (!inPart[i]) continue;
    const x = left + (i % w);
    const y = top + Math.floor(i / w);
    claims.forEach((c, k) => {
      if (x >= c.left && x < c.left + c.width && y >= c.top && y < c.top + c.height) {
        claimed[i] |= 1 << k;
      }
    });
    const p = global(i) * 3;
    lab.set(rgbToLab(image.data[p], image.data[p + 1], image.data[p + 2]), i * 3);
  }

  // The core leaves out the edge fringe, which is often shadow or blended with the surface.
  const core: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!inPart[i]) continue;
    const x = i % w;
    const y = Math.floor(i / w);
    let inner = x > 0 && y > 0 && x < w - 1 && y < h - 1;
    for (let dy = -1; dy <= 1 && inner; dy++) {
      for (let dx = -1; dx <= 1 && inner; dx++) inner = inPart[i + dy * w + dx] === 1;
    }
    if (inner) core.push(i);
  }

  const distance = (i: number, ref: Lab3) =>
    Math.hypot(
      SPLIT_L_WEIGHT * (lab[i * 3] - ref[0]),
      lab[i * 3 + 1] - ref[1],
      lab[i * 3 + 2] - ref[2],
    );
  const medianLab = (pixels: number[]): Lab3 => {
    const channel = (c: number) => {
      const values = Float32Array.from(pixels, (i) => lab[i * 3 + c]).sort();
      return values[values.length >> 1];
    };
    return [channel(0), channel(1), channel(2)];
  };

  const refs: (Lab3 | null)[] = regions.map((_region, k) => {
    const exclusive = core.filter((i) => claimed[i] === 1 << k);
    return exclusive.length >= MIN_REFERENCE_PIXELS ? medianLab(exclusive) : null;
  });
  const hasExclusive = refs.map((ref) => ref !== null);
  const known = refs.filter((ref): ref is Lab3 => ref !== null);
  if (known.length === 0) return null;
  for (let k = 0; k < regions.length; k++) {
    if (refs[k]) continue;
    const unlikeOthers = core
      .filter((i) => claimed[i] & (1 << k))
      .map((i) => ({ i, d: Math.min(...known.map((ref) => distance(i, ref))) }))
      .sort((a, b) => b.d - a.d);
    const half = unlikeOthers.slice(0, unlikeOthers.length >> 1).map(({ i }) => i);
    if (half.length < MIN_REFERENCE_PIXELS / 2) return null;
    refs[k] = medianLab(half);
  }
  const colors = refs as Lab3[];

  // Seeded region growing over the core: a bucket queue by color cost, where a pixel goes to
  // the first part that pops it, i.e. the cheapest one that reached it.
  const UNASSIGNED = -1;
  const owner = new Int32Array(n).fill(UNASSIGNED);
  const isCore = new Uint8Array(n);
  for (const i of core) isCore[i] = 1;
  const buckets: number[][] = Array.from({ length: MAX_COST + 1 }, () => []);
  const cost = (i: number, k: number) => Math.min(MAX_COST, Math.round(distance(i, colors[k])));
  for (const i of core) {
    const flags = claimed[i];
    if (flags === 0) continue;
    let seed = -1;
    if ((flags & (flags - 1)) === 0) {
      seed = 31 - Math.clz32(flags);
    } else {
      let best = -1;
      let bestD = Infinity;
      let secondD = Infinity;
      for (let k = 0; k < regions.length; k++) {
        if (!(flags & (1 << k))) continue;
        const d = distance(i, colors[k]);
        if (d < bestD) {
          secondD = bestD;
          bestD = d;
          best = k;
        } else if (d < secondD) {
          secondD = d;
        }
      }
      // Only a box without pixels of its own (one box inside another) needs color seeds.
      if (!hasExclusive[best] && bestD < SEED_RATIO * secondD) seed = best;
    }
    if (seed >= 0) buckets[cost(i, seed)].push(i, seed);
  }
  const neighbors = (i: number) => {
    const x = i % w;
    return [
      x > 0 ? i - 1 : -1,
      x < w - 1 ? i + 1 : -1,
      i >= w ? i - w : -1,
      i + w < n ? i + w : -1,
    ];
  };
  for (let b = 0; b <= MAX_COST; b++) {
    const queue = buckets[b];
    for (let q = 0; q < queue.length; q += 2) {
      const i = queue[q];
      const k = queue[q + 1];
      if (owner[i] !== UNASSIGNED) continue;
      owner[i] = k;
      for (const j of neighbors(i)) {
        if (j < 0 || !isCore[j] || owner[j] !== UNASSIGNED) continue;
        if (claimed[j] !== 0 && !(claimed[j] & (1 << k))) continue;
        buckets[Math.max(b, cost(j, k))].push(j, k);
      }
    }
  }

  // The fringe and anything the growing missed: nearest assigned pixel.
  const frontier: number[] = [];
  for (let i = 0; i < n; i++) if (owner[i] !== UNASSIGNED) frontier.push(i);
  for (let head = 0; head < frontier.length; head++) {
    const i = frontier[head];
    for (const j of neighbors(i)) {
      if (j < 0 || !inPart[j] || owner[j] !== UNASSIGNED) continue;
      owner[j] = owner[i];
      frontier.push(j);
    }
  }

  const pieces: number[][] = regions.map(() => []);
  for (let i = 0; i < n; i++) {
    if (inPart[i] && owner[i] !== UNASSIGNED) pieces[owner[i]].push(global(i));
  }
  if (pieces.some((piece) => piece.length < MIN_SPLIT_SHARE * size)) return null;
  return pieces;
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
