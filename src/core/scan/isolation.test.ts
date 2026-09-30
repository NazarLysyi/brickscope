import { describe, it, expect } from "vitest";
import { paintOut, planIsolation } from "./isolation.js";
import type { DetectedPart, Segmentation } from "./segment.js";
import type { PercentBox } from "./types.js";

function segmentation(parts: DetectedPart[]): Segmentation {
  const width = 100;
  const height = 100;
  const labels = new Int32Array(width * height).fill(-1);
  parts.forEach((part, index) => {
    const { left, top, width: w, height: h } = part.rect;
    for (let y = top; y < top + h; y++) labels.fill(index, y * width + left, y * width + left + w);
  });
  return {
    rects: [],
    backgroundUniform: true,
    backgroundColor: [90, 0, 0],
    width,
    height,
    parts,
    labels,
  };
}

const part = (left: number, top: number, width: number, height: number): DetectedPart => ({
  rect: { left, top, width, height },
  cx: left + width / 2,
  cy: top + height / 2,
});

describe("planIsolation", () => {
  // A long part (0) whose box also holds a small part (1), like a pin inside a bent liftarm's box.
  const parts = [part(10, 10, 40, 60), part(30, 40, 6, 6)];
  const boxes: PercentBox[] = [
    [10, 10, 50, 70],
    [29, 39, 37, 47],
  ];

  it("paints a small part out of the big part's crop, and the big part out of the small one's", () => {
    const plan = planIsolation(segmentation(parts), boxes, boxes, []);
    expect(plan.erase.map((set) => [...set])).toEqual([[1], [0]]);
    expect(plan.paintedOut).toEqual([[2], [1]]);
  });

  it("leaves a part that fits no single box alone (touching parts, shadows)", () => {
    const merged = [part(10, 10, 60, 20)];
    const plan = planIsolation(
      segmentation(merged),
      [
        [10, 10, 40, 30],
        [40, 10, 70, 30],
      ],
      [
        [10, 10, 40, 30],
        [40, 10, 70, 30],
      ],
      [],
    );
    expect(plan.erase.every((set) => set.size === 0)).toBe(true);
  });

  it("never paints between duplicate boxes", () => {
    const plan = planIsolation(segmentation(parts), boxes, boxes, [[1, 2]]);
    expect(plan.erase.every((set) => set.size === 0)).toBe(true);
  });
});

describe("paintOut", () => {
  it("paints the listed part with the crop's background color", () => {
    const seg = segmentation([part(2, 2, 3, 3)]);
    const rect = { left: 0, top: 0, width: 10, height: 10 };
    const data = new Uint8Array(10 * 10 * 3).fill(200);
    for (let y = 2; y < 5; y++) for (let x = 2; x < 5; x++) data.set([0, 0, 255], (y * 10 + x) * 3);
    // Image 10×10 over labels 100×100: scale the labels down to match by using a 100×100 image.
    paintOut(data, rect, 100, 100, {
      labels: seg.labels,
      width: 100,
      height: 100,
      erase: new Set([0]),
    });
    const blue = [...Array(100).keys()].filter((i) => data[i * 3 + 2] === 255 && data[i * 3] === 0);
    expect(blue).toEqual([]);
    expect([...data.subarray(0, 3)]).toEqual([200, 200, 200]);
  });
});

it("protects the target's own merged component even if another box owns it", () => {
  const boxes: PercentBox[] = [
    [10, 10, 70, 30],
    [45, 10, 70, 30],
  ];
  const plan = planIsolation(segmentation([part(10, 10, 60, 20)]), boxes, boxes, []);
  expect(plan.erase[1].size).toBe(0);
  expect(plan.paintedOut[1]).toEqual([]);
});

it("does not report painting an empty corner of a component's bounding box", () => {
  const seg = segmentation([part(10, 10, 40, 60), part(30, 40, 6, 6)]);
  const boxes: PercentBox[] = [
    [10, 10, 50, 70],
    [30, 40, 36, 46],
  ];
  const crops: PercentBox[] = [boxes[0], [30, 40, 36, 46]];
  const plan = planIsolation(seg, boxes, crops, []);
  expect(plan.paintedOut[1]).toEqual([]);
});

it("does not grow erased fringes into a retained component", () => {
  const data = new Uint8Array([255, 0, 0, 0, 0, 255]);
  paintOut(data, { left: 0, top: 0, width: 2, height: 1 }, 2, 1, {
    width: 2,
    height: 1,
    labels: new Int32Array([0, 1]),
    erase: new Set([0]),
  });
  expect([...data.subarray(3)]).toEqual([0, 0, 255]);
});

it("paints a long neighbor out of a small part's box even where it has more pixels there", () => {
  // A bar (0) crosses the box of a pin (1) lying against it: the box holds more bar than pin.
  const seg = segmentation([part(0, 40, 100, 10), part(45, 50, 10, 6)]);
  const boxes: PercentBox[] = [
    [0, 40, 100, 50],
    [44, 38, 56, 57],
  ];
  const plan = planIsolation(seg, boxes, boxes, []);
  expect(plan.erase[1].has(0)).toBe(true);
  expect(plan.erase[1].has(1)).toBe(false);
});
