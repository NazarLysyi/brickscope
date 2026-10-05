import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { imageNotFound, invalidInput } from "./utils/errors.js";
import type * as HeicDecoder from "./heic.js";

export const PREDICT_ENDPOINTS = {
  general: "/predict/",
  part: "/predict/parts/",
  set: "/predict/sets/",
  fig: "/predict/figs/",
} as const;

const SUPPORTED_MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".heic": "image/heic",
  ".heif": "image/heif",
};

/** HEIC/HEIF (the iPhone default) needs converting: Brickognize and sharp can't read it. */
export function isHeic(ext: string): boolean {
  return ext === ".heic" || ext === ".heif";
}

/** Prefer recognizable bytes over a misleading filename. AVIF may also advertise mif1. */
export function imageFormat(buffer: Buffer, fallbackExt: string): string {
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return ".jpg";
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return ".png";
  if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP")
    return ".webp";
  if (buffer.toString("ascii", 4, 8) === "ftyp") {
    const end = Math.min(buffer.readUInt32BE(0), buffer.length);
    const brands = [buffer.toString("ascii", 8, 12)];
    for (let i = 16; i + 4 <= end; i += 4) brands.push(buffer.toString("ascii", i, i + 4));
    if (brands.some((brand) => brand === "avif" || brand === "avis")) return ".avif";
    if (brands.some((brand) => ["heic", "heix", "mif1", "msf1", "hevc", "hevx"].includes(brand)))
      return ".heic";
  }
  return fallbackExt;
}

/** Load the HEIC decoder on demand, with a clear error if it can't be loaded. */
export async function loadHeicDecoder(): Promise<typeof HeicDecoder> {
  try {
    return await import("./heic.js");
  } catch (err) {
    throw invalidInput(
      `HEIC support failed to load (${err instanceof Error ? err.message : String(err)}). ` +
        "Convert the photo to JPEG, or reinstall brickscope.",
    );
  }
}

export interface ResolvedImage {
  blob: Blob;
  filename: string;
}

export async function resolveImage(
  input: { imagePath: string },
  signal?: AbortSignal,
): Promise<ResolvedImage> {
  return resolveFromPath(input.imagePath, signal);
}

/**
 * Strip shell escape characters from drag-and-dropped or terminal-copied paths. On Windows
 * a backslash is also the path separator (C:\photos\(old)\pile.jpg), so there only
 * bash-style paths with forward slashes (C:/My\ Photos/pile.jpg) are unescaped.
 */
function normalizeFilePath(filePath: string): string {
  if (process.platform === "win32" && !filePath.includes("/")) return filePath;
  return filePath.replace(/\\+([ '"()[\]{}])/g, "$1");
}

export interface ResolvedImagePath {
  path: string;
  ext: string;
  mime: string;
}

/** Normalize a user-supplied image path and check that its format is supported. */
export function resolveImagePath(imagePath: string): ResolvedImagePath {
  const resolved = resolve(normalizeFilePath(imagePath));

  const ext = extname(resolved).toLowerCase();
  const mime = SUPPORTED_MIME_TYPES[ext];

  if (!mime) {
    throw invalidInput(
      `Unsupported image format "${ext}". Supported: ${Object.keys(SUPPORTED_MIME_TYPES).join(", ")}`,
    );
  }

  return { path: resolved, ext, mime };
}

/** Read an image file, reporting a missing file as IMAGE_NOT_FOUND. */
export async function readImageFile(path: string, signal?: AbortSignal): Promise<Buffer> {
  try {
    return await readFile(path, { signal });
  } catch (err) {
    if (err instanceof Error && (err as NodeJS.ErrnoException).code === "ENOENT") {
      throw imageNotFound(path);
    }
    throw err;
  }
}

async function resolveFromPath(imagePath: string, signal?: AbortSignal): Promise<ResolvedImage> {
  const { path, ext: pathExt } = resolveImagePath(imagePath);
  const buffer = await readImageFile(path, signal);

  const ext = imageFormat(buffer, pathExt);
  const mime = SUPPORTED_MIME_TYPES[ext];

  if (isHeic(ext)) {
    const { heicToJpeg } = await loadHeicDecoder();
    const jpeg = await heicToJpeg(buffer, path, signal);
    return {
      blob: new Blob([new Uint8Array(jpeg)], { type: "image/jpeg" }),
      filename: "image.jpg",
    };
  }

  if (ext === ".avif") {
    const { default: sharp } = await import("sharp");
    const jpeg = await sharp(buffer, { autoOrient: true })
      .resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg()
      .toBuffer();
    return {
      blob: new Blob([new Uint8Array(jpeg)], { type: "image/jpeg" }),
      filename: "image.jpg",
    };
  }

  return {
    blob: new Blob([new Uint8Array(buffer)], { type: mime }),
    filename: `image${ext}`,
  };
}
