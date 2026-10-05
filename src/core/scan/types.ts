import type { Match, PredictedColor, RawSearchResults } from "../brickognize/types.js";
import type { DetectionSettings } from "./options.js";
import type { PhotoTip } from "./tips.js";

export type { PhotoTip, PhotoTipCode } from "./tips.js";

/** A candidate part for a region, without catalog links (kept small for MCP output). */
export type ScanMatch = Omit<Match, "imageUrl" | "externalSites">;

/**
 * A box as [x1, y1, x2, y2] in percent (0–100) of the image after EXIF orientation.
 * This is the only coordinate format exchanged with callers.
 */
export type PercentBox = [number, number, number, number];

/** Packed 8-bit sRGB pixels, 3 channels. */
export interface RgbImage {
  data: Uint8Array;
  width: number;
  height: number;
}

/** A pixel rectangle in some concrete raster (working or detection image). */
export interface PixelRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export type ScanWarningCode =
  | "BACKGROUND_NOT_UNIFORM"
  | "REGION_TOUCHES_BORDER"
  | "LARGE_REGION"
  | "NO_REGIONS"
  | "TRUNCATED"
  | "DUPLICATE_REGION"
  | "TINY_REGION"
  | "RATE_LIMITED";

export interface ScanWarning {
  code: ScanWarningCode;
  message: string;
  regionIds?: number[];
}

export type RegionStatus = "success" | "no_match" | "error";

export interface ScanRegion {
  id: number;
  /** The detected or supplied part box. */
  box: PercentBox;
  /** The exact area sent to Brickognize (box plus padding, clamped to the image). */
  cropBox: PercentBox;
  /** Other regions whose parts were painted out of this crop, so it shows one part. */
  paintedOut?: number[];
  /** Absent in detect-only mode. */
  status?: RegionStatus;
  /** Top matches, best first. */
  matches?: ScanMatch[];
  /** Top predicted colors, best first. */
  colors?: PredictedColor[];
  error?: string;
  raw?: RawSearchResults;
}

/** Regions that share the same top part and color. Provisional: the agent should review them. */
export interface PartGroup {
  partId: string;
  name: string;
  colorName: string | null;
  count: number;
  regionIds: number[];
  /** Lowest top-match score among the grouped regions. */
  minScore: number;
}

export interface LookupEntry {
  partId: string;
  colorName?: string;
}

export interface ScanResult {
  summary: string;
  /** Size of the image after EXIF orientation. */
  image: Size;
  /** Crop padding used; pass it back with the approved boxes to get the same crops. */
  padding: number;
  detection: "auto" | "manual";
  /** Detection tuning also used for isolation with manual boxes. */
  detectionSettings: DetectionSettings;
  isolateParts: boolean;
  detectOnly: boolean;
  /** Provisional part/color counts; absent in detect-only mode. */
  groups?: PartGroup[];
  /** Ready-made input for brickognize_batch_part_details, in small batches that finish within client timeouts. */
  lookupBatches?: LookupEntry[][];
  warnings: ScanWarning[];
  /** Advice for taking a better photo next time (absent if none). */
  tips?: PhotoTip[];
  /** Auto-detected regions dropped because of maxRegions (the smallest ones). */
  omittedRegions: number;
  regions: ScanRegion[];
}

export interface ScanOutput {
  result: ScanResult;
  /** JPEG: the photo with a percent grid and numbered region boxes; null when previews are off. */
  annotatedImage: Buffer | null;
  /** JPEG: numbered crops exactly as sent to Brickognize; null without regions or previews. */
  cropSheet: Buffer | null;
}
