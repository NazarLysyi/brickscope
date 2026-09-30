import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  fetchPartDetails,
  buildPartSummary,
  MAX_BATCH_PARTS,
  RECOMMENDED_BATCH_PARTS,
  normalizeColorName,
  matchColorByName,
} from "../../core/rebrickable/partDetails.js";
import { formatToolError, isRetryableLookupError } from "../../core/utils/errors.js";
import { MCP_TIME_BUDGET_MS, TOOL_ANNOTATIONS, toolError, toolSuccess } from "./shared.js";

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
        "Without a matching colorName, returns at most 100 sets per top color (up to 5 colors). Exact-color lists cap at 1000 sets. Partial results flag partial=true and remainingColors; keep the fetched data and look up remaining colors individually. Repeating an exact-color list at the cap adds no data.\n\n" +
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
    async (input, extra) => {
      try {
        const result = await fetchPartDetails(
          input.partId,
          input.colorName,
          AbortSignal.any([extra.signal, AbortSignal.timeout(MCP_TIME_BUDGET_MS)]),
        );
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
        "Ideal workflow: call brickognize_batch_identify first, then pass the identified parts " +
        `with their predicted colors to this tool, up to ${MAX_BATCH_PARTS} per call. Each part ` +
        "takes several rate-limited Rebrickable requests (about one per second, up to 12 for a " +
        `common part), so batches of ${RECOMMENDED_BATCH_PARTS} finish within client timeouts. ` +
        `Parts not reached within about ${MCP_TIME_BUDGET_MS / 1000}s are returned as errors ` +
        "to look up again.\n\n" +
        "Each entry needs a partId and optional colorName for targeted color lookup. " +
        "Results are returned in the same order as the input. Missing/unmatched colors return at most 100 sets per top color; exact colors cap at 1000 sets. Keep partial=true results and look up remainingColors individually (repeating a list already at the cap adds no data). Transient 429/5xx/timeouts/network errors start with Not looked up: and can be retried; 429 backs off subsequent requests.",
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
          .max(MAX_BATCH_PARTS)
          .describe(`Array of parts to look up. Max ${MAX_BATCH_PARTS} per call.`),
      },
      annotations: TOOL_ANNOTATIONS,
    },
    async ({ parts }: { parts: BatchPartEntry[] }, extra) => {
      try {
        const results: BatchPartResultItem[] = [];
        // One stop signal for the whole call, down to each Rebrickable request and page.
        const stop = AbortSignal.any([extra.signal, AbortSignal.timeout(MCP_TIME_BUDGET_MS)]);
        const notLookedUp = () =>
          `Not looked up: ${extra.signal.aborted ? "the call was cancelled" : "the time budget ran out"}; look this part up again.`;

        // Process sequentially due to Rebrickable rate limiting (1 req/sec)
        for (const entry of parts) {
          if (stop.aborted) {
            results.push({ partId: entry.partId, status: "error", error: notLookedUp() });
            continue;
          }
          try {
            const result = await fetchPartDetails(entry.partId, entry.colorName, stop);
            results.push({ partId: entry.partId, status: "success", result });
          } catch (err) {
            const retryable = stop.aborted || isRetryableLookupError(err);
            results.push({
              partId: entry.partId,
              status: "error",
              error: retryable
                ? stop.aborted
                  ? notLookedUp()
                  : `Not looked up: ${formatToolError(err)}; try this part again later.`
                : formatToolError(err),
            });
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
