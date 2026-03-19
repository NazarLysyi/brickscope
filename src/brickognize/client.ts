import type { HealthResponse, RawSearchResults } from "./types.js";
import { apiError, unexpectedResponse } from "../utils/errors.js";

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

export async function predict(
  endpoint: string,
  imageBlob: Blob,
  filename: string,
): Promise<RawSearchResults> {
  const form = new FormData();
  form.append("query_image", imageBlob, filename);

  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const body = await res.text();
    throw apiError(res.status, body);
  }

  const data = await res.json();

  if (!data || typeof data.listing_id !== "string" || !Array.isArray(data.items)) {
    throw unexpectedResponse("missing listing_id or items array");
  }

  return data as RawSearchResults;
}
