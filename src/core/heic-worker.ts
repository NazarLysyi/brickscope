import { parentPort, workerData } from "node:worker_threads";
import decode from "heic-decode";

// This worker is disposed after every image, including malformed files that leak in libheif.
try {
  const images = await decode.all({ buffer: workerData as Uint8Array });
  try {
    const image = images[0];
    if (!image || image.width <= 0 || image.height <= 0) throw new Error("HEIF image not found");
    if (image.width * image.height > 100_000_000) {
      throw new Error("HEIC image is too large to process (over 100 megapixels).");
    }
    const { data, width, height } = await image.decode();
    const pixels = Uint8Array.from(data);
    parentPort!.postMessage({ data: pixels, width, height }, [pixels.buffer]);
  } finally {
    images.dispose();
  }
} catch (error) {
  parentPort!.postMessage({ error: error instanceof Error ? error.message : String(error) });
}
