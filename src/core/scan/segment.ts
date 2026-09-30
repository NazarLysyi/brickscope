import { deltaE, type Lab3 } from "./color.js";
import { DETECTION_DEFAULTS, type DetectionSettings } from "./options.js";
import type { PixelRect, RgbImage } from "./types.js";

/**
 * Local, model-free part detection for photos of parts on a fairly plain background.
 *
 * Background model, in two passes:
 * 1. A smooth surface (up to quadratic, per Lab channel) fitted robustly to per-cell
 *    medians. Cells dominated by parts are rejected as outliers, so large, low-contrast
 *    or edge-touching parts don't leak into the background, while gradual lighting
 *    changes such as vignetting are followed. Several candidate backgrounds are tried
 *    (the border color and the largest color groups) and the one that yields the most
 *    plausible parts wins, so a table around a sheet of paper, many same-colored parts
 *    or a large part on a gradient don't swap background and parts.
 * 2. Per-cell medians of the pixels pass 1 did not flag, for local lighting detail; cells
 *    covered by parts fall back to the surface.
 *
 * It only proposes regions: known misses (white-on-white, transparent parts, parts that
 * touch each other, textured backgrounds, hard shadows) are left to the reviewing agent,
 * so nothing here merges or discards regions aggressively. Instead each region carries
 * flags that the caller turns into warnings.
 */

export interface DetectedRect extends PixelRect {
  touchesBorder: boolean;
  /** Suspiciously large: may be several touching parts or background. */
  large: boolean;
  /** Mean Lab color of the region's foreground pixels. */
  color: Lab3;
}

/** A detected part's pixels, for painting parts out of each other's crops. */
export interface DetectedPart {
  rect: PixelRect;
  /** Centroid of its pixels. */
  cx: number;
  cy: number;
}

export interface Segmentation {
  /** Regions in reading order: rows top to bottom, left to right within a row. */
  rects: DetectedRect[];
  backgroundUniform: boolean;
  /** Background color at the image center. */
  backgroundColor: Lab3;
  width: number;
  height: number;
  /** Every detected part, in no particular order. */
  parts: DetectedPart[];
  /** Per pixel: index into `parts` of the part covering it, or -1. */
  labels: Int32Array;
}

const MIN_AREA_PX = 16;
/** Border ring width as a fraction of the shorter side, used for the initial background color. */
const BORDER_RATIO = 0.03;
/** Background cells per shorter side. */
const CELLS_PER_SIDE = 8;
/** A cell needs this share of unflagged pixels for its own pass-2 background estimate. */
const MIN_BACKGROUND_SHARE = 0.25;
/** Cells within this ΔE of each other form the color groups that seed the surface fits. */
const SEED_DELTA_E = 10;
/** Color groups tried as background candidates, besides the border color. */
const MAX_COLOR_SEEDS = 3;
/** A color group needs this share of the cells to be a background candidate. */
const MIN_SEED_SHARE = 0.1;
/** Enclosed "holes" larger than this share of the image are a frame's inside, not holes. */
const MAX_HOLE_SHARE = 0.3;
/** Cells within max(this, 3 × typical residual) of the surface count as background. */
const MIN_SURFACE_RESIDUAL = 5;
const SURFACE_ITERATIONS = 6;
/** The noise-based foreground threshold never goes above this (ΔE); minContrast can. */
const MAX_NOISE_DELTA_E = 40;
/** Background noise (90th percentile ΔE of background pixels) above which it is not uniform. */
const UNIFORM_NOISE_P90 = 12;
/** Typical within-cell color spread (interquartile ΔE) above which the background is textured. */
const UNIFORM_CELL_SPREAD = 8;
/** p90 ≈ 1.6 × p50 for the ΔE of plain noise; the median survives heavy contamination by parts. */
const P90_PER_MEDIAN = 1.6;
/** Every n-th pixel is enough for noise statistics. */
const NOISE_SAMPLE_STRIDE = 7;
const LARGE_IMAGE_FRACTION = 0.25;
const LARGE_MEDIAN_FACTOR = 4;

