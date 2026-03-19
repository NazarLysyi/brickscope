import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createPredictTool } from "./predict.js";

export function registerIdentifyPartTool(server: McpServer): void {
  createPredictTool(
    server,
    "brickognize_identify_part",
    "Identify LEGO Part",
    "Identify a specific LEGO part/brick/element from a photograph. " +
      "Use instead of brickognize_identify when you know the image shows a single LEGO piece for more accurate results.\n\n" +
      "Provide imagePath — absolute path to a local image file (JPEG, PNG, or WebP).\n" +
      "Returns matched parts with IDs, names, confidence scores, and links.",
    "/predict/parts/",
  );
}
