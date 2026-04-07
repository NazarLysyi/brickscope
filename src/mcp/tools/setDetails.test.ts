import { describe, it, expect } from "vitest";
import { normalizeSetNum } from "./setDetails.js";

describe("normalizeSetNum", () => {
  it("appends '-1' when no suffix present", () => {
    expect(normalizeSetNum("75192")).toBe("75192-1");
  });

  it("leaves '-1' suffix unchanged", () => {
    expect(normalizeSetNum("75192-1")).toBe("75192-1");
  });

  it("leaves non-1 numeric suffix unchanged", () => {
    expect(normalizeSetNum("75192-2")).toBe("75192-2");
  });

  it("handles multi-digit suffix", () => {
    expect(normalizeSetNum("10268-10")).toBe("10268-10");
  });

  it("appends '-1' to set numbers with letters", () => {
    expect(normalizeSetNum("CITY2024")).toBe("CITY2024-1");
  });
});
