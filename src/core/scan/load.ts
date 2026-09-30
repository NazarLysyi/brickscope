import sharp, { type ResizeOptions, type Sharp } from "sharp";
import { imageFormat, isHeic, loadHeicDecoder, readImageFile, resolveImagePath } from "../image.js";
import { invalidInput } from "../utils/errors.js";
import { paintOut, type CropIsolation } from "./isolation.js";
import type { PixelRect, RgbImage, Size } from "./types.js";

/** Crops are cut from this copy; plenty for Brickognize and bounded in memory (~27 MB). */
const WORKING_MAX_SIDE = 3000;
const DETECTION_MAX_SIDE = 1024;
const CROP_MAX_SIDE = 800;

export interface LoadedImage {
  /** Size of the original image after EXIF orientation. */
  size: Size;
  /** Oriented, alpha-flattened copy, longest side ≤ 3000px. */
  working: RgbImage;
}

/**
 * Decode an image once: apply EXIF orientation (including mirroring), flatten alpha onto
 * white, convert to sRGB and keep only the first frame of animated input. Minor corruption
 * that browsers tolerate (extraneous bytes, truncated scans) is tolerated here too.
 */
export async function loadImage(imagePath: string, signal?: AbortSignal): Promise<LoadedImage> {
  const { path, ext } = resolveImagePath(imagePath);
  const input = await readImageFile(path, signal);

  if (isHeic(imageFormat(input, ext))) {
    // Decoded by libheif, which already applies the photo's rotation.
    const { decodeHeic } = await loadHeicDecoder();
    const { data, width, height } = await decodeHeic(input, path, signal);
    const raw = sharp(data, { raw: { width, height, channels: 4 } });
    return {
      size: { width, height },
      working: await toRgb(raw.resize(fitInside(WORKING_MAX_SIDE))),
    };
  }

  const source = () => sharp(input, { autoOrient: true, failOn: "none", pages: 1 });

  try {
    const { autoOrient } = await source().metadata();
    const working = await toRgb(source().resize(fitInside(WORKING_MAX_SIDE)));
    return { size: { width: autoOrient.width, height: autoOrient.height }, working };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw invalidInput(
      /pixel limit/i.test(message)
        ? `Image ${path} is too large to process (over 268 megapixels).`
        : `Could not decode image ${path}: ${message}`,
    );
  }
}

/** Downscaled copy for detection, longest side ≤ 1024px. */
export async function detectionImage(working: RgbImage): Promise<RgbImage> {
  return toRgb(fromRaw(working).resize(fitInside(DETECTION_MAX_SIDE)));
}

export function fromRaw(raw: RgbImage): Sharp {
  return sharp(raw.data, { raw: { width: raw.width, height: raw.height, channels: 3 } });
}

/**
 * Cut a region out of the working image as the JPEG sent to Brickognize, optionally with
 * other detected parts painted out.
 */
export async function extractCrop(
  working: RgbImage,
  rect: PixelRect,
  isolation?: CropIsolation,
): Promise<Buffer> {
  let crop = fromRaw(working).extract(rect);
  if (isolation && isolation.erase.size > 0) {
    const data = await crop.raw().toBuffer();
    paintOut(data, rect, working.width, working.height, isolation);
    crop = sharp(data, { raw: { width: rect.width, height: rect.height, channels: 3 } });
  }
  return crop.resize(fitInside(CROP_MAX_SIDE)).jpeg({ quality: 90 }).toBuffer();
}

export function fitInside(side: number): ResizeOptions {
  return { width: side, height: side, fit: "inside", withoutEnlargement: true };
}

async function toRgb(pipeline: Sharp): Promise<RgbImage> {
  const { data, info } = await pipeline
    .flatten({ background: "#ffffff" })
    .toColourspace("srgb")
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (info.channels !== 3) {
    throw new Error(`expected 3 color channels, got ${info.channels}`);
  }

  return { data, width: info.width, height: info.height };
}