export function segmentParts(
  image: RgbImage,
  settings: DetectionSettings = DETECTION_DEFAULTS,
): Segmentation {
  const { width, height } = image;
  const pixelCount = width * height;
  const lab = toLab(image);
  const grid = makeGrid(width, height);
  const borderColor = medianOf(lab, borderIndices(width, height));

  const minArea = Math.max(MIN_AREA_PX, (settings.minPartSize / 100) * pixelCount);

  // Pass 1: robust smooth surface for each background candidate; keep the candidate that
  // yields the most plausible parts (then the one the most cells agree with).
  const { cells: plainCells, spreads } = cellStats(lab, grid, null, true);
  const fits = candidateFits(plainCells, grid, borderColor);
  let best: { fit: Fit; field: LabImage; coarse: Uint8Array; score: number } | null = null;
  for (const fit of fits) {
    const field = evaluateSurface(fit.surface, width, height);
    const coarseDistance = distanceField(lab, field);
    const outlierCells = cellMask(grid, width, height, (cell) => !fit.inliers.has(cell));
    const noise = sampledPercentile(coarseDistance, outlierCells, 0.5) ?? 0;
    const coarse = threshold(coarseDistance, P90_PER_MEDIAN * noise, width, height, settings);
    const score = fits.length > 1 ? plausibleParts(coarse, width, height, minArea) : 0;
    if (!best || score > best.score) best = { fit, field, coarse, score };
  }
  const { fit, field: surfaceField, coarse } = best!;
  const surface = fit.surface;
  // Texture is judged on the background cells only: part edges inflate the other cells.
  const textured =
    median(
      Float32Array.from(
        fit.inliers.size > 0 ? fit.inliers : spreads.keys(),
        (cell) => spreads[cell],
      ),
    ) > UNIFORM_CELL_SPREAD;

  // Pass 2: the surface plus smoothed local residuals of the pixels that look like background.
  const excluded = dilate(
    fillHoles(coarse, width, height),
    width,
    height,
    Math.ceil(grid.cellSize / 8),
  );
  const residuals = residualCells(cellStats(lab, grid, excluded, false).cells, grid, surface);
  const background = addFields(
    surfaceField,
    interpolateCells(medianFilterCells(residuals, grid), grid, width, height),
  );
  const distance = distanceField(lab, background);
  const noise = sampledPercentile(distance, excluded, 0.9);
  const mask = threshold(distance, noise ?? 0, width, height, settings);

  const labels = new Int32Array(pixelCount);
  const all = connectedComponents(mask, width, height, labels);
  // Keep parts big enough; relabel so labels index `components`, with -1 for everything else.
  const renumber = new Int32Array(all.length).fill(-1);
  const components: Component[] = [];
  all.forEach((c, index) => {
    if (c.area < minArea) return;
    renumber[index] = components.length;
    components.push(c);
  });
  for (let i = 0; i < pixelCount; i++) {
    if (labels[i] >= 0) labels[i] = renumber[labels[i]];
  }

  const boxAreas = components.map((c) => c.width * c.height).sort((a, b) => a - b);
  const medianBoxArea = boxAreas[Math.floor(boxAreas.length / 2)] ?? 0;

  const rects: DetectedRect[] = components.map(({ left, top, width: w, height: h }, label) => ({
    left,
    top,
    width: w,
    height: h,
    touchesBorder: left === 0 || top === 0 || left + w === width || top + h === height,
    large:
      w * h > LARGE_IMAGE_FRACTION * pixelCount ||
      (components.length >= 3 && w * h > LARGE_MEDIAN_FACTOR * medianBoxArea),
    color: meanColor(lab, labels, label, { left, top, width: w, height: h }),
  }));

  return {
    rects: readingOrder(rects),
    // No background pixels left to measure (parts fill the frame) counts as not uniform.
    backgroundUniform: !textured && noise !== null && noise <= UNIFORM_NOISE_P90,
    backgroundColor: surfaceAt(surface, 0, 0),
    width,
    height,
    parts: components.map(({ left, top, width: w, height: h, cx, cy }) => ({
      rect: { left, top, width: w, height: h },
      cx,
      cy,
    })),
    labels,
  };
}

