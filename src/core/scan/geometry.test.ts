import { describe, it, expect } from "vitest";
import {
  expandRect,
  findDuplicateBoxes,
  iou,
  percentToPixels,
  pixelsToPercent,
  validateBoxes,
} from "./geometry.js";
import type { PercentBox } from "./types.js";

describe("percentToPixels", () => {
  it("maps the full image to the full raster", () => {
    expect(percentToPixels([0, 0, 100, 100], { width: 1000, height: 500 })).toEqual({
      left: 0,
      top: 0,
      width: 1000,
      height: 500,
    });
  });

  it("scales X and Y independently and rounds edges outwards", () => {
    expect(percentToPixels([10, 20, 30.05, 40], { width: 1000, height: 500 })).toEqual({
      left: 100,
      top: 100,
      width: 201,
      height: 100,
    });
  });

  it("does not round exact edges outwards because of float noise", () => {
    // 0.3% of 1000 is 3.0000000000000004 in floating point
    expect(percentToPixels([0.3, 0, 0.6, 100], { width: 1000, height: 10 })).toMatchObject({
      left: 3,
      width: 3,
    });
  });

  it("returns at least a 1x1 rect clamped inside the raster", () => {
    expect(percentToPixels([100, 100, 100, 100], { width: 50, height: 50 })).toEqual({
      left: 49,
      top: 49,
      width: 1,
      height: 1,
    });
  });
});

describe("pixelsToPercent", () => {
  it("rounds outwards to 2 decimals", () => {
    expect(
      pixelsToPercent({ left: 1, top: 1, width: 1, height: 1 }, { width: 3, height: 3 }),
    ).toEqual([33.33, 33.33, 66.67, 66.67]);
  });

  it("round-trips to a rect that contains the original", () => {
    const size = { width: 1234, height: 567 };
    for (const rect of [
      { left: 0, top: 0, width: 1, height: 1 },
      { left: 17, top: 33, width: 101, height: 7 },
      { left: 1100, top: 500, width: 134, height: 67 },
    ]) {
      const back = percentToPixels(pixelsToPercent(rect, size), size);
      expect(back.left).toBeLessThanOrEqual(rect.left);
      expect(back.top).toBeLessThanOrEqual(rect.top);
      expect(back.left + back.width).toBeGreaterThanOrEqual(rect.left + rect.width);
      expect(back.top + back.height).toBeGreaterThanOrEqual(rect.top + rect.height);
      expect(back.width - rect.width).toBeLessThanOrEqual(2);
    }
  });
});

describe("expandRect", () => {
  it("pads every side by a fraction of the longer side", () => {
    expect(
      expandRect({ left: 10, top: 10, width: 20, height: 10 }, 0.1, { width: 100, height: 100 }),
    ).toEqual({ left: 8, top: 8, width: 24, height: 14 });
  });

  it("clamps to the raster instead of shifting", () => {
    expect(
      expandRect({ left: 0, top: 95, width: 10, height: 5 }, 0.5, { width: 100, height: 100 }),
    ).toEqual({ left: 0, top: 90, width: 15, height: 10 });
  });
});

describe("iou and duplicates", () => {
  it("computes intersection over union", () => {
    expect(iou([0, 0, 10, 10], [0, 0, 10, 10])).toBe(1);
    expect(iou([0, 0, 10, 10], [20, 20, 30, 30])).toBe(0);
    expect(iou([0, 0, 10, 10], [5, 0, 15, 10])).toBeCloseTo(1 / 3);
  });

  it("reports heavily overlapping boxes by 1-based id", () => {
    const boxes: PercentBox[] = [
      [0, 0, 10, 10],
      [40, 40, 50, 50],
      [0.5, 0.5, 10, 10],
    ];
    expect(findDuplicateBoxes(boxes)).toEqual([[1, 3]]);
  });

  it("does not pair a frame box with every part inside it", () => {
    const boxes: PercentBox[] = [
      [0, 0, 100, 100],
      [10, 10, 20, 20],
      [50, 50, 60, 60],
    ];
    expect(findDuplicateBoxes(boxes)).toEqual([]);
  });

  it("reports a box that contains another", () => {
    const boxes: PercentBox[] = [
      [10, 10, 40, 30],
      [10, 10, 25, 30],
      [60, 60, 70, 70],
    ];
    expect(findDuplicateBoxes(boxes)).toEqual([[1, 2]]);
  });
});

describe("validateBoxes", () => {
  it("accepts an array of percent boxes, including an empty one", () => {
    expect(validateBoxes([[1, 2, 3, 4]], 10)).toEqual([[1, 2, 3, 4]]);
    expect(validateBoxes([], 10)).toEqual([]);
  });

  it.each([
    ["not an array", "nope", "array"],
    ["a regions.json object", { boxes: [[1, 2, 3, 4]] }, "array"],
    [
      "too many boxes",
      [
        [1, 2, 3, 4],
        [1, 2, 3, 4],
        [1, 2, 3, 4],
      ],
      "Maximum is 2",
    ],
    ["a box with 3 numbers", [[1, 2, 3]], "four numbers"],
    ["a non-finite value", [[1, 2, Number.NaN, 4]], "four numbers"],
    ["a value above 100", [[1, 2, 300, 4]], "0–100"],
    ["an inverted box", [[10, 2, 5, 4]], "x1 < x2"],
  ])("rejects %s", (_label, input, message) => {
    expect(() => validateBoxes(input, 2)).toThrow(message);
  });
});
