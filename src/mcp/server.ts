import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerHealthTool } from "./tools/health.js";
import { registerPredictTools } from "./tools/predict.js";
import { registerBatchIdentifyTool } from "./tools/batchPredict.js";
import { registerScanTool } from "./tools/scan.js";
import { registerPartDetailsTool, registerBatchPartDetailsTool } from "./tools/partDetails.js";
import { registerSetDetailsTool } from "./tools/setDetails.js";
import { registerMinifigDetailsTool } from "./tools/minifigDetails.js";
import { registerCacheClearTool } from "./tools/cacheTools.js";
import { initCache } from "../core/cache/index.js";
import { setCache } from "../core/rebrickable/client.js";
import { VERSION } from "../core/version.js";

const SERVER_INSTRUCTIONS = `\
You are connected to the Brickognize LEGO recognition server.

Provide imagePath (absolute path to a local image file) to any recognition tool.

WHICH TOOL TO USE:
- Single item, unknown type → brickognize_identify
- Single brick/element → brickognize_identify_part
- Single set box or assembled set → brickognize_identify_set
- Single minifigure → brickognize_identify_fig
- Multiple images at once → brickognize_batch_identify
- ONE photo showing several parts (a pile or layout) → brickognize_scan_image

PREFER brickognize_batch_identify whenever you have 2 or more images that each show a single item — it processes them in parallel and is significantly faster than calling single-image tools sequentially. A photo showing several parts needs brickognize_scan_image instead: identify tools return one item per image.

SCANNING A PHOTO OF SEVERAL PARTS (brickognize_scan_image):
1. Call with detectOnly=true and look at both returned images (numbered boxes over a 10% grid, and the crop sheet).
2. Fix the boxes if needed: drop background/shadow boxes, add missed parts, split boxes holding touching parts.
   Boxes are [x1, y1, x2, y2] in percent (0–100) of the image. Read the warnings; they point at likely problems.
3. Call again with the approved boxes (always pass them, even if unchanged; [] approves none), plus imageSize, padding, isolateParts and detectionSettings from the detect-only result (pass its minContrast, minPartSize and joinGap as top-level parameters).
   If the result has tips, pass them on to the user in their language: they explain how to take a photo that needs fewer corrections.
   If the preview shows a pattern of mistakes, you may detect again with minContrast / minPartSize / joinGap (see the tool description) instead of fixing many boxes by hand.
4. Groups are provisional part/color counts; review low scores. Pass each lookupBatches entry to brickognize_batch_part_details
   and check colorMatched in its results: false means the predicted color was not found and other colors were returned. Missing colorFilter also means an uncertain color match.

Color prediction is automatic for part identification — identify results include predictedColors, and scan regions include colors (best first).

LOOKUP TOOLS (use after identification or with known IDs):
- Part details (colors, appears in sets) → brickognize_part_details (single) or brickognize_batch_part_details (multiple)
- Set details (parts list, year, theme) → brickognize_set_details
- Minifig details (appears in sets) → brickognize_minifig_details

PREFER brickognize_batch_part_details when looking up 2+ parts — pass parts with their predicted colors, up to 20 per call. Rebrickable allows about one request per second and a common part needs up to 12, so batches of 3 (a scan's lookupBatches) finish within client timeouts. Make these calls one after another, not in parallel.

Unmatched or missing colors return only the first 100 sets per top color. Keep partial=true results and look up remainingColors individually; exact-color lookups cap at 1000 sets, and repeating a capped list adds no data.

A recovered Brickognize 429 pauses new starts; only a final 429 stops the batch. Tiny crops (padded longer side under 24 pixels in the working image, at most 3000px) use "Skipped:" and need corrected boxes, not retries.

HEIC decoding is cancellable, times out after 30s and rejects over 100 MP; uploads are at most 2048px. HEIC ICC/Display-P3 profiles are not applied: use an sRGB JPEG for accurate color.

Batch tools return partial results rather than time out: entries starting with "Not identified" or "Not looked up" need retrying — pass them again in a new call. Transient Rebrickable 429/5xx/timeouts/network errors also use "Not looked up:"; honor the shared backoff after 429.

These tools use the Rebrickable API and require a REBRICKABLE_API_KEY environment variable.

CACHE (optional):
- brickognize_cache_clear is only available when BRICKOGNIZE_CACHE=memory or sqlite is set.
  Do not attempt to call it if it does not appear in the tool list.
`;

export function createServer(): McpServer {
  const cache = initCache();
  setCache(cache);

  const server = new McpServer(
    { name: "brickognize", version: VERSION },
    { instructions: SERVER_INSTRUCTIONS },
  );

  registerHealthTool(server);
  registerPredictTools(server);
  registerBatchIdentifyTool(server);
  registerScanTool(server);
  registerPartDetailsTool(server);
  registerBatchPartDetailsTool(server);
  registerSetDetailsTool(server);
  registerMinifigDetailsTool(server);

  if (cache !== null) {
    registerCacheClearTool(server, cache);
  }

  return server;
}
