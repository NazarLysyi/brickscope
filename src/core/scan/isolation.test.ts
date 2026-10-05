import { describe, it, expect } from "vitest";
import { paintOut, planIsolation } from "./isolation.js";
import type { DetectedPart, Segmentation } from "./segment.js";
import type { PercentBox, PixelRect } from "./types.js";

type Rgb = [number, number, number];
const SURFACE: Rgb = [230, 170, 225];
const GRAY: Rgb = [120, 120, 120];

/** A 100×100 image on pink paper; each part's rect gets its label and a plain gray. */
function segmentation(parts: DetectedPart[]): Segmentation {
  const width = 100;
  const height = 100;
  const labels = new Int32Array(width * height).fill(-1);
  const data = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) data.set(SURFACE, i * 3);
  parts.forEach((part, index) => {
    const { left, top, width: w, height: h } = part.rect;
    for (let y = top; y < top + h; y++) {
      labels.fill(index, y * width + left, y * width + left + w);
      for (let x = left; x < left + w; x++) data.set(GRAY, (y * width + x) * 3);
    }
  });
  return {
    rects: [],
    backgroundUniform: true,
    backgroundColor: [90, 0, 0],
    width,
    height,
    parts,
    labels,
    image: { data, width, height },
  };
}

/** Touching shapes merged into one component (label 0), later shapes drawn on top. */
function merged(shapes: { rect: PixelRect; rgb: Rgb }[]): Segmentation {
  const seg = segmentation([]);
  const pixels = new Set<number>();
  for (const { rect, rgb } of shapes) {
    for (let y = rect.top; y < rect.top + rect.height; y++) {
      for (let x = rect.left; x < rect.left + rect.width; x++) {
        const i = y * seg.width + x;
        seg.labels[i] = 0;
        seg.image.data.set(rgb, i * 3);
        pixels.add(i);
      }
    }
  }
  const xs = [...pixels].map((i) => i % seg.width);
  const ys = [...pixels].map((i) => Math.floor(i / seg.width));
  const [left, top] = [Math.min(...xs), Math.min(...ys)];
  seg.parts.push({
    rect: { left, top, width: Math.max(...xs) - left + 1, height: Math.max(...ys) - top + 1 },
    cx: xs.reduce((a, b) => a + b, 0) / xs.length,
    cy: ys.reduce((a, b) => a + b, 0) / ys.length,
  });
  return seg;
}

const rect = (left: number, top: number, width: number, height: number): PixelRect => ({
  left,
  top,
  width,
  height,
});
const RED: Rgb = [200, 30, 30];
const BLUE: Rgb = [30, 60, 200];
const BLACK: Rgb = [20, 20, 22];
const TAN: Rgb = [215, 195, 145];

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

  it("splits same-colored touching parts midway between their boxes", () => {
    const merged = [part(10, 10, 60, 20)];
    const plan = planIsolation(
      segmentation(merged),
      [
        [10, 10, 40, 30],
        [40, 10, 70, 30],
      ],
      [
        [5, 5, 45, 35],
        [35, 5, 75, 35],
      ],
      [],
    );
    const ownerAt = (x: number, y: number) => plan.owners[plan.labels[y * 100 + x]];
    expect(ownerAt(36, 20)).toBe(0);
    expect(ownerAt(43, 20)).toBe(1);
    expect(plan.paintedOut).toEqual([[2], [1]]);
  });

  it("never paints between duplicate boxes", () => {
    const plan = planIsolation(segmentation(parts), boxes, boxes, [[1, 2]]);
    expect(plan.erase.every((set) => set.size === 0)).toBe(true);
  });
});

