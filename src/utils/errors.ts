export class BrickognizeError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "BrickognizeError";
  }
}

export function imageNotFound(path: string): BrickognizeError {
  return new BrickognizeError(`Image file not found: ${path}`, "IMAGE_NOT_FOUND");
}

export function invalidInput(message: string): BrickognizeError {
  return new BrickognizeError(message, "INVALID_INPUT");
}

export function apiError(status: number, body: string): BrickognizeError {
  return new BrickognizeError(`Brickognize API returned ${status}: ${body}`, "API_ERROR");
}

export function unexpectedResponse(detail: string): BrickognizeError {
  return new BrickognizeError(
    `Unexpected Brickognize response format: ${detail}`,
    "UNEXPECTED_RESPONSE",
  );
}

export function formatToolError(error: unknown): string {
  if (error instanceof BrickognizeError) {
    return error.message;
  }
  if (error instanceof Error) {
    if (error.message.includes("fetch")) {
      return `Network error communicating with Brickognize API: ${error.message}`;
    }
    return error.message;
  }
  return "An unexpected error occurred";
}
