import { describe, it, expect, vi, beforeEach } from "vitest";
import { BrickognizeError } from "../utils/errors.js";
import type { RawSearchResults } from "./types.js";

vi.mock("./client.js", () => ({ predict: vi.fn() }));

const { predict } = await import("./client.js");
const { predictMany, NOT_IDENTIFIED } = await import("./batch.js");
const predictMock = vi.mocked(predict);

const RAW = { listing_id: "l", items: [] } as unknown as RawSearchResults;
const input = () => async () => ({ blob: new Blob([]), filename: "a.jpg" });
const inputs = (n: number) => Array.from({ length: n }, input);

beforeEach(() => {
  predictMock.mockReset();
  predictMock.mockResolvedValue(RAW);
});

describe("predictMany", () => {
  it("returns an outcome per input, in order", async () => {
    const { outcomes, rateLimited } = await predictMany("/predict/", inputs(7), {
      deadline: Date.now() + 10_000,
    });
    expect(outcomes.map((o) => o.status)).toEqual(Array(7).fill("ok"));
    expect(rateLimited).toBe(false);
  });

  it("starts nothing new after a 429 but lets sent requests finish", async () => {
    let calls = 0;
    predictMock.mockImplementation(async () => {
      if (++calls === 1) throw new BrickognizeError("429", "API_ERROR", 429);
      await new Promise((resolve) => setTimeout(resolve, 30));
      return RAW;
    });
    const { outcomes, rateLimited } = await predictMany("/predict/", inputs(8), {
      deadline: Date.now() + 10_000,
    });
    expect(rateLimited).toBe(true);
    expect(outcomes.slice(1, 5).every((o) => o.status === "ok")).toBe(true);
    expect(outcomes.slice(5)).toEqual(
      Array(3).fill({ status: "error", error: NOT_IDENTIFIED.rateLimited }),
    );
  });

  it("reports a final 429 as retryable", async () => {
    predictMock.mockRejectedValue(new BrickognizeError("429", "API_ERROR", 429));
    const { outcomes } = await predictMany("/predict/", inputs(2), {
      deadline: Date.now() + 10_000,
    });
    expect(outcomes).toEqual(Array(2).fill({ status: "error", error: NOT_IDENTIFIED.rateLimited }));
  });

  it("pauses new starts after a recovered 429 without stopping the batch", async () => {
    let calls = 0;
    let pausedAt = 0;
    predictMock.mockImplementation(async (_e, _b, _f, options) => {
      // The 429 arrives over the network, after all five first requests are out.
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (++calls === 1) {
        pausedAt = Date.now();
        options?.onRateLimited?.(60);
      }
      if (calls > 5) expect(Date.now() - pausedAt).toBeGreaterThanOrEqual(60);
      await new Promise((resolve) => setTimeout(resolve, 20));
      return RAW;
    });
    const { outcomes, rateLimited } = await predictMany("/predict/", inputs(8), {
      deadline: Date.now() + 10_000,
    });
    expect(rateLimited).toBe(false);
    expect(predictMock).toHaveBeenCalledTimes(8);
    expect(outcomes.every((o) => o.status === "ok")).toBe(true);
  });

  it("does not upload an input read after the call was cancelled", async () => {
    const controller = new AbortController();
    const slowRead = async () => {
      controller.abort();
      return { blob: new Blob([]), filename: "a.jpg" };
    };
    const { outcomes } = await predictMany("/predict/", [slowRead], {
      deadline: Date.now() + 10_000,
      signal: controller.signal,
    });
    expect(predictMock).not.toHaveBeenCalled();
    expect(outcomes[0]).toEqual({ status: "error", error: NOT_IDENTIFIED.cancelled });
  });

  it("sends nothing once the deadline has passed", async () => {
    const { outcomes } = await predictMany("/predict/", inputs(3), { deadline: Date.now() - 1 });
    expect(predictMock).not.toHaveBeenCalled();
    expect(outcomes).toEqual(Array(3).fill({ status: "error", error: NOT_IDENTIFIED.budget }));
  });

  it("reports a failing input's own error", async () => {
    const bad = async () => {
      throw new BrickognizeError("Image file not found: x.jpg", "IMAGE_NOT_FOUND");
    };
    const { outcomes } = await predictMany("/predict/", [bad, input()], {
      deadline: Date.now() + 10_000,
    });
    expect(outcomes[0]).toEqual({ status: "error", error: "Image file not found: x.jpg" });
    expect(outcomes[1].status).toBe("ok");
  });
});

it("does not relabel an unrelated error after another request finally fails with 429", async () => {
  let calls = 0;
  predictMock.mockImplementation(async () => {
    if (++calls === 1) throw new BrickognizeError("429", "API_ERROR", 429);
    await new Promise((resolve) => setTimeout(resolve, 5));
    throw new Error("fetch failed");
  });
  const { outcomes } = await predictMany("/predict/", inputs(2), { deadline: Date.now() + 10_000 });
  expect(outcomes[1]).toEqual({ status: "error", error: "Network error: fetch failed" });
});
