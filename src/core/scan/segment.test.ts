import { describe, it, expect } from "vitest";
import { segmentParts } from "./segment.js";
import type { RgbImage } from "./types.js";

type Rgb = [number, number, number];

const WHITE: Rgb = [245, 245, 240];
const RED: Rgb = [201, 26, 9];
const BLUE: Rgb = [0, 85, 191];
const GREEN: Rgb = [35, 120, 65];

function canvas(width: number, height: number, color: Rgb): RgbImage {
  const data = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) data.set(color, i * 3);
  return { data, width, height };
}

function fill(image: RgbImage, left: number, top: number, w: number, h: number, color: Rgb) {
  for (let y = top; y < top + h; y++) {
    for (let x = left; x < left + w; x++) image.data.set(color, (y * image.width + x) * 3);
  }
}

describe("segmentParts", () => {
  it("finds separate parts on a plain background, in reading order", () => {
    const image = canvas(400, 300, WHITE);
    fill(image, 100, 180, 80, 50, GREEN);
    fill(image, 200, 50, 40, 40, BLUE);
    fill(image, 40, 40, 60, 30, RED);

    const { rects, backgroundUniform } = segmentParts(image);

    expect(backgroundUniform).toBe(true);
    expect(rects.map(({ left, top, width, height }) => ({ left, top, width, height }))).toEqual([
      { left: 40, top: 40, width: 60, height: 30 },
      { left: 200, top: 50, width: 40, height: 40 },
      { left: 100, top: 180, width: 80, height: 50 },
    ]);
    expect(rects.every((r) => !r.touchesBorder && !r.large)).toBe(true);
  });

  it("returns nothing for an empty background", () => {
    const { rects, backgroundUniform } = segmentParts(canvas(300, 200, WHITE));
    expect(rects).toEqual([]);
    expect(backgroundUniform).toBe(true);
  });

  it("ignores specks of noise", () => {
    const image = canvas(300, 200, WHITE);
    fill(image, 50, 50, 1, 1, RED);
    fill(image, 120, 90, 2, 2, BLUE);
    expect(segmentParts(image).rects).toEqual([]);
  });

  it("flags regions that touch the image edge", () => {
    const image = canvas(300, 200, WHITE);
    fill(image, 0, 80, 40, 30, RED);
    fill(image, 150, 80, 40, 30, BLUE);
    expect(segmentParts(image).rects.map((r) => r.touchesBorder)).toEqual([true, false]);
  });

  it("flags a region much larger than the others", () => {
    const image = canvas(400, 300, WHITE);
    fill(image, 20, 20, 20, 20, RED);
    fill(image, 80, 20, 20, 20, BLUE);
    fill(image, 140, 20, 20, 20, GREEN);
    fill(image, 60, 120, 120, 100, RED);
    expect(segmentParts(image).rects.map((r) => r.large)).toEqual([false, false, false, true]);
  });

  it("does not mistake vignetting for a part", () => {
    const width = 400;
    const height = 300;
    const image = canvas(width, height, WHITE);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const r2 = ((x - width / 2) / (width / 2)) ** 2 + ((y - height / 2) / (height / 2)) ** 2;
        const v = Math.round(240 - 45 * r2);
        image.data.set([v, v, v + 4], (y * width + x) * 3);
      }
    }
    fill(image, 40, 40, 60, 30, RED);
    fill(image, 180, 130, 40, 40, BLUE);
    fill(image, 300, 220, 50, 30, GREEN);

    const { rects } = segmentParts(image);
    expect(rects.map(({ left, top }) => [left, top])).toEqual([
      [40, 40],
      [180, 130],
      [300, 220],
    ]);
    expect(rects.some((r) => r.large)).toBe(false);
  });

  it("finds the full extent of a part larger than a background cell", () => {
    const image = canvas(400, 300, WHITE);
    fill(image, 100, 90, 200, 120, BLUE);
    expect(segmentParts(image).rects).toEqual([
      expect.objectContaining({ left: 100, top: 90, width: 200, height: 120 }),
    ]);
  });

  it("still finds low-contrast parts when another part touches the edge", () => {
    const image = canvas(1024, 768, WHITE);
    fill(image, 0, 100, 60, 400, RED);
    fill(image, 300, 300, 80, 50, [160, 165, 169]); // light bluish gray
    fill(image, 500, 300, 80, 50, [228, 205, 158]); // tan
    const { rects, backgroundUniform } = segmentParts(image);
    expect(rects.map(({ left, top }) => [left, top])).toEqual([
      [0, 100],
      [300, 300],
      [500, 300],
    ]);
    expect(backgroundUniform).toBe(true);
  });

  it("finds a large part that spans the whole image height as one region", () => {
    const image = canvas(1024, 768, WHITE);
    fill(image, 300, 0, 300, 768, BLUE);
    expect(segmentParts(image).rects).toEqual([
      expect.objectContaining({ left: 300, top: 0, width: 300, height: 768 }),
    ]);
  });

  it("keeps an edge-touching part separate from its neighbor", () => {
    const image = canvas(400, 300, WHITE);
    fill(image, 0, 60, 250, 180, BLUE);
    fill(image, 260, 100, 40, 40, RED);
    expect(segmentParts(image).rects.map(({ left, width }) => [left, width])).toEqual([
      [260, 40],
      [0, 250],
    ]);
  });

  // Up to about half the frame: beyond that the part is the most common color, which the
  // detector takes to be the background (as it must for a sheet of paper on a table).
  it.each([
    [500, 400],
    [600, 500],
  ])("finds a large low-contrast %ix%i part", (w, h) => {
    const image = canvas(1024, 768, WHITE);
    const left = (1024 - w) / 2;
    const top = (768 - h) / 2;
    fill(image, left, top, w, h, [200, 200, 200]);
    expect(segmentParts(image).rects).toEqual([
      expect.objectContaining({ left, top, width: w, height: h }),
    ]);
  });

  it("finds parts on a sheet of paper with the table visible around it", () => {
    const image = canvas(1024, 768, [120, 80, 50]);
    fill(image, 60, 60, 904, 648, WHITE);
    fill(image, 200, 200, 80, 50, RED);
    fill(image, 500, 300, 60, 60, BLUE);
    const { rects } = segmentParts(image);
    const parts = rects.filter((r) => !r.touchesBorder);
    expect(parts.map(({ left, top }) => [left, top])).toEqual([
      [200, 200],
      [500, 300],
    ]);
    // The table frame is one region, flagged so the reviewer drops it.
    expect(rects.filter((r) => r.touchesBorder).every((r) => r.large)).toBe(true);
  });

  it("finds many same-colored parts laid out close together", () => {
    const image = canvas(1024, 768, WHITE);
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 5; col++) fill(image, 40 + col * 180, 40 + row * 130, 150, 100, RED);
    }
    expect(segmentParts(image).rects).toHaveLength(25);
  });

  it("finds a large part on a background with a lighting gradient", () => {
    const image = canvas(1024, 1024, WHITE);
    for (let y = 0; y < 1024; y++) {
      for (let x = 0; x < 1024; x++) {
        const v = Math.round(160 + (85 * x) / 1023);
        image.data.set([v, v, v], (y * 1024 + x) * 3);
      }
    }
    fill(image, 256, 128, 512, 768, BLUE);
    expect(segmentParts(image).rects).toEqual([
      expect.objectContaining({ left: 256, top: 128, width: 512, height: 768 }),
    ]);
  });

  it("finds parts on a sheet even when the table fills more of the frame", () => {
    const image = canvas(1024, 768, [120, 80, 50]);
    fill(image, 200, 150, 624, 468, WHITE);
    fill(image, 300, 250, 60, 40, RED);
    fill(image, 500, 350, 50, 50, BLUE);
    const parts = segmentParts(image).rects.filter((r) => !r.touchesBorder);
    expect(parts.map(({ left, top }) => [left, top])).toEqual([
      [300, 250],
      [500, 350],
    ]);
  });

  it("keeps the background uniform when a table frame rings the whole photo", () => {
    const image = canvas(1024, 768, [120, 80, 50]);
    fill(image, 50, 50, 924, 668, WHITE);
    fill(image, 300, 300, 80, 50, RED);
    const { rects, backgroundUniform } = segmentParts(image);
    expect(backgroundUniform).toBe(true);
    expect(rects.filter((r) => !r.touchesBorder)).toHaveLength(1);
  });

  it("does not box the corners of strong vignetting", () => {
    const image = canvas(400, 300, WHITE);
    for (let y = 0; y < 300; y++) {
      for (let x = 0; x < 400; x++) {
        const v = Math.round(240 - 45 * (((x - 200) / 200) ** 2 + ((y - 150) / 150) ** 2));
        image.data.set([v, v, v + 4], (y * 400 + x) * 3);
      }
    }
    fill(image, 180, 130, 40, 40, BLUE);
    expect(segmentParts(image).rects.map(({ left, top }) => [left, top])).toEqual([[180, 130]]);
  });

  describe("settings", () => {
    it("minContrast drops parts that differ less from the surface", () => {
      const image = canvas(400, 300, WHITE);
      fill(image, 50, 50, 60, 40, [215, 215, 210]); // ΔE ≈ 12 from the surface
      fill(image, 250, 150, 60, 40, RED);
      expect(segmentParts(image).rects).toHaveLength(2);
      expect(
        segmentParts(image, { minContrast: 20, minPartSize: 0.03, joinGap: 0.5 }).rects,
      ).toHaveLength(1);
    });

    it("minPartSize drops small regions", () => {
      const image = canvas(400, 300, WHITE);
      fill(image, 50, 50, 8, 8, RED); // 0.05% of the image
      fill(image, 250, 150, 60, 40, BLUE);
      expect(segmentParts(image).rects).toHaveLength(2);
      expect(
        segmentParts(image, { minContrast: 10, minPartSize: 0.1, joinGap: 0.5 }).rects,
      ).toHaveLength(1);
    });

    it("joinGap decides whether parts lying close stay separate", () => {
      const image = canvas(800, 600, WHITE);
      fill(image, 100, 100, 100, 60, RED);
      fill(image, 203, 100, 100, 60, BLUE); // a 3px gap
      expect(segmentParts(image).rects).toHaveLength(1);
      expect(
        segmentParts(image, { minContrast: 10, minPartSize: 0.03, joinGap: 0 }).rects,
      ).toHaveLength(2);
    });
  });

  it("reports a textured background as not uniform", () => {
    const image = canvas(240, 160, WHITE);
    for (let y = 0; y < 160; y += 8) {
      for (let x = (y / 8) % 2 === 0 ? 0 : 8; x < 240; x += 16)
        fill(image, x, y, 8, 8, [40, 30, 20]);
    }
    expect(segmentParts(image).backgroundUniform).toBe(false);
  });

  it("keeps two touching parts as one region (a known limitation the agent resolves)", () => {
    const image = canvas(300, 200, WHITE);
    fill(image, 50, 50, 40, 40, RED);
    fill(image, 90, 50, 40, 40, BLUE);
    expect(segmentParts(image).rects).toHaveLength(1);
  });
});

it("computes a component color without a differently colored part inside its box", () => {
  const image = canvas(400, 300, WHITE);
  fill(image, 80, 60, 10, 120, RED);
  fill(image, 80, 170, 120, 10, RED);
  const alone = segmentParts(image).rects[0].color;
  fill(image, 110, 90, 60, 50, BLUE);
  const result = segmentParts(image);
  expect(result.rects).toHaveLength(2);
  const bent = result.rects.find((r) => r.width === 120)!;
  bent.color.forEach((value, i) => expect(value).toBeCloseTo(alone[i], 4));
});
