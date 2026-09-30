import { setTimeout as sleep } from "node:timers/promises";
import type { HealthResponse, RawSearchResults } from "./types.js";
import { apiError, unexpectedResponse } from "../utils/errors.js";

const PARTS_PREDICT_ENDPOINT = "/predict/parts/";

/** Total time for one predict() call, including retries. */
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_RETRIES = 2;
/** Longer server-requested waits are not worth it: fail with the server's error instead. */
const MAX_RETRY_DELAY_MS = 10_000;
/** Only retry when this much time remains after the wait, so the retry can actually finish. */
const MIN_ATTEMPT_MS = 5_000;
const RETRYABLE_STATUSES = new Set([429, 503]);
/** IMF-fixdate, the only HTTP-date form servers send, e.g. "Sun, 06 Nov 1994 08:49:37 GMT". */
const HTTP_DATE = /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/;

const BASE_URL = "https://api.brickognize.com";

export async function checkHealth(): Promise<HealthResponse> {
  const res = await fetch(`${BASE_URL}/health/`, {
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    throw apiError(res.status, await res.text());
  }

  const data = await res.json();

  if (typeof data !== "object" || data === null) {
    throw unexpectedResponse("health endpoint did not return an object");
  }

  return data as HealthResponse;
}

export interface PredictOptions {
  /** Aborts the request and any pending retry, e.g. when a caller cancels. */
  signal?: AbortSignal;
  /** Epoch ms of the caller's deadline: the call is aborted then, and retries that can't finish first are skipped. */
  deadline?: number;
  /** Called on every 429 response, even one that is then retried, so callers can back off. */
  onRateLimited?: (delayMs: number) => void;
}

export async function predict(
  endpoint: string,
  imageBlob: Blob,
  filename: string,
  options: PredictOptions = {},
): Promise<RawSearchResults> {
  const form = new FormData();
  form.append("query_image", imageBlob, filename);

  // Always request color prediction for the parts endpoint specifically
  const url =
    endpoint === PARTS_PREDICT_ENDPOINT
      ? `${BASE_URL}${endpoint}?predict_color=true`
      : `${BASE_URL}${endpoint}`;

  // One deadline for the whole call, retries included: our own limit or the caller's.
  const deadline = Math.min(Date.now() + REQUEST_TIMEOUT_MS, options.deadline ?? Infinity);
  const timeout = AbortSignal.timeout(Math.max(1, deadline - Date.now()));
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { method: "POST", body: form, signal });
    const delay = retryDelayMs(res.headers.get("retry-after"), attempt);
    if (res.status === 429) options.onRateLimited?.(delay ?? MAX_RETRY_DELAY_MS);

    if (RETRYABLE_STATUSES.has(res.status) && attempt < MAX_RETRIES) {
      // Otherwise report the server's error now rather than a timeout later.
      if (delay !== null && Date.now() + delay + MIN_ATTEMPT_MS <= deadline) {
        await res.body?.cancel();
        await sleep(delay, undefined, { signal });
        continue;
      }
    }

    if (!res.ok) {
      const body = await res.text();
      throw apiError(res.status, body);
    }

    const data = await res.json();

    if (!data || typeof data.listing_id !== "string" || !Array.isArray(data.items)) {
      throw unexpectedResponse("missing listing_id or items array");
    }
    if (!data.items.every(isCandidateItem)) {
      throw unexpectedResponse("malformed item in items array");
    }

    return data as RawSearchResults;
  }
}

function isCandidateItem(item: unknown): boolean {
  if (item === null || typeof item !== "object") return false;
  const { id, name, score } = item as Record<string, unknown>;
  return typeof id === "string" && typeof name === "string" && typeof score === "number";
}

/**
 * Delay before retry `attempt` (0-based), or null when the server asks to wait longer than
 * MAX_RETRY_DELAY_MS. Honors Retry-After (seconds or IMF-fixdate); otherwise backs off
 * exponentially. Jitter keeps concurrent requests from retrying in lockstep.
 */
export function retryDelayMs(
  retryAfter: string | null,
  attempt: number,
  now = Date.now(),
  random = Math.random,
): number | null {
  const value = retryAfter?.trim() ?? "";
  let delay: number | null = null;

  if (/^\d+$/.test(value)) {
    delay = Number(value) * 1000;
  } else if (HTTP_DATE.test(value) && Number.isFinite(Date.parse(value))) {
    delay = Math.max(0, Date.parse(value) - now);
  }

  if (delay === null) {
    const backoff = 1000 * 2 ** attempt;
    return Math.round(backoff / 2 + (random() * backoff) / 2);
  }
  if (delay > MAX_RETRY_DELAY_MS) {
    return null;
  }
  return Math.round(delay + random() * 250);
}
