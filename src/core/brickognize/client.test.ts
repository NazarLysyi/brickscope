import { describe, it, expect, vi, afterEach } from "vitest";
import { predict, retryDelayMs } from "./client.js";

const OK_BODY = { listing_id: "abc", bounding_box: {}, items: [] };

function blob(): Blob {
  return new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("predict retries", () => {
  it("retries a 429 and returns the next successful response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 429, headers: { "retry-after": "0" } }))
      .mockResolvedValueOnce(Response.json(OK_BODY));
    vi.stubGlobal("fetch", fetchMock);

    await expect(predict("/predict/parts/", blob(), "a.jpg")).resolves.toMatchObject({
      listing_id: "abc",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after two retries", async () => {
    const fetchMock = vi.fn(
      async () => new Response("down", { status: 503, headers: { "retry-after": "0" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(predict("/predict/parts/", blob(), "a.jpg")).rejects.toThrow("503");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry other errors", async () => {
    const fetchMock = vi.fn(async () => new Response("bad", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(predict("/predict/parts/", blob(), "a.jpg")).rejects.toThrow("400");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails at once when the server asks to wait longer than it is worth", async () => {
    const fetchMock = vi.fn(
      async () => new Response("busy", { status: 429, headers: { "retry-after": "120" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(predict("/predict/parts/", blob(), "a.jpg")).rejects.toThrow("429");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports the server error instead of retrying past the caller's deadline", async () => {
    const fetchMock = vi.fn(
      async () => new Response("busy", { status: 503, headers: { "retry-after": "3" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const error = await predict("/predict/parts/", blob(), "a.jpg", {
      deadline: Date.now() + 4_000,
    }).catch((err: unknown) => err);
    expect(error).toMatchObject({ code: "API_ERROR", status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a response with malformed items", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ ...OK_BODY, items: [null] })),
    );
    await expect(predict("/predict/parts/", blob(), "a.jpg")).rejects.toThrow("malformed item");
  });

  it("reports every 429, including ones it retries", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response("busy", { status: 429, headers: { "retry-after": "0" } }),
        )
        .mockResolvedValueOnce(Response.json(OK_BODY)),
    );
    const onRateLimited = vi.fn();
    await predict("/predict/parts/", blob(), "a.jpg", { onRateLimited });
    expect(onRateLimited).toHaveBeenCalledTimes(1);
  });

  it("aborts the request at the caller's deadline", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) =>
            init.signal?.addEventListener("abort", () => reject(init.signal?.reason)),
          ),
      ),
    );
    const started = Date.now();
    await expect(
      predict("/predict/parts/", blob(), "a.jpg", { deadline: Date.now() + 50 }),
    ).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("stops retrying when the caller aborts", async () => {
    const fetchMock = vi.fn(
      async () => new Response("busy", { status: 429, headers: { "retry-after": "5" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);

    await expect(
      predict("/predict/parts/", blob(), "a.jpg", { signal: controller.signal }),
    ).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("retryDelayMs", () => {
  const low = () => 0;
  const high = () => 1;

  it("backs off exponentially with jitter without Retry-After", () => {
    expect(retryDelayMs(null, 0, 0, low)).toBe(500);
    expect(retryDelayMs(null, 0, 0, high)).toBe(1000);
    expect(retryDelayMs(null, 1, 0, high)).toBe(2000);
  });

  it("honors Retry-After in seconds and declines waits over 10s", () => {
    expect(retryDelayMs("3", 0, 0, low)).toBe(3000);
    expect(retryDelayMs("120", 0, 0, low)).toBeNull();
  });

  it("honors Retry-After as an HTTP date", () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    expect(retryDelayMs("Thu, 01 Jan 2026 00:00:05 GMT", 0, now, low)).toBe(5000);
    expect(retryDelayMs("Wed, 31 Dec 2025 23:59:00 GMT", 0, now, low)).toBe(0);
  });

  it("ignores malformed Retry-After values", () => {
    expect(retryDelayMs("5, 5", 0, 0, low)).toBe(500);
    expect(retryDelayMs("abc 12", 0, 0, low)).toBe(500);
    expect(retryDelayMs("Thu, 01 Xxx 2026 00:00:05 GMT", 0, 0, low)).toBe(500);
    expect(retryDelayMs("Sun, 06 Nov 1994 25:49:37 GMT", 0, 0, low)).toBe(500);
  });
});
