import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("node:timers/promises", () => ({
  setTimeout: (delay: number, _value: undefined, options: { signal?: AbortSignal }) =>
    new Promise<void>((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        reject(options.signal?.reason);
      };
      const timer = setTimeout(() => {
        options.signal?.removeEventListener("abort", abort);
        resolve();
      }, delay);
      options.signal?.addEventListener("abort", abort, { once: true });
      if (options.signal?.aborted) abort();
    }),
}));

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.stubEnv("REBRICKABLE_API_KEY", "test");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("lets an aborted queued caller leave immediately without consuming a request slot", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ part_num: "1" })));
  vi.stubGlobal("fetch", fetch);
  const { getPartDetails } = await import("./client.js");
  await getPartDetails("first");
  fetch.mockImplementation(async () => new Response(JSON.stringify({ part_num: "1" })));
  const second = getPartDetails("second");
  const controller = new AbortController();
  const cancelled = getPartDetails("cancelled", controller.signal);
  const rejected = expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
  const last = getPartDetails("last");
  controller.abort();
  await rejected;
  expect(fetch).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1100);
  await second;
  expect(fetch).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1100);
  await last;
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(String(fetch.mock.calls[2][0])).toContain("last");
});

it("backs off all callers after 429, honoring Retry-After", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response("busy", { status: 429, headers: { "retry-after": "5" } }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ part_num: "2" })));
  vi.stubGlobal("fetch", fetch);
  const { getPartDetails } = await import("./client.js");
  await expect(getPartDetails("1")).rejects.toMatchObject({ status: 429 });
  const next = getPartDetails("2");
  await vi.advanceTimersByTimeAsync(4999);
  expect(fetch).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  await next;
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("caps a very long Retry-After so later lookups don't stall for an hour", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response("busy", { status: 429, headers: { "retry-after": "3600" } }),
    )
    .mockResolvedValueOnce(new Response(JSON.stringify({ part_num: "2" })));
  vi.stubGlobal("fetch", fetch);
  const { getPartDetails } = await import("./client.js");
  await expect(getPartDetails("1")).rejects.toMatchObject({ status: 429 });
  const next = getPartDetails("2");
  await vi.advanceTimersByTimeAsync(60_000);
  await next;
  expect(fetch).toHaveBeenCalledTimes(2);
});
