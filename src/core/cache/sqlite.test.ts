import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SqliteCache } from "./sqlite.js";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_DB_DIR = join(tmpdir(), "brickognize-test-cache");
const TEST_DB_PATH = join(TEST_DB_DIR, "test.db");

describe("SqliteCache", () => {
  let cache: SqliteCache;

  beforeEach(() => {
    mkdirSync(TEST_DB_DIR, { recursive: true });
    cache = new SqliteCache(TEST_DB_PATH);
  });

  afterEach(() => {
    rmSync(TEST_DB_DIR, { recursive: true, force: true });
  });

  it("returns null for a missing key", () => {
    expect(cache.get("missing")).toBeNull();
  });

  it("stores and retrieves a value", () => {
    cache.set("key1", "value1");
    expect(cache.get("key1")).toBe("value1");
  });

  it("overwrites an existing key (upsert)", () => {
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

  it("persists values across instances pointing to same DB", () => {
    cache.set("persistent", "hello");
    const cache2 = new SqliteCache(TEST_DB_PATH);
    try {
      expect(cache2.get("persistent")).toBe("hello");
    } finally {
      cache2.db.close();
    }
  });

  it("creates the DB directory if it does not exist", () => {
    const nestedPath = join(TEST_DB_DIR, "deep", "nested", "cache.db");
    const nestedCache = new SqliteCache(nestedPath);
    nestedCache.set("x", "y");
    expect(nestedCache.get("x")).toBe("y");
  });
});
