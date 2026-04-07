import { describe, it, expect } from "vitest";
import { mapPredictionResult } from "./mappers.js";
import type { RawSearchResults } from "./types.js";

const BASE_RAW: RawSearchResults = {
  listing_id: "abc123",
  bounding_box: {
    left: 10,
    upper: 20,
    right: 110,
    lower: 120,
    image_width: 640,
    image_height: 480,
    score: 0.95,
  },
  items: [
    {
      id: "3001",
      name: "Brick 2x4",
      img_url: "https://example.com/3001.jpg",
      external_sites: [{ name: "BrickLink", url: "https://bricklink.com/3001" }],
      category: "Brick",
      type: "part",
      score: 0.9,
    },
    {
      id: "3002",
      name: "Brick 2x3",
      img_url: "https://example.com/3002.jpg",
      external_sites: [],
      category: "Brick",
      type: "part",
      score: 0.6,
    },
  ],
};

describe("mapPredictionResult — bounding box", () => {
  it("maps snake_case fields to camelCase", () => {
    const result = mapPredictionResult(BASE_RAW, false);
    expect(result.boundingBox).toEqual({
      left: 10,
      upper: 20,
      right: 110,
      lower: 120,
      imageWidth: 640,
      imageHeight: 480,
      score: 0.95,
    });
  });
});

describe("mapPredictionResult — matches", () => {
  it("maps items to matches with camelCase imageUrl", () => {
    const result = mapPredictionResult(BASE_RAW, false);
    expect(result.matches[0]).toMatchObject({
      id: "3001",
      name: "Brick 2x4",
      type: "part",
      category: "Brick",
      score: 0.9,
      imageUrl: "https://example.com/3001.jpg",
    });
  });

  it("sorts matches by score descending regardless of input order", () => {
    // Explicitly provide items in ascending order to prove sorting happens
    const raw: RawSearchResults = {
      ...BASE_RAW,
      items: [
        { ...BASE_RAW.items[0], id: "low", score: 0.3 },
        { ...BASE_RAW.items[0], id: "high", score: 0.95 },
        { ...BASE_RAW.items[0], id: "mid", score: 0.6 },
      ],
    };
    const result = mapPredictionResult(raw, false);
    expect(result.matches.map((m) => m.id)).toEqual(["high", "mid", "low"]);
  });

  it("maps external sites", () => {
    const result = mapPredictionResult(BASE_RAW, false);
    expect(result.matches[0].externalSites).toEqual([
      { name: "BrickLink", url: "https://bricklink.com/3001" },
    ]);
  });

  it("handles empty items array", () => {
    const raw: RawSearchResults = { ...BASE_RAW, items: [] };
    const result = mapPredictionResult(raw, false);
    expect(result.matches).toEqual([]);
  });

  it("handles missing external_sites gracefully", () => {
    const raw: RawSearchResults = {
      ...BASE_RAW,
      items: [{ ...BASE_RAW.items[0], external_sites: undefined as unknown as [] }],
    };
    const result = mapPredictionResult(raw, false);
    expect(result.matches[0].externalSites).toEqual([]);
  });
});

describe("mapPredictionResult — predictedColors", () => {
  it("maps colors array when present", () => {
    const raw: RawSearchResults = {
      ...BASE_RAW,
      colors: [
        { id: "0", name: "Black", score: 0.85 },
        { id: "4", name: "Red", score: 0.1 },
      ],
    };
    const result = mapPredictionResult(raw, false);
    expect(result.predictedColors).toEqual([
      { id: "0", name: "Black", score: 0.85 },
      { id: "4", name: "Red", score: 0.1 },
    ]);
  });

  it("omits predictedColors when colors absent", () => {
    const result = mapPredictionResult(BASE_RAW, false);
    expect(result.predictedColors).toBeUndefined();
  });
});

describe("mapPredictionResult — raw field", () => {
  it("includes raw when includeRaw is true", () => {
    const result = mapPredictionResult(BASE_RAW, true);
    expect(result.raw).toBe(BASE_RAW);
  });

  it("omits raw when includeRaw is false", () => {
    const result = mapPredictionResult(BASE_RAW, false);
    expect(result.raw).toBeUndefined();
  });
});

describe("mapPredictionResult — summary", () => {
  it("returns 'No matches found.' when items is empty", () => {
    const raw: RawSearchResults = { ...BASE_RAW, items: [] };
    const result = mapPredictionResult(raw, false);
    expect(result.summary).toBe("No matches found.");
  });

  it("includes top match name, type, id and formatted score", () => {
    const result = mapPredictionResult(BASE_RAW, false);
    expect(result.summary).toContain("Brick 2x4");
    expect(result.summary).toContain("part");
    expect(result.summary).toContain("3001");
    expect(result.summary).toContain("90.0%");
  });

  it("mentions total match count", () => {
    const result = mapPredictionResult(BASE_RAW, false);
    expect(result.summary).toContain("2 total matches");
  });

  it("uses singular 'match' when only one result", () => {
    const raw: RawSearchResults = { ...BASE_RAW, items: [BASE_RAW.items[0]] };
    const result = mapPredictionResult(raw, false);
    expect(result.summary).toContain("1 total match.");
    expect(result.summary).not.toContain("matches");
  });

  it("includes predicted colors in summary", () => {
    const raw: RawSearchResults = {
      ...BASE_RAW,
      colors: [{ id: "0", name: "Black", score: 0.85 }],
    };
    const result = mapPredictionResult(raw, false);
    expect(result.summary).toContain("Black");
    expect(result.summary).toContain("85.0%");
  });

  it("omits color section from summary when no colors", () => {
    const result = mapPredictionResult(BASE_RAW, false);
    expect(result.summary).not.toContain("Predicted color");
  });
});
