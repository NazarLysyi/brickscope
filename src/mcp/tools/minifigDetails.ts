import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fetchMinifigDetails, buildMinifigSummary } from "../../core/rebrickable/minifigDetails.js";
import { TOOL_ANNOTATIONS, toolError, toolSuccess } from "./shared.js";

export function registerMinifigDetailsTool(server: McpServer): void {
  server.registerTool(
    "brickognize_minifig_details",
    {
      title: "LEGO Minifigure Details",
      description:
        "Get detailed information about a LEGO minifigure by its ID: name, parts count, " +
        "and which sets contain this minifigure. " +
        "Use after brickognize_identify_fig to enrich results, or directly with a known minifigure ID.\n\n" +
        'Accepts minifigure IDs like "fig-000001" or set-style IDs.',
      inputSchema: {
        minifigId: z.string().describe('LEGO minifigure ID, e.g. "fig-000001".'),
      },
      annotations: TOOL_ANNOTATIONS,
    },
    async (input) => {
      try {
        const result = await fetchMinifigDetails(input.minifigId);
        const summary = buildMinifigSummary(result);
        return toolSuccess(summary, JSON.stringify(result, null, 2));
      } catch (error) {
        return toolError(error);
      }
    },
  );
}
