import { beforeEach, expect, it, vi } from "vitest";

vi.mock("node:worker_threads", () => ({
  parentPort: { postMessage: vi.fn() },
  workerData: new Uint8Array(),
}));
vi.mock("heic-decode", () => ({ default: { all: vi.fn() } }));
const { parentPort } = await import("node:worker_threads");
const { default: decode } = await import("heic-decode");

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

it("rejects over 100 MP before RGBA decode and disposes metadata", async () => {
  const image = { width: 10001, height: 10000, decode: vi.fn() };
  const dispose = vi.fn();
  vi.mocked(decode.all).mockResolvedValue(Object.assign([image], { dispose }));
  await import("./heic-worker.js");
  expect(image.decode).not.toHaveBeenCalled();
  expect(dispose).toHaveBeenCalledOnce();
  expect(parentPort!.postMessage).toHaveBeenCalledWith({
    error: expect.stringContaining("100 megapixels"),
  });
});

it("reports metadata failures for the parent to terminate the leaking worker", async () => {
  vi.mocked(decode.all).mockRejectedValue(new Error("HEIF image not found"));
  await import("./heic-worker.js");
  expect(parentPort!.postMessage).toHaveBeenCalledWith({ error: "HEIF image not found" });
});