/** Mean Lab of this component only, even when another lies inside its bounding box. */
function meanColor(lab: LabImage, labels: Int32Array, label: number, rect: PixelRect): Lab3 {
  const sum: Lab3 = [0, 0, 0];
  let n = 0;
  for (let y = rect.top; y < rect.top + rect.height; y++) {
    for (let x = rect.left; x < rect.left + rect.width; x++) {
      const i = y * lab.width + x;
      if (labels[i] !== label) continue;
      sum[0] += lab.l[i];
      sum[1] += lab.a[i];
      sum[2] += lab.b[i];
      n++;
    }
  }
  return n === 0 ? sum : [sum[0] / n, sum[1] / n, sum[2] / n];
}

/** Pixels farther than the noise level allows from the background, cleaned up. */
function threshold(
  distance: Float32Array,
  noiseP90: number,
  width: number,
  height: number,
  settings: DetectionSettings,
) {
  const limit = Math.max(settings.minContrast, Math.min(MAX_NOISE_DELTA_E, noiseP90 * 1.5));
  let mask: Uint8Array = new Uint8Array(distance.length);
  for (let i = 0; i < distance.length; i++) mask[i] = distance[i] > limit ? 1 : 0;

  // Open removes specks; close bridges small gaps inside a single part.
  // A closing of radius r bridges gaps up to 2r wide.
  const gap = (settings.joinGap / 100) * Math.min(width, height);
  const closeRadius = settings.joinGap > 0 ? Math.max(1, Math.round(gap / 2)) : 0;
  mask = dilate(erode(mask, width, height, 1), width, height, 1);
  if (closeRadius === 0) return mask;
  return erode(dilate(mask, width, height, closeRadius), width, height, closeRadius);
}

/** Components that look like parts: big enough, inside the frame and not huge. */
function plausibleParts(mask: Uint8Array, width: number, height: number, minArea: number): number {
  return connectedComponents(mask, width, height).filter(
    (c) =>
      c.area >= minArea &&
      c.left > 0 &&
      c.top > 0 &&
      c.left + c.width < width &&
      c.top + c.height < height &&
      c.width * c.height <= LARGE_IMAGE_FRACTION * width * height,
  ).length;
}

/** Percentile of every n-th value, skipping positions set in `skip`; null if none remain. */
function sampledPercentile(
  values: Float32Array,
  skip: Uint8Array | null,
  p: number,
): number | null {
  const sample = new Float32Array(Math.ceil(values.length / NOISE_SAMPLE_STRIDE));
  let n = 0;
  for (let i = 0; i < values.length; i += NOISE_SAMPLE_STRIDE) {
    if (!skip?.[i]) sample[n++] = values[i];
  }
  if (n === 0) return null;
  return select(sample.subarray(0, n), Math.min(n - 1, Math.floor(n * p)));
}

// ---------------------------------------------------------------------------
// Color
// ---------------------------------------------------------------------------

interface LabImage {
  l: Float32Array;
  a: Float32Array;
  b: Float32Array;
  width: number;
  height: number;
}

const SRGB_TO_LINEAR = Float32Array.from({ length: 256 }, (_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});

function labF(t: number): number {
  return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
}

/** sRGB → CIE Lab (D65). */
function toLab({ data, width, height }: RgbImage): LabImage {
  const n = width * height;
  const l = new Float32Array(n);
  const a = new Float32Array(n);
  const b = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const r = SRGB_TO_LINEAR[data[i * 3]];
    const g = SRGB_TO_LINEAR[data[i * 3 + 1]];
    const bl = SRGB_TO_LINEAR[data[i * 3 + 2]];

    const fx = labF((0.4124 * r + 0.3576 * g + 0.1805 * bl) / 0.95047);
    const fy = labF(0.2126 * r + 0.7152 * g + 0.0722 * bl);
    const fz = labF((0.0193 * r + 0.1192 * g + 0.9505 * bl) / 1.08883);

    l[i] = 116 * fy - 16;
    a[i] = 500 * (fx - fy);
    b[i] = 200 * (fy - fz);
  }

  return { l, a, b, width, height };
}

