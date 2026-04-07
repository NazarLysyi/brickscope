export interface CacheBackend {
  get(key: string): string | null;
  set(key: string, value: string): void;
  clear(): number;
}

export type CacheMode = "none" | "memory" | "sqlite";
