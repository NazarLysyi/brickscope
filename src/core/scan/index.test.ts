import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp, { type Sharp } from "sharp";
import { DETECTION_DEFAULTS } from "./options.js";
import type { RawSearchResults } from "../brickognize/types.js";

vi.mock("../brickognize/client.js", () => ({ predict: vi.fn() }));

const { predict } = await import("../brickognize/client.js");
const { scanImage, toLookupBatches } = await import("./index.js");
const predictMock = vi.mocked(predict);

const WHITE = "#f5f5f0";
let dir: string;

type Block = { left: number; top: number; width: number; height: number; color: string };

async function writeLayout(
  name: string,
  width: number,
  height: number,
  blocks: Block[],
  finish: (image: Sharp) => Sharp = (image) => image.png(),
): Promise<string> {
  const composites = await Promise.all(
    blocks.map(async (b) => ({
      input: await sharp({
        create: { width: b.width, height: b.height, channels: 3, background: b.color },
      })
        .png()
        .toBuffer(),
      left: b.left,
      top: b.top,
    })),
  );
  const base = sharp({ create: { width, height, channels: 3, background: WHITE } }).composite(
    composites,
  );
  const path = join(dir, name);
  await writeFile(path, await finish(sharp(await base.png().toBuffer())).toBuffer());
  return path;
}

/** Two red blocks and one blue block on a light background. */
let layoutPath: string;

function rawResult(partId: string, colors: { name: string; score: number }[]): RawSearchResults {
  return {
    listing_id: "l",
    bounding_box: {
      left: 0,
      upper: 0,
      right: 1,
      lower: 1,
      image_width: 1,
      image_height: 1,
      score: 1,
    },
    items: [
      {
        id: partId,
        name: `Part ${partId}`,
        img_url: "",
        external_sites: [],
        category: null,
        type: "part",
        score: 0.9,
      },
    ],
    colors: colors.map((c, i) => ({ id: String(i), ...c })),
  };
}

/** Classify a crop by its strongest mean channel, so results don't depend on call order. */
async function dominantColor(blob: Blob): Promise<"red" | "blue" | "other"> {
  const { channels } = await sharp(Buffer.from(await blob.arrayBuffer())).stats();
  const [r, g, b] = channels.map((c) => c.mean);
  if (r > g && r > b) return "red";
  if (b > r && b > g) return "blue";
  return "other";
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "brickscope-scan-test-"));
  layoutPath = await writeLayout("layout.png", 400, 300, [
    { left: 40, top: 40, width: 60, height: 30, color: "#c91a09" },
    { left: 200, top: 50, width: 40, height: 40, color: "#0055bf" },
    { left: 100, top: 180, width: 80, height: 50, color: "#c91a09" },
  ]);
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

beforeEach(() => {
  predictMock.mockReset();
  predictMock.mockImplementation(async (_endpoint, blob) =>
    (await dominantColor(blob)) === "red"
      ? rawResult("3001", [
          { name: "Blue", score: 0.2 },
          { name: "Red", score: 0.9 },
        ])
      : rawResult("3003", [{ name: "Blue", score: 0.8 }]),
  );
});