function borderIndices(width: number, height: number): Int32Array {
  const ring = Math.max(2, Math.round(Math.min(width, height) * BORDER_RATIO));
  const indices = new Int32Array(width * height);
  let n = 0;
  for (let y = 0; y < height; y++) {
    const inBand = y < ring || y >= height - ring;
    for (let x = 0; x < width; x++) {
      if (inBand || x < ring || x >= width - ring) indices[n++] = y * width + x;
    }
  }
  return indices.subarray(0, n);
}

/**
 * The k-th smallest value, found by quickselect. Reorders `values` in place so that
 * everything before index k is ≤ values[k] ≤ everything after it.
 */
function select(values: Float32Array, k: number): number {
  let lo = 0;
  let hi = values.length - 1;
  while (hi > lo) {
    const pivot = values[(lo + hi) >> 1];
    let i = lo;
    let j = hi;
    while (i <= j) {
      while (values[i] < pivot) i++;
      while (values[j] > pivot) j--;
      if (i <= j) {
        const swap = values[i];
        values[i] = values[j];
        values[j] = swap;
        i++;
        j--;
      }
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else break;
  }
  return values[k];
}

/** In-place median of a scratch buffer's first n values (0 when empty). */
function median(values: Float32Array, n = values.length): number {
  return n === 0 ? 0 : select(values.subarray(0, n), Math.floor(n / 2));
}

function medianOf(lab: LabImage, indices: Int32Array): Lab3 {
  const scratch = new Float32Array(indices.length);
  return [lab.l, lab.a, lab.b].map((channel) => {
    for (let k = 0; k < indices.length; k++) scratch[k] = channel[indices[k]];
    return median(scratch);
  }) as Lab3;
}

/** CIE76 ΔE of every pixel to the background at the same position. */
function distanceField(lab: LabImage, background: LabImage): Float32Array {
  const n = lab.l.length;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const dl = lab.l[i] - background.l[i];
    const da = lab.a[i] - background.a[i];
    const db = lab.b[i] - background.b[i];
    out[i] = Math.sqrt(dl * dl + da * da + db * db);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Background cells
// ---------------------------------------------------------------------------

interface Grid {
  cols: number;
  rows: number;
  cellWidth: number;
  cellHeight: number;
  cellSize: number;
}

/** Per-cell Lab values; NaN marks a cell without an estimate. */
type Cells = [Float32Array, Float32Array, Float32Array];

function makeGrid(width: number, height: number): Grid {
  const cellSize = Math.max(8, Math.min(width, height) / CELLS_PER_SIDE);
  const cols = Math.max(1, Math.round(width / cellSize));
  const rows = Math.max(1, Math.round(height / cellSize));
  return { cols, rows, cellWidth: width / cols, cellHeight: height / rows, cellSize };
}

function cellBounds(grid: Grid, cell: number) {
  const row = Math.floor(cell / grid.cols);
  const col = cell % grid.cols;
  return {
    x0: Math.round(col * grid.cellWidth),
    x1: Math.round((col + 1) * grid.cellWidth),
    y0: Math.round(row * grid.cellHeight),
    y1: Math.round((row + 1) * grid.cellHeight),
  };
}

/** Center of a cell in normalized coordinates (-0.5..0.5). */
function cellCenter(grid: Grid, cell: number): [number, number] {
  const row = Math.floor(cell / grid.cols);
  const col = cell % grid.cols;
  return [(col + 0.5) / grid.cols - 0.5, (row + 0.5) / grid.rows - 0.5];
}

/**
 * Median Lab per cell over non-excluded pixels (NaN where too few pixels remain), and each
 * cell's color spread: the interquartile ranges of its channels combined as a ΔE.
 */
function cellStats(
  lab: LabImage,
  grid: Grid,
  excluded: Uint8Array | null,
  withSpread: boolean,
): { cells: Cells; spreads: Float32Array } {
  const count = grid.cols * grid.rows;
  const cells: Cells = [new Float32Array(count), new Float32Array(count), new Float32Array(count)];
  const spreads = new Float32Array(count);
  const iqr = new Float32Array(3);
  const channels = [lab.l, lab.a, lab.b];
  const scratch = channels.map(
    () => new Float32Array(Math.ceil(grid.cellWidth + 1) * Math.ceil(grid.cellHeight + 1)),
  );

  for (let cell = 0; cell < count; cell++) {
    const { x0, x1, y0, y1 } = cellBounds(grid, cell);
    let n = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = y * lab.width + x;
        if (excluded?.[i]) continue;
        scratch[0][n] = lab.l[i];
        scratch[1][n] = lab.a[i];
        scratch[2][n] = lab.b[i];
        n++;
      }
    }
    const enough = n > 0 && n >= MIN_BACKGROUND_SHARE * (x1 - x0) * (y1 - y0);
    for (let c = 0; c < 3; c++) {
      if (!enough) {
        cells[c][cell] = Number.NaN;
        iqr[c] = 0;
        continue;
      }
      const values = scratch[c].subarray(0, n);
      const mid = Math.floor(n / 2);
      cells[c][cell] = select(values, mid);
      // After select(), the lower quartile is left of mid and the upper one right of it.
      const q1 = Math.floor(n / 4);
      const q3 = Math.floor((3 * n) / 4);
      iqr[c] =
        withSpread && q1 < mid && q3 > mid
          ? select(values.subarray(mid + 1), q3 - mid - 1) - select(values.subarray(0, mid), q1)
          : 0;
    }
    spreads[cell] = Math.hypot(iqr[0], iqr[1], iqr[2]);
  }

  return { cells, spreads };
}

