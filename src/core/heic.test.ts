import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";
import sharp from "sharp";

vi.mock("node:worker_threads", () => ({
  Worker: vi.fn(
    class extends EventEmitter {
      stdout = new PassThrough();
      stderr = new PassThrough();
      terminate = vi.fn(async () => 0);
    },
  ),
}));
const { Worker } = await import("node:worker_threads");
const { decodeHeic, heicToJpeg } = await import("./heic.js");
const worker = () => vi.mocked(Worker).mock.instances.at(-1)!;
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.useRealTimers();
});

it("captures both diagnostic streams on stderr and terminates after success", async () => {
  const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  const pending = decodeHeic(Buffer.alloc(0), "photo.heic");
  expect(vi.mocked(Worker).mock.calls[0][1]).toMatchObject({ stdout: true, stderr: true });
  worker().stdout!.emit("data", Buffer.from("decode diagnostic"));
  worker().stderr!.emit("data", Buffer.from("warning"));
  worker().emit("message", { data: new Uint8Array(4), width: 1, height: 1 });
  await pending;
  expect(stderr).toHaveBeenCalledWith(Buffer.from("decode diagnostic"));
  expect(stderr).toHaveBeenCalledWith(Buffer.from("warning"));
  expect(worker().terminate).toHaveBeenCalledOnce();
});

it("terminates failed decodes and starts a fresh worker for the next image", async () => {
  for (let i = 0; i < 3; i++) {
    const pending = decodeHeic(Buffer.alloc(0), "bad.heic");
    const rejected = expect(pending).rejects.toMatchObject({ code: "INVALID_INPUT" });
    worker().emit("message", { error: "HEIF image not found" });
    await rejected;
    expect(worker().terminate).toHaveBeenCalledOnce();
  }
  expect(Worker).toHaveBeenCalledTimes(3);
});

it("terminates immediately on cancellation", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const pending = decodeHeic(Buffer.alloc(0), "photo.heic", controller.signal);
  const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  controller.abort();
  await rejected;
  expect(worker().terminate).toHaveBeenCalledOnce();
});

it("caps JPEG uploads at 2048 pixels without enlarging", async () => {
  const pending = heicToJpeg(Buffer.alloc(0), "photo.heic");
  worker().emit("message", { data: new Uint8Array(3000 * 100 * 4), width: 3000, height: 100 });
  const meta = await sharp(await pending).metadata();
  expect(meta.width).toBe(2048);
  expect(meta.height).toBeLessThan(100);
});

it("terminates when the 30-second decode timeout expires", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
  const pending = decodeHeic(Buffer.alloc(0), "photo.heic");
  const rejected = expect(pending).rejects.toMatchObject({
    code: "INVALID_INPUT",
    message: expect.stringContaining("took over 30s"),
  });
  setTimeout(() => controller.abort(new DOMException("decode timed out", "TimeoutError")), 30_000);
  await vi.advanceTimersByTimeAsync(30_000);
  await rejected;
  expect(timeout).toHaveBeenCalledWith(30_000);
  expect(worker().terminate).toHaveBeenCalledOnce();
});

it("decodes at most two HEIC photos at a time", async () => {
  const pending = [0, 1, 2].map(() => decodeHeic(Buffer.alloc(0), "photo.heic"));
  expect(Worker).toHaveBeenCalledTimes(2);
  const [first] = vi.mocked(Worker).mock.instances;
  first.emit("message", { data: new Uint8Array(4), width: 1, height: 1 });
  await pending[0];
  await vi.waitFor(() => expect(Worker).toHaveBeenCalledTimes(3));
  for (const instance of vi.mocked(Worker).mock.instances.slice(1)) {
    instance.emit("message", { data: new Uint8Array(4), width: 1, height: 1 });
  }
  await Promise.all(pending);
});

it("lets a cancelled waiter leave the queue without taking a slot", async () => {
  const running = [0, 1].map(() => decodeHeic(Buffer.alloc(0), "photo.heic"));
  const controller = new AbortController();
  const cancelled = decodeHeic(Buffer.alloc(0), "photo.heic", controller.signal);
  const rejected = expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
  controller.abort();
  await rejected;
  for (const instance of vi.mocked(Worker).mock.instances) {
    instance.emit("message", { data: new Uint8Array(4), width: 1, height: 1 });
  }
  await Promise.all(running);
  expect(Worker).toHaveBeenCalledTimes(2);
  // Both slots are free again.
  void decodeHeic(Buffer.alloc(0), "photo.heic");
  void decodeHeic(Buffer.alloc(0), "photo.heic");
  expect(Worker).toHaveBeenCalledTimes(4);
  for (const instance of vi.mocked(Worker).mock.instances.slice(2)) {
    instance.emit("message", { data: new Uint8Array(4), width: 1, height: 1 });
  }
});
