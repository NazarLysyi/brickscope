export class BrickognizeError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    /** HTTP status, for API errors. */
    public readonly status?: number,
  ) {
    super(message);
    this.name = "BrickognizeError";
  }
}

export class RebrickableError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "RebrickableError";
  }
}

export function imageNotFound(path: string): BrickognizeError {
  return new BrickognizeError(`Image file not found: ${path}`, "IMAGE_NOT_FOUND");
}

export function invalidInput(message: string): BrickognizeError {
  return new BrickognizeError(message, "INVALID_INPUT");
}

/** Longest response body kept in an error message (error pages can be whole HTML documents). */
const MAX_ERROR_BODY = 300;

export function apiError(status: number, body: string): BrickognizeError {
  const text = body.length > MAX_ERROR_BODY ? `${body.slice(0, MAX_ERROR_BODY)}…` : body;
  return new BrickognizeError(`Brickognize API returned ${status}: ${text}`, "API_ERROR", status);
}

export function unexpectedResponse(detail: string): BrickognizeError {
  return new BrickognizeError(
    `Unexpected Brickognize response format: ${detail}`,
    "UNEXPECTED_RESPONSE",
  );
}

export function rebrickableKeyMissing(): RebrickableError {
  return new RebrickableError(
    "REBRICKABLE_API_KEY environment variable is not set. " +
      "Get a free API key at https://rebrickable.com/api/",
    "API_KEY_MISSING",
  );
}

export function rebrickableApiError(status: number, body: string): RebrickableError {
  const text = body.length > MAX_ERROR_BODY ? `${body.slice(0, MAX_ERROR_BODY)}…` : body;
  return new RebrickableError(`Rebrickable API returned ${status}: ${text}`, "API_ERROR", status);
}

export function formatToolError(error: unknown): string {
  if (error instanceof BrickognizeError) {
    return error.message;
  }
  if (error instanceof RebrickableError) {
    return error.message;
  }
  if (error instanceof Error) {
    if (error.message.includes("fetch")) {
      return `Network error: ${error.message}`;
    }
    return error.message;
  }
  return "An unexpected error occurred";
}

export function isRetryableLookupError(error: unknown): boolean {
  if (error instanceof RebrickableError) return error.status === 429 || (error.status ?? 0) >= 500;
  return (
    error instanceof Error &&
    (error.name === "TimeoutError" ||
      error.name === "AbortError" ||
      /fetch failed/i.test(error.message))
  );
}
