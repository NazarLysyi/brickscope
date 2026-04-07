import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  fetchPartDetails,
  buildPartSummary,
  normalizeColorName,
  matchColorByName,
} from "../../core/rebrickable/partDetails.js";
import { formatToolError } from "../../core/utils/errors.js";
import { TOOL_ANNOTATIONS, toolError, toolSuccess } from "./shared.js";

// Re-export for tests
export { normalizeColorName, matchColorByName, buildPartSummary as buildSingleSummary };

export function registerPartDetailsTool(server: McpServer): void {
  server.registerTool(
    "brickognize_part_details",
    {
      title: "LEGO Part Details",
      description:
        "Get detailed information about a LEGO part by its ID: available colors, " +
        "and which sets contain this part (appears in). " +
        "Use after brickognize_identify_part to enrich results, or directly with a known part number.\n\n" +
        "When colorName is provided (e.g. from predictedColors in identify results), " +
        "returns sets only for that specific color — much faster and more precise.\n" +
        "Without colorName, returns sets for the top 5 most popular colors.\n\n" +
        "For multiple parts at once, use brickognize_batch_part_details instead.",
      inputSchema: {
        partId: z.string().describe('LEGO part number, e.g. "3001" for Brick 2x4.'),
        colorName: z
          .string()
          .describe(
            'Optional color name to filter by (e.g. "Black"). ' +
              "Pass the predicted color name from brickognize_identify_part to get sets for that exact color.",
          )
          .optional(),
      },
      annotations: TOOL_ANNOTATIONS,
    },
    async (input) => {
      try {
        const result = await fetchPartDetails(input.partId, input.colorName);
        const summary = buildPartSummary(result);
        return toolSuccess(summary, JSON.stringify(result, null, 2));
      } catch (error) {
        return toolError(error);
      }
    },
  );
}

type BatchPartEntry = { partId: string; colorName?: string };

type BatchPartResultItem =
  | { partId: string; status: "success"; result: Awaited<ReturnType<typeof fetchPartDetails>> }
  | { partId: string; status: "error"; error: string };

export function registerBatchPartDetailsTool(server: McpServer): void {
  server.registerTool(
    "brickognize_batch_part_details",
    {
      title: "Batch LEGO Part Details",
      description:
        "Get details for multiple LEGO parts in a single call: colors, and which sets contain each part.\n\n" +
        "Ideal workflow: call brickognize_batch_identify first, then pass all identified parts " +
        "with their predicted colors to this tool in one call.\n\n" +
        "Each entry needs a partId and optional colorName for targeted color lookup. " +
        "Results are returned in the same order as the input.",
      inputSchema: {
        parts: z
          .array(
            z.object({
              partId: z.string().describe("LEGO part number"),
              colorName: z
                .string()
                .describe('Color name from predictedColors (e.g. "Black")')
                .optional(),
            }),
          )
          .min(1)
          .max(20)
          .describe("Array of parts to look up. Max 20 per call."),
      },
      annotations: TOOL_ANNOTATIONS,
    },
    async ({ parts }: { parts: BatchPartEntry[] }) => {
      try {
        const results: BatchPartResultItem[] = [];

        // Process sequentially due to Rebrickable rate limiting (1 req/sec)
        for (const entry of parts) {
          try {
            const result = await fetchPartDetails(entry.partId, entry.colorName);
            results.push({ partId: entry.partId, status: "success", result });
          } catch (err) {
            results.push({ partId: entry.partId, status: "error", error: formatToolError(err) });
          }
        }

        const succeeded = results.filter((r) => r.status === "success").length;
        const failed = results.length - succeeded;

        const summary =
          `Batch part details: ${succeeded}/${results.length} succeeded` +
          (failed > 0 ? `, ${failed} failed.` : ".");

        return toolSuccess(summary, JSON.stringify(results, null, 2));
      } catch (error) {
        return toolError(error);
      }
    },
  );
}
