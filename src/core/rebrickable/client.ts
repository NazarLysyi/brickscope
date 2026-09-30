import { setTimeout as sleep } from "node:timers/promises";
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
/** Longest Retry-After honored; a longer wait would stall every lookup in the process. */
const MAX_BACKOFF_MS = 60_000;

let lastRequestTime = 0;
let backoffUntil = 0;
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

let throttleQueue: Promise<void> = Promise.resolve();

/**
 * Space requests RATE_LIMIT_MS apart, across concurrent callers too (a shared queue).
 * An aborted caller leaves the queue without taking a slot.
 */
function throttle(signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  const turn = throttleQueue.then(async () => {
    signal?.throwIfAborted();
    let wait: number;
    while ((wait = Math.max(lastRequestTime + RATE_LIMIT_MS, backoffUntil) - Date.now()) > 0) {
      await sleep(wait, undefined, { signal });
    }
    signal?.throwIfAborted();
    lastRequestTime = Date.now();
  });
  throttleQueue = turn.catch(() => undefined);
  if (!signal) return turn;
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    void turn.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    if (signal.aborted) abort();
  });
}

async function request<T>(path: string, signal?: AbortSignal): Promise<T> {
  const key = getApiKey();
  await throttle(signal);
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { Authorization: `key ${key}` },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });

  if (res.status === 429) {
    const value = res.headers.get("retry-after");
    const delay =
      value && /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value ?? "") - Date.now();
    backoffUntil = Math.max(
      backoffUntil,
      Date.now() +
        (Number.isFinite(delay) ? Math.min(MAX_BACKOFF_MS, Math.max(RATE_LIMIT_MS, delay)) : 5000),
    );
  }
  if (!res.ok) {
    throw rebrickableApiError(res.status, await res.text());
  }

  return (await res.json()) as T;
}

async function fetchAllPages<T>(
  path: string,
  signal?: AbortSignal,
  maxPages = MAX_PAGES,
): Promise<T[]> {
  const separator = path.includes("?") ? "&" : "?";
  const firstPage = await request<RebrickablePage<T>>(
    `${path}${separator}page_size=${PAGE_SIZE}`,
    signal,
  );

  const results = [...firstPage.results];
  let nextUrl = firstPage.next;
  let page = 1;

  while (nextUrl && page < maxPages) {
    const url = new URL(nextUrl);
    const pagePath = `${url.pathname}${url.search}`;
    // Strip the base URL prefix to get just the path
    const relativePath = pagePath.startsWith("/api/v3/lego")
      ? pagePath.slice("/api/v3/lego".length)
      : pagePath;
    const pageData = await request<RebrickablePage<T>>(relativePath, signal);
    results.push(...pageData.results);
    nextUrl = pageData.next;
    page++;
  }

  return results;
}

// --- Part endpoints ---

export async function getPartDetails(
  partNum: string,
  signal?: AbortSignal,
): Promise<RebrickablePart> {
  return withCache(`getPartDetails:${partNum}`, () =>
    request<RebrickablePart>(`/parts/${encodeURIComponent(partNum)}/`, signal),
  );
}

export async function getPartColors(
  partNum: string,
  signal?: AbortSignal,
): Promise<RebrickablePartColor[]> {
  return withCache(`getPartColors:${partNum}`, () =>
    fetchAllPages<RebrickablePartColor>(`/parts/${encodeURIComponent(partNum)}/colors/`, signal),
  );
}

export async function getPartColorSets(
  partNum: string,
  colorId: number,
  signal?: AbortSignal,
  maxPages = MAX_PAGES,
): Promise<RebrickableSetReference[]> {
  return withCache(`getPartColorSets:${partNum}:${colorId}:${maxPages}`, () =>
    fetchAllPages<RebrickableSetReference>(
      `/parts/${encodeURIComponent(partNum)}/colors/${colorId}/sets/`,
      signal,
      maxPages,
    ),
  );
}

// --- Set endpoints ---

export async function getSetDetails(setNum: string, signal?: AbortSignal): Promise<RebrickableSet> {
  return withCache(`getSetDetails:${setNum}`, () =>
    request<RebrickableSet>(`/sets/${encodeURIComponent(setNum)}/`, signal),
  );
}

export async function getSetParts(
  setNum: string,
  signal?: AbortSignal,
): Promise<RebrickableSetPart[]> {
  return withCache(`getSetParts:${setNum}`, () =>
    fetchAllPages<RebrickableSetPart>(`/sets/${encodeURIComponent(setNum)}/parts/`, signal),
  );
}

// --- Minifig endpoints ---

export async function getMinifigDetails(
  minifigId: string,
  signal?: AbortSignal,
): Promise<RebrickableMinifig> {
  return withCache(`getMinifigDetails:${minifigId}`, () =>
    request<RebrickableMinifig>(`/minifigs/${encodeURIComponent(minifigId)}/`, signal),
  );
}

export async function getMinifigSets(
  minifigId: string,
  signal?: AbortSignal,
): Promise<RebrickableMinifigSet[]> {
  return withCache(`getMinifigSets:${minifigId}`, () =>
    fetchAllPages<RebrickableMinifigSet>(
      `/minifigs/${encodeURIComponent(minifigId)}/sets/`,
      signal,
    ),
  );
}
