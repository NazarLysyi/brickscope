import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createPredictTool } from "./predict.js";

export function registerIdentifyFigTool(server: McpServer): void {
  createPredictTool(
    server,
    "brickognize_identify_fig",
    "Identify LEGO Minifigure",
    "Identify a LEGO minifigure from a photograph. " +
      "Use instead of brickognize_identify when you know the image shows a minifigure.\n\n" +
      "Provide imagePath — absolute path to a local image file (JPEG, PNG, or WebP).\n" +
      "Returns matched minifigures with IDs, names, confidence scores, and links.",
    "/predict/figs/",
  );
}
