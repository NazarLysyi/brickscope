import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CacheBackend } from "../../core/cache/index.js";
import { toolError, toolSuccess } from "./shared.js";

export function registerCacheClearTool(server: McpServer, cache: CacheBackend): void {
  server.registerTool(
    "brickognize_cache_clear",
    {
      title: "Clear Rebrickable Cache",
      description:
        "Clear the local cache of Rebrickable API responses (part details, set inventories, etc.). " +
        "Use when you want to force fresh data from Rebrickable, e.g. after a long time or if data looks stale. " +
        "Returns the number of entries removed.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        const count = cache.clear();
        return toolSuccess(`Cache cleared. ${count} entr${count === 1 ? "y" : "ies"} removed.`);
      } catch (error) {
        return toolError(error);
      }
    },
  );
}