describe("planIsolation with touching parts", () => {
  const labelAt = (labels: Int32Array, x: number, y: number) => labels[y * 100 + x];
  // Padded crops of a red and a blue bar touching at x = 40, each reaching into the other.
  const crops: PercentBox[] = [
    [5, 5, 45, 35],
    [35, 5, 75, 35],
  ];

  it("splits a merged component between the boxes of its parts by color", () => {
    const seg = merged([
      { rect: rect(10, 10, 30, 20), rgb: RED },
      { rect: rect(40, 10, 30, 20), rgb: BLUE },
    ]);
    const boxes: PercentBox[] = [
      [10, 10, 40, 30],
      [40, 10, 70, 30],
    ];
    const plan = planIsolation(seg, boxes, crops, []);
    const red = labelAt(plan.labels, 25, 20);
    const blue = labelAt(plan.labels, 55, 20);
    expect(red).not.toBe(blue);
    expect(plan.owners[red]).toBe(0);
    expect(plan.owners[blue]).toBe(1);
    // The boxes' margins overlap around x = 40; color settles it.
    expect(plan.owners[labelAt(plan.labels, 39, 20)]).toBe(0);
    expect(plan.owners[labelAt(plan.labels, 40, 20)]).toBe(1);
    expect(plan.erase.map((set) => [...set])).toEqual([[blue], [red]]);
    expect(plan.paintedOut).toEqual([[2], [1]]);
    // The segmentation itself is left untouched.
    expect(labelAt(seg.labels, 25, 20)).toBe(0);
  });

  it("splits a part out of a box inside another box, keeping what it encloses", () => {
    // A tan gear lying against a black beam; the gear's box lies inside the beam's box, and
    // the gear's dark middle is closer to the beam's color.
    const seg = merged([
      { rect: rect(10, 50, 80, 10), rgb: BLACK },
      { rect: rect(40, 30, 20, 20), rgb: TAN },
      { rect: rect(47, 37, 6, 6), rgb: BLACK },
    ]);
    const boxes: PercentBox[] = [
      [8, 28, 92, 62],
      [39, 29, 61, 51],
    ];
    const plan = planIsolation(seg, boxes, boxes, []);
    const ownerAt = (x: number, y: number) => plan.owners[labelAt(plan.labels, x, y)];
    expect(ownerAt(20, 55)).toBe(0); // beam
    expect(ownerAt(50, 55)).toBe(0); // beam, inside the gear's box
    expect(ownerAt(43, 33)).toBe(1); // gear
    expect(ownerAt(49, 39)).toBe(1); // gear's dark middle
    expect(plan.paintedOut).toEqual([[2], [1]]);
  });

  it("leaves a merged component whole between duplicate boxes", () => {
    const seg = merged([
      { rect: rect(10, 10, 30, 20), rgb: RED },
      { rect: rect(40, 10, 30, 20), rgb: BLUE },
    ]);
    const boxes: PercentBox[] = [
      [10, 10, 70, 30],
      [11, 10, 70, 30],
    ];
    const plan = planIsolation(seg, boxes, boxes, [[1, 2]]);
    expect(plan.labels).toBe(seg.labels);
    expect(plan.erase.every((set) => set.size === 0)).toBe(true);
  });

  it("paints the neighbor's piece out of each crop", () => {
    const seg = merged([
      { rect: rect(10, 10, 30, 20), rgb: RED },
      { rect: rect(40, 10, 30, 20), rgb: BLUE },
    ]);
    const boxes: PercentBox[] = [
      [10, 10, 40, 30],
      [40, 10, 70, 30],
    ];
    const plan = planIsolation(seg, boxes, crops, []);
    const whole = rect(0, 0, 100, 100);
    const data = Uint8Array.from(seg.image.data);
    paintOut(data, whole, 100, 100, {
      labels: plan.labels,
      width: 100,
      height: 100,
      erase: plan.erase[0],
    });
    const count = (rgb: Rgb) =>
      [...Array(100 * 100).keys()].filter((i) => rgb.every((c, k) => data[i * 3 + k] === c)).length;
    expect(count(BLUE)).toBe(0);
    expect(count(RED)).toBe(30 * 20);
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
