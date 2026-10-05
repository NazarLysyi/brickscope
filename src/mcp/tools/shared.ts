import { z } from "zod";
import { formatToolError } from "../../core/utils/errors.js";

export { PREDICT_ENDPOINTS, resolveImage } from "../../core/image.js";
export type { ResolvedImage } from "../../core/image.js";

type TextContent = { type: "text"; text: string };
type ImageContent = { type: "image"; data: string; mimeType: string };
export type ToolSuccessResult = { content: TextContent[] };
export type ToolImageResult = { content: (TextContent | ImageContent)[] };
export type ToolErrorResult = { isError: true; content: TextContent[] };

/** Build a successful tool response with one or more text content blocks. */
export function toolSuccess(...texts: string[]): ToolSuccessResult {
  return { content: texts.map((text) => ({ type: "text", text })) };
}

/** Build a successful tool response with text blocks followed by inline JPEG images. */
export function toolSuccessWithImages(texts: string[], jpegs: Buffer[]): ToolImageResult {
  return {
    content: [
      ...toolSuccess(...texts).content,
      ...jpegs.map((jpeg) => ({
        type: "image" as const,
        data: jpeg.toString("base64"),
        mimeType: "image/jpeg",
      })),
    ],
  };
}

/** Build an error tool response from a caught exception. */
export function toolError(error: unknown): ToolErrorResult {
  return {
    isError: true,
    content: [{ type: "text", text: formatToolError(error) }],
  };
}

/**
 * Time a tool spends on slow API work before returning partial results, to stay under the
 * MCP SDK client's default 60s request timeout.
 */
export const MCP_TIME_BUDGET_MS = 50_000;

export const TOOL_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

export const imageInputSchema = {
  imagePath: z.string().describe("Absolute path to a local image file (JPEG, PNG, WebP, or HEIC)."),
  includeRaw: z
    .boolean()
    .describe(
      "When true, includes the raw Brickognize API response alongside formatted results. Useful for debugging.",
    )
    .default(false),
};
