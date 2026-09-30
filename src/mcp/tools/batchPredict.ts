import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PredictionResult } from "../../core/brickognize/types.js";
import { predictMany } from "../../core/brickognize/batch.js";
import { mapPredictionResult } from "../../core/brickognize/mappers.js";
import { formatToolError } from "../../core/utils/errors.js";
import {
  MCP_TIME_BUDGET_MS,
  PREDICT_ENDPOINTS,
  resolveImage,
  TOOL_ANNOTATIONS,
  toolSuccess,
} from "./shared.js";

const MAX_BATCH_SIZE = 20;

type BatchResultItem =
  | { imagePath: string; status: "success"; result: PredictionResult }
  | { imagePath: string; status: "error"; error: string };

export function registerBatchIdentifyTool(server: McpServer): void {
  server.registerTool(
    "brickognize_batch_identify",
    {
      title: "Batch Identify LEGO Items",
      description:
        "Identify multiple LEGO items from local image files in a single call. " +
        "Processes the images in parallel and returns an array of results. " +
        `Images not identified within about ${MCP_TIME_BUDGET_MS / 1000}s, or after Brickognize ` +
        'starts limiting requests, come back as errors starting with "Not identified": pass ' +
        "those paths again in a new call. " +
        "Use this when the user provides a folder of photos or multiple image paths. " +
        "Accepts 1–20 image paths per call.\n\n" +
        "When type='part', color prediction is included automatically in each result's predictedColors field.",
      inputSchema: {
        imagePaths: z
          .array(z.string())
          .min(1)
          .max(MAX_BATCH_SIZE)
          .describe(
            `Array of absolute paths to local image files (JPEG, PNG, WebP, or HEIC). Max ${MAX_BATCH_SIZE} images per call.`,
          ),
        type: z
          .enum(["general", "part", "set", "fig"])
          .default("part")
          .describe(
            "Type of identification: 'part' for single bricks/elements, 'set' for assembled sets or boxes, 'fig' for minifigures, 'general' when unknown.",
          ),
        includeRaw: z
          .boolean()
          .default(false)
          .describe("When true, includes the raw Brickognize API response in each result."),
      },
      annotations: TOOL_ANNOTATIONS,
    },
    async ({ imagePaths, type, includeRaw }, extra) => {
      const { outcomes } = await predictMany(
        PREDICT_ENDPOINTS[type],
        imagePaths.map((imagePath) => (signal) => resolveImage({ imagePath }, signal)),
        { deadline: Date.now() + MCP_TIME_BUDGET_MS, signal: extra.signal },
      );

      const results: BatchResultItem[] = outcomes.map((outcome, index) => {
        const imagePath = imagePaths[index];
        if (outcome.status === "error") return { imagePath, status: "error", error: outcome.error };
        try {
          return {
            imagePath,
            status: "success",
            result: mapPredictionResult(outcome.raw, includeRaw),
          };
        } catch (err) {
          return { imagePath, status: "error", error: formatToolError(err) };
        }
      });

      const succeeded = results.filter((r) => r.status === "success").length;
      const failed = results.length - succeeded;

      const summary =
        `Batch complete: ${succeeded}/${results.length} succeeded` +
        (failed > 0 ? `, ${failed} failed.` : ".");

      return toolSuccess(summary, JSON.stringify(results, null, 2));
    },
  );
}