function cellValue(cells: Cells, cell: number): Lab3 {
  return [cells[0][cell], cells[1][cell], cells[2][cell]];
}

/** Per-cell difference from the surface at the cell center; 0 where a cell has no estimate. */
function residualCells(cells: Cells, grid: Grid, surface: Surface): Cells {
  const out: Cells = [
    new Float32Array(cells[0].length),
    new Float32Array(cells[0].length),
    new Float32Array(cells[0].length),
  ];
  for (let cell = 0; cell < cells[0].length; cell++) {
    if (Number.isNaN(cells[0][cell])) continue;
    const expected = surfaceAt(surface, ...cellCenter(grid, cell));
    for (let c = 0; c < 3; c++) out[c][cell] = cells[c][cell] - expected[c];
  }
  return out;
}

/** A per-pixel mask of the cells selected by `pick`. */
function cellMask(
  grid: Grid,
  width: number,
  height: number,
  pick: (cell: number) => boolean,
): Uint8Array {
  const mask = new Uint8Array(width * height);
  for (let cell = 0; cell < grid.cols * grid.rows; cell++) {
    if (!pick(cell)) continue;
    const { x0, x1, y0, y1 } = cellBounds(grid, cell);
    for (let y = y0; y < y1; y++) mask.fill(1, y * width + x0, y * width + x1);
  }
  return mask;
}

function addFields(a: LabImage, b: LabImage): LabImage {
  const sum = (x: Float32Array, y: Float32Array) => {
    const out = new Float32Array(x.length);
    for (let i = 0; i < x.length; i++) out[i] = x[i] + y[i];
    return out;
  };
  return { l: sum(a.l, b.l), a: sum(a.a, b.a), b: sum(a.b, b.b), width: a.width, height: a.height };
}

/** 3×3 median filter over the cell grid, clipped at the edges. */
function medianFilterCells(cells: Cells, grid: Grid): Cells {
  const scratch = new Float32Array(9);
  return cells.map((channel) =>
    Float32Array.from(channel, (_, cell) => {
      const row = Math.floor(cell / grid.cols);
      const col = cell % grid.cols;
      let n = 0;
      for (let r = Math.max(0, row - 1); r <= Math.min(grid.rows - 1, row + 1); r++) {
        for (let c = Math.max(0, col - 1); c <= Math.min(grid.cols - 1, col + 1); c++) {
          scratch[n++] = channel[r * grid.cols + c];
        }
      }
      return median(scratch, n);
    }),
  ) as Cells;
}

