import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createPredictTool } from "./predict.js";

export function registerIdentifySetTool(server: McpServer): void {
  createPredictTool(
    server,
    "brickognize_identify_set",
    "Identify LEGO Set",
    "Identify a LEGO set from a photograph of its box, assembled model, or instructions. " +
      "Use instead of brickognize_identify when you know the image shows a LEGO set.\n\n" +
      "Provide imagePath — absolute path to a local image file (JPEG, PNG, or WebP).\n" +
      "Returns matched sets with set numbers, names, confidence scores, and links.",
    "/predict/sets/",
  );
}
