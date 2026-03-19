import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { imageInputSchema, resolveImage, TOOL_ANNOTATIONS } from "./shared.js";
import { predict } from "../brickognize/client.js";
import { mapPredictionResult } from "../brickognize/mappers.js";
import { formatToolError } from "../utils/errors.js";

export function createPredictTool(
  server: McpServer,
  name: string,
  title: string,
  description: string,
  endpoint: string,
): void {
  server.registerTool(
    name,
    {
      title,
      description,
      inputSchema: imageInputSchema,
      annotations: TOOL_ANNOTATIONS,
    },
    async (input) => {
      try {
        const { blob, filename } = await resolveImage(input);
        const raw = await predict(endpoint, blob, filename);
        const result = mapPredictionResult(raw, input.includeRaw ?? false);

        return {
          content: [
            {
              type: "text" as const,
              text: result.summary,
            },
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: formatToolError(error),
            },
          ],
        };
      }
    },
  );
}

export function registerIdentifyTool(server: McpServer): void {
  createPredictTool(
    server,
    "brickognize_identify",
    "Identify LEGO Item",
    "Identify any LEGO item (part, set, minifigure, or sticker) from a photograph. " +
      "Use this when the item type is unknown or the image may contain multiple types.\n\n" +
      "Provide imagePath — absolute path to a local image file (JPEG, PNG, or WebP).\n" +
      "Returns top matches with confidence scores, IDs, names, categories, and links to BrickLink/BrickOwl.",
    "/predict/",
  );
}
