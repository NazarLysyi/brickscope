import { describe, it, expect, afterEach, vi } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { initCache } from "./index.js";
import { MemoryCache } from "./memory.js";
import { SqliteCache } from "./sqlite.js";

const TEST_CACHE_DIR = join(tmpdir(), "brickognize-test-init-cache");

describe("initCache", () => {
  afterEach(() => {
    delete process.env.BRICKOGNIZE_CACHE;
    delete process.env.BRICKOGNIZE_CACHE_DIR;
    rmSync(TEST_CACHE_DIR, { recursive: true, force: true });
  });

  it("returns null when BRICKOGNIZE_CACHE is not set", () => {
    delete process.env.BRICKOGNIZE_CACHE;
    expect(initCache()).toBeNull();
  });

  it("returns null for BRICKOGNIZE_CACHE=none", () => {
    process.env.BRICKOGNIZE_CACHE = "none";
    expect(initCache()).toBeNull();
  });

  it("returns a working MemoryCache for BRICKOGNIZE_CACHE=memory", () => {
    process.env.BRICKOGNIZE_CACHE = "memory";
    const cache = initCache();
    expect(cache).toBeInstanceOf(MemoryCache);
    cache!.set("k", "v");
    expect(cache!.get("k")).toBe("v");
  });

  it("returns a working SqliteCache for BRICKOGNIZE_CACHE=sqlite", () => {
    process.env.BRICKOGNIZE_CACHE = "sqlite";
    process.env.BRICKOGNIZE_CACHE_DIR = TEST_CACHE_DIR;
    const cache = initCache();
    expect(cache).toBeInstanceOf(SqliteCache);
    cache!.set("k", "v");
    expect(cache!.get("k")).toBe("v");
  });

  it("returns null and logs error when SQLite path is invalid", () => {
    process.env.BRICKOGNIZE_CACHE = "sqlite";
    // A path where a file exists at the "directory" position — can't create DB
    process.env.BRICKOGNIZE_CACHE_DIR = "/dev/null/impossible";
    const stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = initCache();
    expect(result).toBeNull();
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("SQLite cache init failed"),
      expect.anything(),
    );
    stderrSpy.mockRestore();
  });

  it("returns null and logs warning for unknown cache mode", () => {
    process.env.BRICKOGNIZE_CACHE = "redis";
    const stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = initCache();
    expect(result).toBeNull();
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("redis"));
    stderrSpy.mockRestore();
  });
});
