import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TOOL_ANNOTATIONS } from "./shared.js";
import { checkHealth } from "../brickognize/client.js";
import { formatToolError } from "../utils/errors.js";

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
        return {
          content: [{ type: "text" as const, text: JSON.stringify(health, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: formatToolError(error) }],
        };
      }
    },
  );
}
