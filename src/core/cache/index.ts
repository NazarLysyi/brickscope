import { join } from "node:path";
import { homedir } from "node:os";
import type { CacheBackend } from "./types.js";
import { MemoryCache } from "./memory.js";
import { SqliteCache } from "./sqlite.js";

export type { CacheBackend } from "./types.js";
export { SqliteCache } from "./sqlite.js";

function resolveCacheDbPath(): string {
  if (process.env.BRICKOGNIZE_CACHE_DIR) {
    return join(process.env.BRICKOGNIZE_CACHE_DIR, "cache.db");
  }
  return join(homedir(), ".cache", "brickscope", "cache.db");
}

export function initCache(): CacheBackend | null {
  const mode = process.env.BRICKOGNIZE_CACHE ?? "none";

  if (mode === "none") return null;

  if (mode === "memory") return new MemoryCache();

  if (mode === "sqlite") {
    try {
      return new SqliteCache(resolveCacheDbPath());
    } catch (err) {
      console.error("[brickognize] SQLite cache init failed, running without cache:", err);
      return null;
    }
  }

  console.error(
    `[brickognize] Unknown BRICKOGNIZE_CACHE value "${mode}", ignoring. Valid values: none, memory, sqlite`,
  );
  return null;
}
