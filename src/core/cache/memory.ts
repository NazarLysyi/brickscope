import type { CacheBackend } from "./types.js";

export class MemoryCache implements CacheBackend {
  private readonly store = new Map<string, string>();

  get(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  set(key: string, value: string): void {
    this.store.set(key, value);
  }

  clear(): number {
    const count = this.store.size;
    this.store.clear();
    return count;
  }
}
