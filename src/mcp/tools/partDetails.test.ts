import { describe, it, expect } from "vitest";
import { normalizeColorName, matchColorByName, buildSingleSummary } from "./partDetails.js";
import type { RebrickablePartColor } from "../../core/rebrickable/types.js";

const makeColor = (id: number, name: string, numSets = 10): RebrickablePartColor => ({
  color_id: id,
  color_name: name,
  num_sets: numSets,
  num_set_parts: numSets * 2,
  part_img_url: null,
  elements: [],
});

describe("normalizeColorName", () => {
  it("lowercases the name", () => {
    expect(normalizeColorName("Black")).toBe("black");
  });

  it("trims leading and trailing whitespace", () => {
    expect(normalizeColorName("  Red  ")).toBe("red");
  });

  it("handles mixed case and spaces together", () => {
    expect(normalizeColorName("  Dark Bluish Gray  ")).toBe("dark bluish gray");
  });
});

describe("matchColorByName", () => {
  const colors = [makeColor(0, "Black"), makeColor(4, "Red"), makeColor(72, "Dark Bluish Gray")];

  it("finds exact match case-insensitively", () => {
    expect(matchColorByName(colors, "black")?.color_id).toBe(0);
    expect(matchColorByName(colors, "BLACK")?.color_id).toBe(0);
    expect(matchColorByName(colors, "Black")?.color_id).toBe(0);
  });

  it("trims whitespace before matching", () => {
    expect(matchColorByName(colors, "  Red  ")?.color_id).toBe(4);
  });

  it("matches multi-word color names", () => {
    expect(matchColorByName(colors, "dark bluish gray")?.color_id).toBe(72);
  });

  it("returns undefined when color not found", () => {
    expect(matchColorByName(colors, "Neon Pink")).toBeUndefined();
  });

  it("returns undefined for near-miss names (no fuzzy matching)", () => {
    // Brickognize may call it "Dark Stone Grey"; Rebrickable calls it "Dark Bluish Gray"
    // The fallback-to-top-5 path handles this — we must not silently match wrong color
    expect(matchColorByName(colors, "Dark Stone Grey")).toBeUndefined();
    expect(matchColorByName(colors, "Dark Bluish Grey")).toBeUndefined();
  });

  it("returns undefined on empty list", () => {
    expect(matchColorByName([], "Black")).toBeUndefined();
  });
});

describe("buildSingleSummary", () => {
  const basePart = {
    partNum: "3001",
    name: "Brick 2x4",
    imageUrl: null,
    url: "https://rebrickable.com/parts/3001/",
  };

  it("includes part number and name", () => {
    const result = buildSingleSummary({
      part: basePart,
      totalColors: 5,
      totalSetsAppearances: 100,
      colorDetails: [],
    });
    expect(result).toContain("3001");
    expect(result).toContain("Brick 2x4");
  });

  it("reports total colors and sets", () => {
    const result = buildSingleSummary({
      part: basePart,
      totalColors: 5,
      totalSetsAppearances: 100,
      colorDetails: [],
    });
    expect(result).toContain("5 color(s)");
    expect(result).toContain("100 set(s)");
  });

  it("shows matched color filter with set count", () => {
    const result = buildSingleSummary({
      part: basePart,
      totalColors: 5,
      totalSetsAppearances: 100,
      colorFilter: "Black",
      colorMatched: true,
      colorDetails: [{ colorId: 0, colorName: "Black", numSets: 32, imageUrl: null, sets: [] }],
    });
    expect(result).toContain('"Black"');
    expect(result).toContain("32 set(s)");
  });

  it("shows fallback message when color filter not matched", () => {
    const result = buildSingleSummary({
      part: basePart,
      totalColors: 5,
      totalSetsAppearances: 100,
      colorFilter: "Neon Pink",
      colorMatched: false,
      colorDetails: [],
    });
    expect(result).toContain('"Neon Pink"');
    expect(result).toContain("not found");
    expect(result).toContain("top 5");
  });

  it("shows empty top colors gracefully when colorDetails is empty and no filter", () => {
    const result = buildSingleSummary({
      part: basePart,
      totalColors: 0,
      totalSetsAppearances: 0,
      colorDetails: [],
    });
    // Should not crash, should still produce a valid string
    expect(result).toContain("3001");
    expect(result).toContain("0 color(s)");
  });

  it("falls through to top colors branch when colorMatched is true but colorDetails is empty", () => {
    // colorMatched=true but colorDetails.length !== 1 → falls to else branch
    const result = buildSingleSummary({
      part: basePart,
      totalColors: 5,
      totalSetsAppearances: 100,
      colorFilter: "Black",
      colorMatched: true,
      colorDetails: [], // unexpected but possible
    });
    // Should not crash — falls through to "Top colors:" branch
    expect(result).toContain("3001");
  });

  it("shows top colors list when no filter applied", () => {
    const result = buildSingleSummary({
      part: basePart,
      totalColors: 3,
      totalSetsAppearances: 50,
      colorDetails: [
        { colorId: 0, colorName: "Black", numSets: 32, imageUrl: null, sets: [] },
        { colorId: 4, colorName: "Red", numSets: 10, imageUrl: null, sets: [] },
      ],
    });
    expect(result).toContain("Black (32 sets)");
    expect(result).toContain("Red (10 sets)");
  });
});
