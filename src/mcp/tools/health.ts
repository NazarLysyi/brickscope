import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { checkHealth } from "../../core/brickognize/client.js";
import { TOOL_ANNOTATIONS, toolError, toolSuccess } from "./shared.js";

export function registerHealthTool(server: McpServer): void {
  server.registerTool(
    "brickognize_health",
    {
      title: "Brickognize Health Check",
      description:
        "Check whether the Brickognize image recognition API is online and responsive. " +
        "Call this before recognition if you suspect the service might be down. Takes no parameters.",
      annotations: TOOL_ANNOTATIONS,
    },
    async () => {
      try {
        const health = await checkHealth();
        return toolSuccess(JSON.stringify(health, null, 2));
      } catch (error) {
        return toolError(error);
      }
    },
  );
}
