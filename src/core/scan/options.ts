import { BrickognizeError, invalidInput } from "../utils/errors.js";
import { validateBoxes } from "./geometry.js";
import type * as Scanner from "./index.js";
import type { PercentBox, Size } from "./types.js";

// This module must not import sharp: the CLI and MCP server load it eagerly.

/** Hard upper bound for regions per scan, to protect the free Brickognize API. */
export const MAX_REGIONS_LIMIT = 60;
export const MAX_PADDING = 0.5;
export const SCAN_DEFAULTS = { padding: 0.08, maxRegions: 30, timeBudgetMs: 180_000 } as const;

/** Auto-detection tuning, for callers who look at the preview and see what to change. */
export interface DetectionSettings {
  /** Minimum color difference (ΔE) from the surface for a pixel to count as part of a part. */
  minContrast: number;
  /** Smallest region kept, in percent of the image area. */
  minPartSize: number;
  /** Gaps up to this wide (percent of the image's shorter side) are bridged within a region. */
  joinGap: number;
}

export const DETECTION_DEFAULTS: DetectionSettings = {
  minContrast: 10,
  minPartSize: 0.03,
  joinGap: 0.5,
};

export const DETECTION_RANGES: Record<keyof DetectionSettings, [number, number]> = {
  minContrast: [3, 80],
  minPartSize: [0.001, 10],
  joinGap: [0, 5],
};

export interface ScanOptions {
  /** Approved boxes in percent; replaces auto-detection. An empty array approves no regions. */
  boxes?: unknown;
  /** Only detect and render previews; no Brickognize requests. */
  detectOnly?: boolean;
  /** Crop padding as a fraction of the region's longer side. */
  padding?: number;
  /** Cap on auto-detected regions (the largest are kept). Supplied boxes are capped at MAX_REGIONS_LIMIT. */
  maxRegions?: number;
  /**
   * Paint other detected parts out of each crop, so each crop shows one part (default false:
   * on real photos Brickognize already focuses on the main part, and large painted patches
   * can skew its color prediction).
   */
  isolateParts?: boolean;
  /** Auto-detection tuning; unset values use DETECTION_DEFAULTS. */
  minContrast?: number;
  minPartSize?: number;
  joinGap?: number;
  includeRaw?: boolean;
  /** The scan stops identifying after this long (from the start of the call); unfinished regions are reported as errors. */
  timeBudgetMs?: number;
  /** Render the annotated image and crop sheet (default true). */
  previews?: boolean;
  /** Aborts recognition, e.g. when an MCP client cancels the call. */
  signal?: AbortSignal;
  /** Size of the image the supplied boxes were made for; a different image is rejected. */
  expectedSize?: Size;
}

export interface ResolvedScanOptions {
  boxes: PercentBox[] | null;
  detectOnly: boolean;
  padding: number;
  maxRegions: number;
  detection: DetectionSettings;
  isolateParts: boolean;
  includeRaw: boolean;
  timeBudgetMs: number;
  previews: boolean;
  signal?: AbortSignal;
  expectedSize?: Size;
}

/** Largest delay setTimeout (and so AbortSignal.timeout) handles without overflowing. */
const MAX_TIMER_MS = 2 ** 31 - 1;

/** Validate scan options before any image work, so bad input fails fast. */
export function resolveScanOptions(options: ScanOptions = {}): ResolvedScanOptions {
  const padding = options.padding ?? SCAN_DEFAULTS.padding;
  const maxRegions = options.maxRegions ?? SCAN_DEFAULTS.maxRegions;
  const timeBudgetMs = options.timeBudgetMs ?? SCAN_DEFAULTS.timeBudgetMs;

  if (!Number.isFinite(padding) || padding < 0 || padding > MAX_PADDING) {
    throw invalidInput(`padding must be between 0 and ${MAX_PADDING}.`);
  }
  if (!Number.isInteger(maxRegions) || maxRegions < 1 || maxRegions > MAX_REGIONS_LIMIT) {
    throw invalidInput(`maxRegions must be an integer between 1 and ${MAX_REGIONS_LIMIT}.`);
  }
  if (!Number.isInteger(timeBudgetMs) || timeBudgetMs < 1 || timeBudgetMs > MAX_TIMER_MS) {
    throw invalidInput(`timeBudgetMs must be an integer between 1 and ${MAX_TIMER_MS}.`);
  }
  const size = options.expectedSize;
  if (
    size !== undefined &&
    !(
      Number.isInteger(size?.width) &&
      size.width > 0 &&
      Number.isInteger(size?.height) &&
      size.height > 0
    )
  ) {
    throw invalidInput("expectedSize must be { width, height } with positive whole numbers.");
  }

  const detection = { ...DETECTION_DEFAULTS };
  for (const key of Object.keys(DETECTION_RANGES) as (keyof DetectionSettings)[]) {
    const value = options[key];
    if (value === undefined) continue;
    const [min, max] = DETECTION_RANGES[key];
    if (!Number.isFinite(value) || value < min || value > max) {
      throw invalidInput(`${key} must be between ${min} and ${max}.`);
    }
    detection[key] = value;
  }

  return {
    boxes: options.boxes === undefined ? null : validateBoxes(options.boxes, MAX_REGIONS_LIMIT),
    detectOnly: options.detectOnly === true,
    padding,
    maxRegions,
    detection,
    isolateParts: options.isolateParts === true,
    includeRaw: options.includeRaw === true,
    timeBudgetMs,
    previews: options.previews !== false,
    signal: options.signal,
    expectedSize: size,
  };
}

/**
 * Load the scanner on demand. It depends on sharp, a native module, so a broken install
 * fails here with an actionable message instead of taking down unrelated commands.
 */
export async function loadScanner(): Promise<typeof Scanner> {
  try {
    return await import("./index.js");
  } catch (err) {
    throw new BrickognizeError(
      "Scanning needs the sharp image library, which failed to load " +
        `(${err instanceof Error ? err.message : String(err)}). ` +
        "Reinstall brickscope on this machine so the right sharp binary is installed.",
      "DEPENDENCY_MISSING",
    );
  }
}