/** Bilinear interpolation between cell centers, clamped at the edges. */
function interpolateCells(cells: Cells, grid: Grid, width: number, height: number): LabImage {
  const axis = (length: number, cell: number, count: number) =>
    Array.from({ length }, (_, p) => {
      const g = Math.min(Math.max((p + 0.5) / cell - 0.5, 0), count - 1);
      const i0 = Math.floor(g);
      return { i0, i1: Math.min(i0 + 1, count - 1), t: g - i0 };
    });
  const xs = axis(width, grid.cellWidth, grid.cols);
  const ys = axis(height, grid.cellHeight, grid.rows);

  const [l, a, b] = cells.map((channel) => {
    const out = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
      const { i0: r0, i1: r1, t: ty } = ys[y];
      for (let x = 0; x < width; x++) {
        const { i0: c0, i1: c1, t: tx } = xs[x];
        const top = channel[r0 * grid.cols + c0] * (1 - tx) + channel[r0 * grid.cols + c1] * tx;
        const bottom = channel[r1 * grid.cols + c0] * (1 - tx) + channel[r1 * grid.cols + c1] * tx;
        out[y * width + x] = top * (1 - ty) + bottom * ty;
      }
    }
    return out;
  });

  return { l, a, b, width, height };
}

// ---------------------------------------------------------------------------
// Robust background surface: least squares on cell medians, iteratively trimmed
// ---------------------------------------------------------------------------

interface Surface {
  /** Polynomial coefficients per Lab channel over [1, u, v, u², uv, v²] (prefix by term count). */
  coefficients: [number[], number[], number[]];
}

function basis(u: number, v: number, terms: number): number[] {
  return [1, u, v, u * u, u * v, v * v].slice(0, terms);
}

function surfaceAt(surface: Surface, u: number, v: number): Lab3 {
  return surface.coefficients.map((coefficients) =>
    basis(u, v, coefficients.length).reduce((sum, t, k) => sum + t * coefficients[k], 0),
  ) as Lab3;
}

function constantSurface(color: Lab3): Surface {
  return { coefficients: [[color[0]], [color[1]], [color[2]]] };
}

interface Fit {
  surface: Surface;
  inliers: Set<number>;
}

/**
 * Background candidates: surfaces grown from the border color and from the largest
 * disjoint color groups, deduplicated by the cells they end up accepting.
 */
function candidateFits(cells: Cells, grid: Grid, borderColor: Lab3): Fit[] {
  const valid = Array.from(cells[0].keys()).filter((cell) => !Number.isNaN(cells[0][cell]));
  const seeds: number[][] = [];
  const border = valid.filter(
    (cell) => deltaE(cellValue(cells, cell), borderColor) <= SEED_DELTA_E,
  );
  if (border.length >= 3) seeds.push(border);

  let remaining = valid;
  for (let k = 0; k < MAX_COLOR_SEEDS; k++) {
    const group = largestColorGroup(cells, remaining, borderColor);
    if (group.length < Math.max(3, MIN_SEED_SHARE * valid.length)) break;
    seeds.push(group);
    const taken = new Set(group);
    remaining = remaining.filter((cell) => !taken.has(cell));
  }
  if (seeds.length === 0) seeds.push(valid);

  const fits: Fit[] = [];
  for (const seed of seeds) {
    const fit = fitSurface(cells, grid, valid, seed, borderColor);
    const duplicate = fits.some(
      (f) => f.inliers.size === fit.inliers.size && [...fit.inliers].every((c) => f.inliers.has(c)),
    );
    if (!duplicate) fits.push(fit);
  }
  return fits;
}

/**
 * Fit the background as a smooth surface, starting from a seed group of cells and
 * alternating fit / re-selecting cells within a robust residual bound. Cells covered by
 * parts are outliers and drop out.
 */
function fitSurface(
  cells: Cells,
  grid: Grid,
  valid: number[],
  seed: number[],
  borderColor: Lab3,
): Fit {
  let inliers = seed.length >= 3 ? seed : valid;
  if (inliers.length === 0) {
    return { surface: constantSurface(borderColor), inliers: new Set(valid) };
  }

  let surface = constantSurface(borderColor);
  for (let iteration = 0; iteration < SURFACE_ITERATIONS; iteration++) {
    surface = leastSquaresSurface(cells, grid, inliers);
    const residual = (cell: number) =>
      deltaE(cellValue(cells, cell), surfaceAt(surface, ...cellCenter(grid, cell)));
    const typical = median(Float32Array.from(inliers, residual));
    const limit = Math.max(MIN_SURFACE_RESIDUAL, 3 * typical);
    const next = valid.filter((cell) => residual(cell) <= limit);
    if (next.length < 3 || sameCells(next, inliers)) break;
    inliers = next;
  }
  return { surface, inliers: new Set(inliers) };
}

