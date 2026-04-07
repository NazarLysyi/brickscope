import { describe, it, expect, beforeEach } from "vitest";
import { MemoryCache } from "./memory.js";

describe("MemoryCache", () => {
  let cache: MemoryCache;

  beforeEach(() => {
    cache = new MemoryCache();
  });

  it("returns null for a missing key", () => {
    expect(cache.get("missing")).toBeNull();
  });

  it("stores and retrieves a value", () => {
    cache.set("key1", "value1");
    expect(cache.get("key1")).toBe("value1");
  });

  it("overwrites an existing key", () => {
    cache.set("key1", "first");
    cache.set("key1", "second");
    expect(cache.get("key1")).toBe("second");
  });

  it("stores multiple independent keys", () => {
    cache.set("a", "1");
    cache.set("b", "2");
    expect(cache.get("a")).toBe("1");
    expect(cache.get("b")).toBe("2");
  });

  it("clear removes all entries and returns count", () => {
    cache.set("a", "1");
    cache.set("b", "2");
    const removed = cache.clear();
    expect(removed).toBe(2);
    expect(cache.get("a")).toBeNull();
    expect(cache.get("b")).toBeNull();
  });

  it("clear on empty cache returns 0", () => {
    expect(cache.clear()).toBe(0);
  });
});
