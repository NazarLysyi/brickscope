import { z } from "zod";
import { formatToolError } from "../../core/utils/errors.js";

export { PREDICT_ENDPOINTS, resolveImage } from "../../core/image.js";
export type { ResolvedImage } from "../../core/image.js";

type TextContent = { type: "text"; text: string };
export type ToolSuccessResult = { content: TextContent[] };
export type ToolErrorResult = { isError: true; content: TextContent[] };

/** Build a successful tool response with one or more text content blocks. */
export function toolSuccess(...texts: string[]): ToolSuccessResult {
  return { content: texts.map((text) => ({ type: "text", text })) };
}

/** Build an error tool response from a caught exception. */
export function toolError(error: unknown): ToolErrorResult {
  return {
    isError: true,
    content: [{ type: "text", text: formatToolError(error) }],
  };
}

export const TOOL_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

export const imageInputSchema = {
  imagePath: z.string().describe("Absolute path to a local image file (JPEG, PNG, or WebP)."),
  includeRaw: z
    .boolean()
    .describe(
      "When true, includes the raw Brickognize API response alongside formatted results. Useful for debugging.",
    )
    .default(false),
};