/**
 * The largest group of cells within SEED_DELTA_E of one cell's color. Ties go to the group
 * closest to the border color.
 */
function largestColorGroup(cells: Cells, valid: number[], borderColor: Lab3): number[] {
  let best: number[] = [];
  let bestToBorder = Infinity;
  for (const center of valid) {
    const color = cellValue(cells, center);
    const group = valid.filter((cell) => deltaE(cellValue(cells, cell), color) <= SEED_DELTA_E);
    const toBorder = deltaE(color, borderColor);
    if (group.length > best.length || (group.length === best.length && toBorder < bestToBorder)) {
      best = group;
      bestToBorder = toBorder;
    }
  }
  return best;
}

function sameCells(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((cell, i) => cell === b[i]);
}

/**
 * Quadratic when the cells cover enough of the grid, else linear or constant (a curved fit
 * through a narrow band of cells extrapolates wildly); drops order if singular.
 */
function leastSquaresSurface(cells: Cells, grid: Grid, inliers: number[]): Surface {
  // Split the grid into 3×3 zones; a quadratic needs inliers in most of them.
  const zones = new Set(
    inliers.map(
      (cell) =>
        Math.floor((Math.floor(cell / grid.cols) * 3) / grid.rows) * 3 +
        Math.floor(((cell % grid.cols) * 3) / grid.cols),
    ),
  );

  for (const terms of [6, 3, 1]) {
    if (terms > 1 && inliers.length < terms * 2) continue;
    if (terms === 6 && zones.size < 7) continue;
    const rows = inliers.map((cell) => basis(...cellCenter(grid, cell), terms));
    const coefficients = cells.map((channel) =>
      solveNormalEquations(
        rows,
        inliers.map((cell) => channel[cell]),
      ),
    );
    if (coefficients.every((c) => c !== null)) {
      return { coefficients: coefficients as [number[], number[], number[]] };
    }
  }
  const mean = (channel: Float32Array) =>
    inliers.reduce((sum, cell) => sum + channel[cell], 0) / inliers.length;
  return constantSurface([mean(cells[0]), mean(cells[1]), mean(cells[2])]);
}

/** Solve (AᵀA)x = Aᵀy by Gaussian elimination with partial pivoting; null if singular. */
function solveNormalEquations(rows: number[][], y: number[]): number[] | null {
  const n = rows[0].length;
  const m = Array.from({ length: n }, () => new Array<number>(n + 1).fill(0));
  rows.forEach((row, r) => {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) m[i][j] += row[i] * row[j];
      m[i][n] += row[i] * y[r];
    }
  });

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    }
    if (Math.abs(m[pivot][col]) < 1e-9) return null;
    [m[col], m[pivot]] = [m[pivot], m[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = m[r][col] / m[col][col];
      for (let c = col; c <= n; c++) m[r][c] -= factor * m[col][c];
    }
  }

  return m.map((row, i) => row[n] / row[i]);
}

function evaluateSurface(surface: Surface, width: number, height: number): LabImage {
  const [l, a, b] = surface.coefficients.map((coefficients) => {
    const out = new Float32Array(width * height);
    const [c0, c1 = 0, c2 = 0, c3 = 0, c4 = 0, c5 = 0] = coefficients;
    for (let y = 0; y < height; y++) {
      const v = (y + 0.5) / height - 0.5;
      for (let x = 0; x < width; x++) {
        const u = (x + 0.5) / width - 0.5;
        out[y * width + x] = c0 + c1 * u + c2 * v + c3 * u * u + c4 * u * v + c5 * v * v;
      }
    }
    return out;
  });
  return { l, a, b, width, height };
}

// ---------------------------------------------------------------------------
// Morphology (square structuring element, separable, out-of-image pixels ignored)
// ---------------------------------------------------------------------------

