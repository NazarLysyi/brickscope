import type {
  RebrickableMinifig,
  RebrickableMinifigSet,
  RebrickablePage,
  RebrickablePart,
  RebrickablePartColor,
  RebrickableSet,
  RebrickableSetPart,
  RebrickableSetReference,
} from "./types.js";
import { rebrickableApiError, rebrickableKeyMissing } from "../utils/errors.js";
import type { CacheBackend } from "../cache/types.js";

const BASE_URL = "https://rebrickable.com/api/v3/lego";
const TIMEOUT_MS = 15_000;
const RATE_LIMIT_MS = 1_100; // slightly over 1s to stay within free tier limit
const MAX_PAGES = 10;
const PAGE_SIZE = 100;

let lastRequestTime = 0;
let _cache: CacheBackend | null = null;

export function setCache(cache: CacheBackend | null): void {
  _cache = cache;
}

async function withCache<T>(key: string, fn: () => Promise<T>): Promise<T> {
  if (_cache) {
    const cached = _cache.get(key);
    if (cached !== null) return JSON.parse(cached) as T;
  }
  const result = await fn();
  _cache?.set(key, JSON.stringify(result));
  return result;
}

function getApiKey(): string {
  const key = process.env.REBRICKABLE_API_KEY;
  if (!key) throw rebrickableKeyMissing();
  return key;
}

async function throttle(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < RATE_LIMIT_MS) {
    await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_MS - elapsed));
  }
  lastRequestTime = Date.now();
}

async function request<T>(path: string): Promise<T> {
  await throttle();
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { Authorization: `key ${getApiKey()}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    throw rebrickableApiError(res.status, await res.text());
  }

  return (await res.json()) as T;
}

async function fetchAllPages<T>(path: string): Promise<T[]> {
  const separator = path.includes("?") ? "&" : "?";
  const firstPage = await request<RebrickablePage<T>>(`${path}${separator}page_size=${PAGE_SIZE}`);

  const results = [...firstPage.results];
  let nextUrl = firstPage.next;
  let page = 1;

  while (nextUrl && page < MAX_PAGES) {
    const url = new URL(nextUrl);
    const pagePath = `${url.pathname}${url.search}`;
    // Strip the base URL prefix to get just the path
    const relativePath = pagePath.startsWith("/api/v3/lego")
      ? pagePath.slice("/api/v3/lego".length)
      : pagePath;
    const pageData = await request<RebrickablePage<T>>(relativePath);
    results.push(...pageData.results);
    nextUrl = pageData.next;
    page++;
  }

  return results;
}

// --- Part endpoints ---

export async function getPartDetails(partNum: string): Promise<RebrickablePart> {
  return withCache(`getPartDetails:${partNum}`, () =>
    request<RebrickablePart>(`/parts/${encodeURIComponent(partNum)}/`),
  );
}

export async function getPartColors(partNum: string): Promise<RebrickablePartColor[]> {
  return withCache(`getPartColors:${partNum}`, () =>
    fetchAllPages<RebrickablePartColor>(`/parts/${encodeURIComponent(partNum)}/colors/`),
  );
}

export async function getPartColorSets(
  partNum: string,
  colorId: number,
): Promise<RebrickableSetReference[]> {
  return withCache(`getPartColorSets:${partNum}:${colorId}`, () =>
    fetchAllPages<RebrickableSetReference>(
      `/parts/${encodeURIComponent(partNum)}/colors/${colorId}/sets/`,
    ),
  );
}

// --- Set endpoints ---

export async function getSetDetails(setNum: string): Promise<RebrickableSet> {
  return withCache(`getSetDetails:${setNum}`, () =>
    request<RebrickableSet>(`/sets/${encodeURIComponent(setNum)}/`),
  );
}

export async function getSetParts(setNum: string): Promise<RebrickableSetPart[]> {
  return withCache(`getSetParts:${setNum}`, () =>
    fetchAllPages<RebrickableSetPart>(`/sets/${encodeURIComponent(setNum)}/parts/`),
  );
}

// --- Minifig endpoints ---

export async function getMinifigDetails(minifigId: string): Promise<RebrickableMinifig> {
  return withCache(`getMinifigDetails:${minifigId}`, () =>
    request<RebrickableMinifig>(`/minifigs/${encodeURIComponent(minifigId)}/`),
  );
}

export async function getMinifigSets(minifigId: string): Promise<RebrickableMinifigSet[]> {
  return withCache(`getMinifigSets:${minifigId}`, () =>
    fetchAllPages<RebrickableMinifigSet>(`/minifigs/${encodeURIComponent(minifigId)}/sets/`),
  );
}
