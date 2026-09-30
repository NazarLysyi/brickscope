import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  fetchSetDetails,
  buildSetSummary,
  normalizeSetNum,
} from "../../core/rebrickable/setDetails.js";
import { MCP_TIME_BUDGET_MS, TOOL_ANNOTATIONS, toolError, toolSuccess } from "./shared.js";

// Re-export for tests
export { normalizeSetNum };

export function registerSetDetailsTool(server: McpServer): void {
  server.registerTool(
    "brickognize_set_details",
    {
      title: "LEGO Set Details",
      description:
        "Get detailed information about a LEGO set by its number: year, theme, piece count, " +
        "and full parts inventory. " +
        "Use after brickognize_identify_set to enrich results, or directly with a known set number.\n\n" +
        'The "-1" suffix is added automatically if missing (e.g. "75192" → "75192-1").',
      inputSchema: {
        setId: z
          .string()
          .describe(
            'LEGO set number, e.g. "75192-1" or "75192". The "-1" suffix is added automatically.',
          ),
      },
      annotations: TOOL_ANNOTATIONS,
    },
    async (input, extra) => {
      try {
        const result = await fetchSetDetails(
          input.setId,
          AbortSignal.any([extra.signal, AbortSignal.timeout(MCP_TIME_BUDGET_MS)]),
        );
        const summary = buildSetSummary(result);
        return toolSuccess(summary, JSON.stringify(result, null, 2));
      } catch (error) {
        return toolError(error);
      }
    },
  );
}