/** One separable pass of dilation (any set in window) or erosion (all set in window). */
function morphPass(
  src: Uint8Array,
  width: number,
  height: number,
  radius: number,
  horizontal: boolean,
  erosion: boolean,
): Uint8Array {
  const out = new Uint8Array(src.length);
  const lines = horizontal ? height : width;
  const length = horizontal ? width : height;
  const step = horizontal ? 1 : width;
  const prefix = new Int32Array(length + 1);

  for (let line = 0; line < lines; line++) {
    const base = horizontal ? line * width : line;
    for (let k = 0; k < length; k++) prefix[k + 1] = prefix[k] + src[base + k * step];
    for (let k = 0; k < length; k++) {
      const lo = Math.max(0, k - radius);
      const hi = Math.min(length - 1, k + radius);
      const sum = prefix[hi + 1] - prefix[lo];
      out[base + k * step] = (erosion ? sum === hi - lo + 1 : sum > 0) ? 1 : 0;
    }
  }

  return out;
}

function dilate(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const rows = morphPass(mask, width, height, radius, true, false);
  return morphPass(rows, width, height, radius, false, false);
}

function erode(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const rows = morphPass(mask, width, height, radius, true, true);
  return morphPass(rows, width, height, radius, false, true);
}

/**
 * Set background pixels that are not reachable from the image edge (holes inside parts).
 * If the "holes" cover much of the image, the mask is a frame around the background (a
 * table around a sheet of paper), and its inside is left alone.
 */
function fillHoles(mask: Uint8Array, width: number, height: number): Uint8Array {
  const outside = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  let tail = 0;
  const visit = (i: number) => {
    if (!mask[i] && !outside[i]) {
      outside[i] = 1;
      queue[tail++] = i;
    }
  };

  for (let x = 0; x < width; x++) {
    visit(x);
    visit((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    visit(y * width);
    visit(y * width + width - 1);
  }
  for (let head = 0; head < tail; head++) {
    const i = queue[head];
    const x = i % width;
    if (x > 0) visit(i - 1);
    if (x < width - 1) visit(i + 1);
    if (i >= width) visit(i - width);
    if (i < mask.length - width) visit(i + width);
  }

  const filled = new Uint8Array(mask.length);
  let holes = 0;
  for (let i = 0; i < mask.length; i++) {
    filled[i] = outside[i] ? 0 : 1;
    if (filled[i] && !mask[i]) holes++;
  }
  return holes > MAX_HOLE_SHARE * mask.length ? mask : filled;
}

// ---------------------------------------------------------------------------
// Components and ordering
// ---------------------------------------------------------------------------

interface Component extends PixelRect {
  area: number;
  cx: number;
  cy: number;
}

/**
 * 8-connected components of a binary mask, via an explicit queue (no recursion). If
 * `labels` is given, each pixel gets its component's index (-1 for background).
 */
function connectedComponents(
  mask: Uint8Array,
  width: number,
  height: number,
  labels?: Int32Array,
): Component[] {
  labels?.fill(-1);
  const visited = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  const components: Component[] = [];

  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || visited[start]) continue;

    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    let sumX = 0;
    let sumY = 0;

    while (head < tail) {
      const index = queue[head++];
      const x = index % width;
      const y = (index - x) / width;
      if (labels) labels[index] = components.length;
      sumX += x;
      sumY += y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const next = ny * width + nx;
          if (mask[next] && !visited[next]) {
            visited[next] = 1;
            queue[tail++] = next;
          }
        }
      }
    }

    components.push({
      left: minX,
      top: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
      area: tail,
      cx: sumX / tail,
      cy: sumY / tail,
    });
  }

  return components;
}

/** Group rects into rows by vertical center, then sort each row left to right. */
export function readingOrder<T extends PixelRect>(rects: T[]): T[] {
  const centerY = (r: T) => r.top + r.height / 2;
  const rows: { bottom: number; items: T[] }[] = [];

  for (const rect of [...rects].sort((a, b) => centerY(a) - centerY(b) || a.left - b.left)) {
    const row = rows.at(-1);
    if (row && centerY(rect) < row.bottom) {
      row.items.push(rect);
    } else {
      rows.push({ bottom: rect.top + rect.height, items: [rect] });
    }
  }

  return rows.flatMap((row) => row.items.sort((a, b) => a.left - b.left));
}
