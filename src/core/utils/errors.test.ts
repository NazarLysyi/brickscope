import { describe, it, expect } from "vitest";
import {
  BrickognizeError,
  RebrickableError,
  imageNotFound,
  invalidInput,
  apiError,
  unexpectedResponse,
  rebrickableKeyMissing,
  rebrickableApiError,
  formatToolError,
} from "./errors.js";

describe("BrickognizeError", () => {
  it("has correct name and code", () => {
    const err = new BrickognizeError("oops", "TEST_CODE");
    expect(err.name).toBe("BrickognizeError");
    expect(err.code).toBe("TEST_CODE");
    expect(err.message).toBe("oops");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("RebrickableError", () => {
  it("has correct name and code", () => {
    const err = new RebrickableError("oops", "TEST_CODE");
    expect(err.name).toBe("RebrickableError");
    expect(err.code).toBe("TEST_CODE");
    expect(err.message).toBe("oops");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("error factories", () => {
  it("imageNotFound includes path and correct code", () => {
    const err = imageNotFound("/some/path.jpg");
    expect(err.code).toBe("IMAGE_NOT_FOUND");
    expect(err.message).toContain("/some/path.jpg");
  });

  it("invalidInput includes message and correct code", () => {
    const err = invalidInput("bad value");
    expect(err.code).toBe("INVALID_INPUT");
    expect(err.message).toContain("bad value");
  });

  it("apiError includes status and body", () => {
    const err = apiError(404, "Not Found");
    expect(err.code).toBe("API_ERROR");
    expect(err.message).toContain("404");
    expect(err.message).toContain("Not Found");
  });

  it("unexpectedResponse includes detail", () => {
    const err = unexpectedResponse("missing field xyz");
    expect(err.code).toBe("UNEXPECTED_RESPONSE");
    expect(err.message).toContain("missing field xyz");
  });

  it("rebrickableKeyMissing has correct code and hints at env var", () => {
    const err = rebrickableKeyMissing();
    expect(err.code).toBe("API_KEY_MISSING");
    expect(err.message).toContain("REBRICKABLE_API_KEY");
  });

  it("rebrickableApiError includes status and body", () => {
    const err = rebrickableApiError(429, "Too Many Requests");
    expect(err.code).toBe("API_ERROR");
    expect(err.message).toContain("429");
    expect(err.message).toContain("Too Many Requests");
  });
});

describe("formatToolError", () => {
  it("returns message for BrickognizeError", () => {
    const err = new BrickognizeError("brickognize failed", "X");
    expect(formatToolError(err)).toBe("brickognize failed");
  });

  it("returns message for RebrickableError", () => {
    const err = new RebrickableError("rebrickable failed", "X");
    expect(formatToolError(err)).toBe("rebrickable failed");
  });

  it("prefixes network errors with 'Network error:'", () => {
    const err = new Error("fetch failed: timeout");
    expect(formatToolError(err)).toBe("Network error: fetch failed: timeout");
  });

  it("returns message for generic Error", () => {
    expect(formatToolError(new Error("something broke"))).toBe("something broke");
  });

  it("returns fallback for non-Error values", () => {
    expect(formatToolError("a string")).toBe("An unexpected error occurred");
    expect(formatToolError(42)).toBe("An unexpected error occurred");
    expect(formatToolError(null)).toBe("An unexpected error occurred");
  });
});
