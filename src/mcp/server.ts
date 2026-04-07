import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerHealthTool } from "./tools/health.js";
import { registerPredictTools } from "./tools/predict.js";
import { registerBatchIdentifyTool } from "./tools/batchPredict.js";
import { registerPartDetailsTool, registerBatchPartDetailsTool } from "./tools/partDetails.js";
import { registerSetDetailsTool } from "./tools/setDetails.js";
import { registerMinifigDetailsTool } from "./tools/minifigDetails.js";
import { registerCacheClearTool } from "./tools/cacheTools.js";
import { initCache } from "../core/cache/index.js";
import { setCache } from "../core/rebrickable/client.js";

const SERVER_INSTRUCTIONS = `\
You are connected to the Brickognize LEGO recognition server.

Provide imagePath (absolute path to a local image file) to any recognition tool.

WHICH TOOL TO USE:
- Single item, unknown type → brickognize_identify
- Single brick/element → brickognize_identify_part
- Single set box or assembled set → brickognize_identify_set
- Single minifigure → brickognize_identify_fig
- Multiple images at once → brickognize_batch_identify

PREFER brickognize_batch_identify whenever you have 2 or more images — it processes them in parallel and is significantly faster than calling single-image tools sequentially.

Color prediction is automatic for part identification — predictedColors is always included in results.

LOOKUP TOOLS (use after identification or with known IDs):
- Part details (colors, appears in sets) → brickognize_part_details (single) or brickognize_batch_part_details (multiple)
- Set details (parts list, year, theme) → brickognize_set_details
- Minifig details (appears in sets) → brickognize_minifig_details

PREFER brickognize_batch_part_details when looking up 2+ parts — pass all parts with their predicted colors in one call.

These tools use the Rebrickable API and require a REBRICKABLE_API_KEY environment variable.

CACHE (optional):
- brickognize_cache_clear is only available when BRICKOGNIZE_CACHE=memory or sqlite is set.
  Do not attempt to call it if it does not appear in the tool list.
`;

export function createServer(): McpServer {
  const cache = initCache();
  setCache(cache);

  const server = new McpServer(
    { name: "brickognize", version: "1.0.0" },
    { instructions: SERVER_INSTRUCTIONS },
  );

  registerHealthTool(server);
  registerPredictTools(server);
  registerBatchIdentifyTool(server);
  registerPartDetailsTool(server);
  registerBatchPartDetailsTool(server);
  registerSetDetailsTool(server);
  registerMinifigDetailsTool(server);

  if (cache !== null) {
    registerCacheClearTool(server, cache);
  }

  return server;
}
