import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { predict } from "../../core/brickognize/client.js";
import { mapPredictionResult } from "../../core/brickognize/mappers.js";
import {
  MCP_TIME_BUDGET_MS,
  imageInputSchema,
  PREDICT_ENDPOINTS,
  resolveImage,
  TOOL_ANNOTATIONS,
  toolError,
  toolSuccess,
} from "./shared.js";

function createPredictTool(
  server: McpServer,
  name: string,
  title: string,
  description: string,
  endpoint: string,
): void {
  server.registerTool(
    name,
    { title, description, inputSchema: imageInputSchema, annotations: TOOL_ANNOTATIONS },
    async (input, extra) => {
      try {
        const deadline = Date.now() + MCP_TIME_BUDGET_MS;
        const signal = AbortSignal.any([extra.signal, AbortSignal.timeout(MCP_TIME_BUDGET_MS)]);
        const { blob, filename } = await resolveImage(input, signal);
        const raw = await predict(endpoint, blob, filename, { signal, deadline });
        const result = mapPredictionResult(raw, input.includeRaw);
        return toolSuccess(result.summary, JSON.stringify(result, null, 2));
      } catch (error) {
        return toolError(error);
      }
    },
  );
}

export function registerPredictTools(server: McpServer): void {
  createPredictTool(
    server,
    "brickognize_identify",
    "Identify LEGO Item",
    "Identify any LEGO item (part, set, minifigure, or sticker) from a photograph. " +
      "Use this when the item type is unknown or the image may contain multiple types.\n\n" +
      "Provide imagePath — absolute path to a local image file (JPEG, PNG, WebP, or HEIC).\n" +
      "Returns top matches with confidence scores, IDs, names, categories, and links to BrickLink/BrickOwl.",
    PREDICT_ENDPOINTS.general,
  );

  createPredictTool(
    server,
    "brickognize_identify_part",
    "Identify LEGO Part",
    "Identify a specific LEGO part/brick/element from a photograph. " +
      "Use instead of brickognize_identify when you know the image shows a single LEGO piece for more accurate results.\n\n" +
      "Provide imagePath — absolute path to a local image file (JPEG, PNG, WebP, or HEIC).\n" +
      "Automatically detects the part's color (returned in predictedColors).\n" +
      "Returns matched parts with IDs, names, confidence scores, predicted colors, and links.",
    PREDICT_ENDPOINTS.part,
  );

  createPredictTool(
    server,
    "brickognize_identify_set",
    "Identify LEGO Set",
    "Identify a LEGO set from a photograph of its box, assembled model, or instructions. " +
      "Use instead of brickognize_identify when you know the image shows a LEGO set.\n\n" +
      "Provide imagePath — absolute path to a local image file (JPEG, PNG, WebP, or HEIC).\n" +
      "Returns matched sets with set numbers, names, confidence scores, and links.",
    PREDICT_ENDPOINTS.set,
  );

  createPredictTool(
    server,
    "brickognize_identify_fig",
    "Identify LEGO Minifigure",
    "Identify a LEGO minifigure from a photograph. " +
      "Use instead of brickognize_identify when you know the image shows a minifigure.\n\n" +
      "Provide imagePath — absolute path to a local image file (JPEG, PNG, WebP, or HEIC).\n" +
      "Returns matched minifigures with IDs, names, confidence scores, and links.",
    PREDICT_ENDPOINTS.fig,
  );
}
