import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  DETECTION_DEFAULTS,
  DETECTION_RANGES,
  loadScanner,
  MAX_PADDING,
  MAX_REGIONS_LIMIT,
  SCAN_DEFAULTS,
} from "../../core/scan/options.js";
import {
  MCP_TIME_BUDGET_MS,
  TOOL_ANNOTATIONS,
  toolError,
  toolSuccess,
  toolSuccessWithImages,
} from "./shared.js";

export function registerScanTool(server: McpServer): void {
  server.registerTool(
    "brickognize_scan_image",
    {
      title: "Scan Photo for Multiple LEGO Parts",
      description:
        "Find, crop and identify several LEGO parts in ONE photo (a pile or layout of parts). " +
        "Detection runs locally and only proposes boxes; you review them and approve or correct them.\n\n" +
        "Workflow:\n" +
        "1. Call with detectOnly=true. You get the regions plus two images: the photo with numbered boxes over a " +
        "10% grid, and a sheet of the numbered crops exactly as they will be sent for recognition.\n" +
        "2. Check both images and the warnings, and pass any `tips` on to the user (they explain how to take a " +
        "better photo, e.g. to send the original instead of a messenger-compressed copy). Remove boxes on " +
        "background or shadows, add missed parts, " +
        "and split boxes that hold several touching parts. Box coordinates are [x1, y1, x2, y2] in percent " +
        "(0–100) of the image, not fractions; read them off the grid.\n" +
        "3. Call again with the approved boxes (always pass them, even if unchanged; [] approves none), " +
        "plus imageSize, padding, isolateParts and the detectionSettings values as top-level minContrast/minPartSize/joinGap from the detect-only result, and detectOnly=false. Previews are " +
        "only returned in detect-only mode.\n" +
        "Tuning auto-detection (optional; boxes you pass always win): if the preview shows many small boxes " +
        "on wood grain or fabric, detect again with a higher minContrast (18–25) and minPartSize (0.05–0.1); " +
        "if low-contrast parts are missed, lower minContrast (6–8); if nearby parts share one box, lower " +
        "joinGap (0–0.2) and raise minContrast a little; if one part breaks into pieces (transparent parts, " +
        "parts with holes), raise joinGap (1–2). Usually it is quicker to fix a few boxes by hand.\n" +
        "4. Review the results: groups are provisional counts per part and color; check low scores. " +
        "Pass each lookupBatches entry to brickognize_batch_part_details.\n\n" +
        `Recognition uses the parts endpoint with color prediction and stops after about ${MCP_TIME_BUDGET_MS / 1000}s; ` +
        "regions not identified in time are reported as errors and can be scanned again on their own. A recovered 429 pauses new starts; only a final 429 stops the batch. Padded crops under 24 working-image pixels on their longer side (working image at most 3000px) are Skipped, not retryable.",
      inputSchema: {
        imagePath: z
          .string()
          .describe(
            "Absolute path to a local photo with several parts (JPEG, PNG, WebP, or HEIC).",
          ),
        boxes: z
          .array(z.array(z.number()).length(4))
          .max(MAX_REGIONS_LIMIT)
          .optional()
          .describe(
            "Approved part boxes, each [x1, y1, x2, y2] in percent (0–100) of the image after EXIF " +
              "orientation. Replaces auto-detection; an empty array approves no regions. Omit to auto-detect.",
          ),
        imageSize: z
          .object({ width: z.number().int().positive(), height: z.number().int().positive() })
          .optional()
          .describe(
            "The `image` size from the detect-only result these boxes were approved on. A photo of a " +
              "different size is rejected, so boxes can't be applied to the wrong photo.",
          ),
        detectOnly: z
          .boolean()
          .default(false)
          .describe("When true, only detect and return preview images; no recognition requests."),
        padding: z
          .number()
          .min(0)
          .max(MAX_PADDING)
          .default(SCAN_DEFAULTS.padding)
          .describe("Crop padding as a fraction of each part's longer side."),
        maxRegions: z
          .number()
          .int()
          .min(1)
          .max(MAX_REGIONS_LIMIT)
          .default(SCAN_DEFAULTS.maxRegions)
          .describe(
            "Maximum number of auto-detected regions (the largest are kept). Does not limit supplied boxes.",
          ),
        minContrast: z
          .number()
          .min(DETECTION_RANGES.minContrast[0])
          .max(DETECTION_RANGES.minContrast[1])
          .optional()
          .describe(
            `Auto-detection: how different (ΔE) from the surface a part must be. Default ${DETECTION_DEFAULTS.minContrast}; ` +
              "raise on textured surfaces, lower for parts close to the surface color.",
          ),
        minPartSize: z
          .number()
          .min(DETECTION_RANGES.minPartSize[0])
          .max(DETECTION_RANGES.minPartSize[1])
          .optional()
          .describe(
            `Auto-detection: smallest region kept, in percent of the photo. Default ${DETECTION_DEFAULTS.minPartSize}; ` +
              "raise to drop specks, but small pins need about 0.05–0.1 at most.",
          ),
        joinGap: z
          .number()
          .min(DETECTION_RANGES.joinGap[0])
          .max(DETECTION_RANGES.joinGap[1])
          .optional()
          .describe(
            `Auto-detection: gaps up to this wide (percent of the shorter side) are joined into one region. Default ${DETECTION_DEFAULTS.joinGap}; ` +
              "lower to separate parts lying close, raise to keep a fragmented part whole.",
          ),
        isolateParts: z
          .boolean()
          .default(false)
          .describe(
            "Paint other detected parts out of each crop with the background color. Off by default: " +
              "Brickognize already focuses on the main part of a crop, and large painted patches can skew " +
              "its color prediction. Turn on when the crop sheet shows a small part's crop dominated by a " +
              "neighbor. regions[].paintedOut lists what was painted out.",
          ),
        includeRaw: z
          .boolean()
          .default(false)
          .describe("When true, includes the raw Brickognize API response for each region."),
      },
      annotations: TOOL_ANNOTATIONS,
    },
    async (
      {
        imagePath,
        boxes,
        imageSize,
        detectOnly,
        padding,
        maxRegions,
        minContrast,
        minPartSize,
        joinGap,
        isolateParts,
        includeRaw,
      },
      extra,
    ) => {
      try {
        // Loaded on demand: sharp is a native module, and the other tools must work without it.
        const { scanImage } = await loadScanner();
        const { result, annotatedImage, cropSheet } = await scanImage(imagePath, {
          boxes,
          expectedSize: imageSize,
          detectOnly,
          previews: detectOnly,
          padding,
          maxRegions,
          minContrast,
          minPartSize,
          joinGap,
          isolateParts,
          includeRaw,
          signal: extra.signal,
          timeBudgetMs: MCP_TIME_BUDGET_MS,
        });
        // Compact JSON: a 60-region result must stay within MCP clients' output limits.
        const texts = [result.summary, JSON.stringify(result)];
        const images = [annotatedImage, cropSheet].filter((image) => image !== null);
        return images.length > 0 ? toolSuccessWithImages(texts, images) : toolSuccess(...texts);
      } catch (error) {
        return toolError(error);
      }
    },
  );
}