describe("scanImage — detect only", () => {
  it("detects regions and renders previews without calling Brickognize", async () => {
    const { result, annotatedImage, cropSheet } = await scanImage(layoutPath, { detectOnly: true });

    expect(predictMock).not.toHaveBeenCalled();
    expect(result.image).toEqual({ width: 400, height: 300 });
    expect(result.detection).toBe("auto");
    expect(result.regions.map((r) => r.box)).toEqual([
      [10, 13.33, 25, 23.34],
      [50, 16.66, 60, 30],
      [25, 60, 45, 76.67],
    ]);
    expect(result.regions.every((r) => r.status === undefined)).toBe(true);
    expect(result.groups).toBeUndefined();
    expect(result.warnings).toEqual([]);
    expect(annotatedImage?.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    expect(cropSheet?.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
  });

  it("pads crops without leaving the image", async () => {
    const { result } = await scanImage(layoutPath, { detectOnly: true, padding: 0.1 });
    const [first] = result.regions;
    expect(first.cropBox[0]).toBeLessThan(first.box[0]);
    expect(first.cropBox[1]).toBeLessThan(first.box[1]);
    expect(first.cropBox.every((v) => v >= 0 && v <= 100)).toBe(true);
  });

  it("warns and returns no crop sheet when nothing is found", async () => {
    const empty = await writeLayout("empty.png", 200, 150, []);
    const { result, cropSheet } = await scanImage(empty, { detectOnly: true });
    expect(result.regions).toEqual([]);
    expect(result.warnings.map((w) => w.code)).toEqual(["NO_REGIONS"]);
    expect(cropSheet).toBeNull();
  });

  it("truncates to the largest maxRegions regions, in reading order, and says so", async () => {
    const { result } = await scanImage(layoutPath, { detectOnly: true, maxRegions: 2 });
    expect(result.regions.map((r) => r.box)).toEqual([
      [10, 13.33, 25, 23.34],
      [25, 60, 45, 76.67],
    ]);
    expect(result.omittedRegions).toBe(1);
    expect(result.warnings.map((w) => w.code)).toContain("TRUNCATED");
  });
});

describe("scanImage — image handling", () => {
  it("uses EXIF orientation as the coordinate frame", async () => {
    // Stored 400x200 and rotated 90° clockwise for display (orientation 6) → displayed 200x400.
    const path = await writeLayout(
      "rotated.jpg",
      400,
      200,
      [{ left: 20, top: 30, width: 60, height: 40, color: "#c91a09" }],
      (image) => image.jpeg({ quality: 100 }).withMetadata({ orientation: 6 }),
    );
    const { result } = await scanImage(path, { detectOnly: true });

    expect(result.image).toEqual({ width: 200, height: 400 });
    expect(result.regions).toHaveLength(1);
    const expected = [65, 5, 85, 20];
    result.regions[0].box.forEach((v, i) => expect(Math.abs(v - expected[i])).toBeLessThan(1.5));
  });

  it("applies mirrored EXIF orientation", async () => {
    const path = await writeLayout(
      "mirrored.jpg",
      400,
      200,
      [{ left: 20, top: 30, width: 60, height: 40, color: "#c91a09" }],
      (image) => image.jpeg({ quality: 100 }).withMetadata({ orientation: 2 }),
    );
    const { result } = await scanImage(path, { detectOnly: true });

    const expected = [80, 15, 95, 35];
    result.regions[0].box.forEach((v, i) => expect(Math.abs(v - expected[i])).toBeLessThan(1.5));
  });

  it("flattens transparency onto white", async () => {
    const path = join(dir, "alpha.png");
    await writeFile(
      path,
      await sharp({
        create: {
          width: 200,
          height: 150,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      })
        .composite([
          {
            input: await sharp({
              create: { width: 40, height: 30, channels: 3, background: "#0055bf" },
            })
              .png()
              .toBuffer(),
            left: 80,
            top: 60,
          },
        ])
        .png()
        .toBuffer(),
    );
    const { result } = await scanImage(path, { detectOnly: true });
    expect(result.regions).toHaveLength(1);
  });

  it("handles grayscale input", async () => {
    const path = await writeLayout(
      "gray.png",
      200,
      150,
      [{ left: 80, top: 60, width: 40, height: 30, color: "#202020" }],
      (image) => image.toColourspace("b-w").png(),
    );
    const { result } = await scanImage(path, { detectOnly: true });
    expect(result.regions).toHaveLength(1);
  });

  it("reads HEIC photos (the iPhone default)", async () => {
    const heic = fileURLToPath(new URL("../__fixtures__/parts.heic", import.meta.url));
    const { result } = await scanImage(heic, { detectOnly: true });
    expect(result.image).toEqual({ width: 400, height: 300 });
    const expected = [
      [10, 13.3, 25, 26.7],
      [62.5, 20, 77.5, 33.3],
      [30, 66.7, 45, 80],
    ];
    expect(result.regions).toHaveLength(3);
    result.regions.forEach((region, i) =>
      region.box.forEach((v, k) => expect(Math.abs(v - expected[i][k])).toBeLessThan(1.5)),
    );
  });

  it("reports a missing file", async () => {
    await expect(scanImage(join(dir, "missing.jpg"))).rejects.toThrow("Image file not found");
  });
});

describe("scanImage — recognition", () => {
  it("identifies every region and groups them by part and top color", async () => {
    const { result } = await scanImage(layoutPath);

    expect(predictMock).toHaveBeenCalledTimes(3);
    expect(predictMock.mock.calls[0][0]).toBe("/predict/parts/");
    expect(result.regions.map((r) => r.status)).toEqual(["success", "success", "success"]);
    expect(result.regions[0].colors?.map((c) => c.name)).toEqual(["Red", "Blue"]);
    expect(result.groups).toEqual([
      {
        partId: "3001",
        name: "Part 3001",
        colorName: "Red",
        count: 2,
        regionIds: expect.arrayContaining([1, 3]),
        minScore: 0.9,
      },
      {
        partId: "3003",
        name: "Part 3003",
        colorName: "Blue",
        count: 1,
        regionIds: [2],
        minScore: 0.9,
      },
    ]);
    expect(result.lookupBatches).toEqual([
      [
        { partId: "3001", colorName: "Red" },
        { partId: "3003", colorName: "Blue" },
      ],
    ]);
  });

  it("uses supplied boxes instead of auto-detection", async () => {
    const { result } = await scanImage(layoutPath, {
      boxes: [
        [10, 13, 25, 24],
        [50, 16, 60, 30],
      ],
    });
    expect(result.detection).toBe("manual");
    expect(result.regions).toHaveLength(2);
    expect(predictMock).toHaveBeenCalledTimes(2);
  });

  it("does not cap supplied boxes by maxRegions", async () => {
    const boxes = Array.from({ length: 40 }, (_, i) => [
      (i % 10) * 10,
      Math.floor(i / 10) * 20,
      (i % 10) * 10 + 5,
      Math.floor(i / 10) * 20 + 5,
    ]);
    const { result } = await scanImage(layoutPath, { detectOnly: true, boxes });
    expect(result.regions).toHaveLength(40);
    await expect(
      scanImage(layoutPath, { detectOnly: true, boxes: [...boxes, ...boxes, [1, 1, 2, 2]] }),
    ).rejects.toThrow("Maximum is 60");
  });

  it("treats an empty box list as no approved regions", async () => {
    const { result, cropSheet } = await scanImage(layoutPath, { boxes: [] });
    expect(result.regions).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.summary).toContain("No boxes were approved");
    expect(cropSheet).toBeNull();
    expect(predictMock).not.toHaveBeenCalled();
  });

  it("rejects boxes made for an image of a different size", async () => {
    await expect(
      scanImage(layoutPath, {
        boxes: [[10, 13, 25, 24]],
        expectedSize: { width: 640, height: 480 },
      }),
    ).rejects.toThrow("640x480");
  });

  it("warns about duplicate supplied boxes", async () => {
    const { result } = await scanImage(layoutPath, {
      detectOnly: true,
      boxes: [
        [10, 13, 25, 24],
        [10.5, 13, 25, 24],
      ],
    });
    expect(result.warnings).toEqual([
      expect.objectContaining({ code: "DUPLICATE_REGION", regionIds: [1, 2] }),
    ]);
  });

  it("warns when a box is kept next to the halves it was split into", async () => {
    const { result } = await scanImage(layoutPath, {
      detectOnly: true,
      boxes: [
        [10, 10, 40, 30],
        [10, 10, 25, 30],
        [25, 10, 40, 30],
      ],
    });
    expect(result.warnings.map((w) => w.regionIds)).toEqual([
      [1, 2],
      [1, 3],
    ]);
  });

  it("keeps going when one region fails", async () => {
    predictMock.mockImplementation(async (_endpoint, blob) => {
      if ((await dominantColor(blob)) === "blue")
        throw new Error("Brickognize API returned 500: boom");
      return rawResult("3001", [{ name: "Red", score: 0.9 }]);
    });
    const { result } = await scanImage(layoutPath);
    expect(result.regions.map((r) => r.status)).toEqual(["success", "error", "success"]);
    expect(result.regions[1].error).toContain("500");
    expect(result.groups).toHaveLength(1);
  });

  it("marks regions without matches as no_match", async () => {
    predictMock.mockResolvedValue({ ...rawResult("x", []), items: [] });
    const { result } = await scanImage(layoutPath);
    expect(result.regions.every((r) => r.status === "no_match")).toBe(true);
    expect(result.groups).toEqual([]);
  });

  /** A predict that only settles when its signal aborts, like a hung request. */
  /** A predict that hangs like a stuck request until cancelled or past its deadline. */
  function hangUntilAborted() {
    predictMock.mockImplementation(
      (_endpoint, _blob, _filename, options) =>
        new Promise((_resolve, reject) => {
          const signal = options?.signal;
          if (signal?.aborted) return reject(signal.reason);
          signal?.addEventListener("abort", () => reject(signal.reason));
          const left = (options?.deadline ?? Infinity) - Date.now();
          if (Number.isFinite(left)) {
            setTimeout(() => reject(new DOMException("timed out", "TimeoutError")), left);
          }
        }),
    );
  }

  it("stops a running request when the time budget runs out", async () => {
    hangUntilAborted();
    // Generous enough that preparation finishes and the requests really start.
    const { result } = await scanImage(layoutPath, { timeBudgetMs: 1500 });
    expect(predictMock).toHaveBeenCalledTimes(3);
    expect(result.regions.every((r) => r.error?.includes("time budget"))).toBe(true);
  });

  it("cancels requests that are already running", async () => {
    hangUntilAborted();
    const controller = new AbortController();
    const scan = scanImage(layoutPath, { signal: controller.signal });
    await vi.waitFor(() => expect(predictMock).toHaveBeenCalledTimes(3));
    controller.abort("cancelled by client");
    const { result } = await scan;
    expect(result.regions.map((r) => r.error)).toEqual(
      Array(3).fill("Not identified: the call was cancelled."),
    );
  });

  it("does not start any request when already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(scanImage(layoutPath, { signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(predictMock).not.toHaveBeenCalled();
  });

  it("lets requests already sent finish after a 429", async () => {
    const { BrickognizeError } = await import("../utils/errors.js");
    let calls = 0;
    predictMock.mockImplementation(async () => {
      if (++calls === 1) {
        throw new BrickognizeError("Brickognize API returned 429: slow down", "API_ERROR", 429);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
      return rawResult("3001", [{ name: "Red", score: 0.9 }]);
    });
    const boxes = Array.from({ length: 8 }, (_, i) => [i * 10, 10, i * 10 + 5, 20]);
    const { result } = await scanImage(layoutPath, { boxes });
    expect(result.regions.map((r) => r.status)).toEqual([
      "error",
      "success",
      "success",
      "success",
      "success",
      "error",
      "error",
      "error",
    ]);
    expect(predictMock).toHaveBeenCalledTimes(5);
  });

  it("keeps going after a 503 (not rate limiting)", async () => {
    const { BrickognizeError } = await import("../utils/errors.js");
    let calls = 0;
    predictMock.mockImplementation(async () => {
      if (++calls === 1) {
        throw new BrickognizeError("Brickognize API returned 503: busy", "API_ERROR", 503);
      }
      return rawResult("3001", [{ name: "Red", score: 0.9 }]);
    });
    const boxes = Array.from({ length: 8 }, (_, i) => [i * 10, 10, i * 10 + 5, 20]);
    const { result } = await scanImage(layoutPath, { boxes });
    expect(result.regions.filter((r) => r.status === "success")).toHaveLength(7);
    expect(result.warnings.map((w) => w.code)).not.toContain("RATE_LIMITED");
  });

  it("sends nothing when the budget is spent before recognition starts", async () => {
    const output = await scanImage(layoutPath, { timeBudgetMs: 1 }).catch((error: unknown) => {
      expect(error).toMatchObject({ name: expect.stringMatching(/AbortError|TimeoutError/) });
      return null;
    });
    if (!output) {
      expect(predictMock).not.toHaveBeenCalled();
      return;
    }
    const { result } = output;
    expect(predictMock).not.toHaveBeenCalled();
    expect(result.regions.every((r) => r.error?.includes("time budget"))).toBe(true);
  });

  it("does not send supplied boxes too small to identify", async () => {
    const { result } = await scanImage(layoutPath, {
      boxes: [
        [0.1, 0.2, 0.3, 0.4],
        [10, 13, 25, 24],
      ],
    });
    expect(predictMock).toHaveBeenCalledTimes(1);
    expect(result.regions[0].error).toContain("too small");
    expect(result.regions[1].status).toBe("success");
  });

  it("sends an approved thin box such as an axle", async () => {
    // 0.4% wide but 30% tall: a real part, unlike fractions.
    const { result } = await scanImage(layoutPath, { boxes: [[10, 10, 10.4, 40]] });
    expect(predictMock).toHaveBeenCalledTimes(1);
    expect(result.warnings.map((w) => w.code)).not.toContain("TINY_REGION");
  });

  it("isolates a region whose response can't be mapped", async () => {
    let calls = 0;
    predictMock.mockImplementation(async () =>
      ++calls === 1
        ? ({ listing_id: "l", items: [] } as unknown as RawSearchResults) // no bounding box, fine
        : ({ listing_id: "l", items: [null] } as unknown as RawSearchResults),
    );
    const { result } = await scanImage(layoutPath, {
      boxes: [
        [10, 13, 25, 24],
        [50, 16, 60, 30],
      ],
    });
    expect(result.regions[0].status).toBe("no_match");
    expect(result.regions[1].status).toBe("error");
  });

  it("reports detection settings for auto-detection and manual boxes", async () => {
    const auto = await scanImage(layoutPath, { detectOnly: true, minContrast: 15 });
    expect(auto.result.detectionSettings).toEqual({
      minContrast: 15,
      minPartSize: 0.03,
      joinGap: 0.5,
    });
    const manual = await scanImage(layoutPath, { detectOnly: true, boxes: [[10, 13, 25, 24]] });
    expect(manual.result.detectionSettings).toEqual(DETECTION_DEFAULTS);
  });

  it("rejects detection settings out of range", async () => {
    await expect(scanImage(layoutPath, { minContrast: 1 })).rejects.toThrow("minContrast");
    await expect(scanImage(layoutPath, { joinGap: 9 })).rejects.toThrow("joinGap");
  });

  it("paints other parts out of a crop only when asked", async () => {
    // A red L-shaped part with a blue part lying inside its box but not touching it.
    const path = await writeLayout("nested.png", 400, 300, [
      { left: 60, top: 40, width: 30, height: 200, color: "#c91a09" },
      { left: 60, top: 210, width: 200, height: 30, color: "#c91a09" },
      { left: 150, top: 110, width: 30, height: 30, color: "#0055bf" },
    ]);
    const blueIn = async (jpeg: Buffer) => {
      const { data, info } = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true });
      let n = 0;
      for (let i = 0; i < data.length; i += info.channels)
        if (data[i + 2] > 150 && data[i] < 80) n++;
      return n;
    };

    const byDefault = await scanImage(path, { detectOnly: true });
    expect(byDefault.result.regions.every((r) => r.paintedOut === undefined)).toBe(true);
    const isolated = await scanImage(path, { detectOnly: true, isolateParts: true });
    const lShape = isolated.result.regions.find((r) => (r.paintedOut ?? []).length > 0);
    expect(lShape?.paintedOut).toHaveLength(1);

    const crops = async (isolateParts: boolean) => {
      predictMock.mockClear();
      await scanImage(path, { isolateParts });
      const blobs = predictMock.mock.calls.map((call) => call[1] as Blob);
      return Promise.all(blobs.map(async (b) => blueIn(Buffer.from(await b.arrayBuffer()))));
    };
    // With isolation only the blue part's own crop has blue in it.
    expect((await crops(true)).filter((n) => n > 50)).toHaveLength(1);
    expect((await crops(false)).filter((n) => n > 50)).toHaveLength(2);
  });

  it("advises sending the original when the photo is small, for supplied boxes too", async () => {
    const { result } = await scanImage(layoutPath, { detectOnly: true, boxes: [[10, 13, 25, 24]] });
    expect(result.tips?.map((t) => t.code)).toEqual(["RESOLUTION"]);
    expect(result.tips?.[0].message).toContain("400×300");
  });

  it("reports the padding it used", async () => {
    const { result } = await scanImage(layoutPath, { detectOnly: true, padding: 0 });
    expect(result.padding).toBe(0);
  });

  it("stops sending crops once Brickognize limits requests", async () => {
    const { BrickognizeError } = await import("../utils/errors.js");
    predictMock.mockRejectedValue(
      new BrickognizeError("Brickognize API returned 429: slow down", "API_ERROR", 429),
    );
    const boxes = Array.from({ length: 12 }, (_, i) => [i * 8, 10, i * 8 + 5, 20]);
    const { result } = await scanImage(layoutPath, { boxes });
    // The first wave (concurrency 5) was in flight; nothing after it was sent.
    expect(predictMock.mock.calls.length).toBeLessThanOrEqual(5);
    expect(result.warnings.map((w) => w.code)).toContain("RATE_LIMITED");
    expect(result.regions.at(-1)?.error).toContain("limiting requests");
  });

  it("passes the scan deadline to predict", async () => {
    const before = Date.now();
    await scanImage(layoutPath, { boxes: [[10, 13, 25, 24]], timeBudgetMs: 30_000 });
    const deadline = predictMock.mock.calls[0][3]?.deadline ?? 0;
    expect(deadline).toBeGreaterThanOrEqual(before + 30_000);
    expect(deadline).toBeLessThanOrEqual(Date.now() + 30_000);
  });

  it("keeps region matches small: no catalog links", async () => {
    const { result } = await scanImage(layoutPath, { boxes: [[10, 13, 25, 24]] });
    expect(Object.keys(result.regions[0].matches?.[0] ?? {}).sort()).toEqual([
      "category",
      "id",
      "name",
      "score",
      "type",
    ]);
  });

  it("skips previews when asked", async () => {
    const { annotatedImage, cropSheet } = await scanImage(layoutPath, {
      detectOnly: true,
      previews: false,
    });
    expect(annotatedImage).toBeNull();
    expect(cropSheet).toBeNull();
  });

  it("warns about boxes that look like fractions instead of rejecting them", async () => {
    const { result } = await scanImage(layoutPath, {
      detectOnly: true,
      boxes: [[0.1, 0.2, 0.3, 0.4]],
    });
    expect(result.regions).toHaveLength(1);
    expect(result.warnings.map((w) => w.code)).toEqual(["TINY_REGION"]);
  });

  it("keeps a real API error even if the budget ran out meanwhile", async () => {
    const { BrickognizeError } = await import("../utils/errors.js");
    predictMock.mockImplementation(async (_endpoint, _blob, _filename, options) => {
      await new Promise((resolve) => setTimeout(resolve, (options?.deadline ?? 0) - Date.now()));
      throw new BrickognizeError("Brickognize API returned 500: boom", "API_ERROR", 500);
    });
    const { result } = await scanImage(layoutPath, { timeBudgetMs: 1500 });
    expect(predictMock).toHaveBeenCalled();
    expect(result.regions[0].error).toContain("500");
  });

  it("validates options before doing any work", async () => {
    await expect(scanImage(layoutPath, { padding: 0.9 })).rejects.toThrow("padding");
    await expect(scanImage(layoutPath, { maxRegions: 61 })).rejects.toThrow("maxRegions");
    await expect(scanImage(layoutPath, { boxes: [[5, 5, 1, 1]] })).rejects.toThrow("x1 < x2");
    await expect(scanImage(layoutPath, { timeBudgetMs: 1500.5 })).rejects.toThrow("integer");
    await expect(scanImage(layoutPath, { timeBudgetMs: 3e9 })).rejects.toThrow("integer");
    await expect(
      scanImage(layoutPath, { boxes: [], expectedSize: { width: 0, height: 10 } }),
    ).rejects.toThrow("expectedSize");
    expect(predictMock).not.toHaveBeenCalled();
  });
});

describe("toLookupBatches", () => {
  it("chunks entries into batches of 3 and omits unknown colors", () => {
    const groups = Array.from({ length: 45 }, (_, i) => ({
      partId: String(i),
      name: "",
      colorName: i === 0 ? null : "Red",
      count: 1,
      regionIds: [i + 1],
      minScore: 1,
    }));
    const batches = toLookupBatches(groups);
    expect(batches.map((b) => b.length)).toEqual(Array(15).fill(3));
    expect(batches[0][0]).toEqual({ partId: "0" });
  });
});

it("echoes isolation settings for reviewed manual crops and skips tiny boxes permanently", async () => {
  const { result } = await scanImage(layoutPath, {
    boxes: [[0, 0, 1, 1]],
    isolateParts: true,
    minContrast: 20,
    joinGap: 0,
    minPartSize: 0.1,
  });
  expect(result.isolateParts).toBe(true);
  expect(result.detectionSettings).toEqual({ minContrast: 20, joinGap: 0, minPartSize: 0.1 });
  expect(result.regions[0].error).toMatch(/^Skipped:/);
});
