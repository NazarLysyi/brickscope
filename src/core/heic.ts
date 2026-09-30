import { Worker } from "node:worker_threads";
import sharp from "sharp";
import { invalidInput } from "./utils/errors.js";

export interface DecodedHeic {
  /** RGBA pixels, already rotated as the photo is meant to be shown. */
  data: Uint8Array;
  width: number;
  height: number;
}

const DECODE_TIMEOUT_MS = 30_000;
/** A full-size decode holds up to ~400 MB of pixels, so batches decode a few at a time. */
const MAX_PARALLEL_DECODES = 2;

let running = 0;
const waiting: (() => void)[] = [];

/** Resolves with a release function; a free slot is taken synchronously. */
function acquireSlot(signal?: AbortSignal): (() => void) | Promise<() => void> {
  signal?.throwIfAborted();
  // The slot passes straight to the next waiter, or frees up.
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else running--;
  };
  if (running < MAX_PARALLEL_DECODES) {
    running++;
    return release;
  }
  return new Promise((resolve, reject) => {
    const start = () => {
      signal?.removeEventListener("abort", abort);
      resolve(release);
    };
    const abort = () => {
      waiting.splice(waiting.indexOf(start), 1);
      reject(signal?.reason);
    };
    waiting.push(start);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export async function decodeHeic(
  buffer: Buffer,
  path: string,
  signal?: AbortSignal,
): Promise<DecodedHeic> {
  const slot = acquireSlot(signal);
  const release = typeof slot === "function" ? slot : await slot;
  try {
    return await decodeInWorker(buffer, path, signal);
  } finally {
    release();
  }
}

async function decodeInWorker(
  buffer: Buffer,
  path: string,
  signal?: AbortSignal,
): Promise<DecodedHeic> {
  const timeout = AbortSignal.timeout(DECODE_TIMEOUT_MS);
  const stop = signal ? AbortSignal.any([signal, timeout]) : timeout;
  stop.throwIfAborted();
  // Source execution is used by tests; installed packages resolve the adjacent dist worker.
  const source = import.meta.url.endsWith(".ts");
  const worker = new Worker(
    new URL(source ? "./heic-worker.ts" : "./heic-worker.js", import.meta.url),
    {
      workerData: Uint8Array.from(buffer),
      stdout: true,
      stderr: true,
      execArgv: source
        ? ["--experimental-strip-types", "--disable-warning=ExperimentalWarning"]
        : [],
    },
  );
  worker.stdout.pipe(process.stderr, { end: false });
  worker.stderr.pipe(process.stderr, { end: false });
  let abort: () => void = () => undefined;
  try {
    return await new Promise<DecodedHeic>((resolve, reject) => {
      abort = () => reject(stop.reason);
      stop.addEventListener("abort", abort, { once: true });
      worker.once("message", (message: DecodedHeic | { error: string }) => {
        if ("error" in message) reject(new Error(message.error));
        else resolve(message);
      });
      worker.once("error", reject);
      worker.once("exit", (code) =>
        reject(new Error(`HEIC worker exited without an image (${code})`)),
      );
      if (stop.aborted) abort();
    });
  } catch (err) {
    // The caller's cancel or deadline passes through; our own timeout is about this file.
    if (signal?.aborted) throw signal.reason;
    if (timeout.aborted) {
      throw invalidInput(
        `Could not decode HEIC image ${path}: it took over ${DECODE_TIMEOUT_MS / 1000}s. Convert it to JPEG and try again.`,
      );
    }
    throw invalidInput(
      `Could not decode HEIC image ${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    stop.removeEventListener("abort", abort);
    await worker.terminate();
    worker.stdout.unpipe(process.stderr);
    worker.stderr.unpipe(process.stderr);
  }
}

/** Brickognize doesn't accept HEIC; upload a bounded JPEG instead. */
export async function heicToJpeg(
  buffer: Buffer,
  path: string,
  signal?: AbortSignal,
): Promise<Buffer> {
  const { data, width, height } = await decodeHeic(buffer, path, signal);
  signal?.throwIfAborted();
  return sharp(data, { raw: { width, height, channels: 4 } })
    .resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 92 })
    .toBuffer();
}
