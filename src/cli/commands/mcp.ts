import type { Command } from "commander";

export function registerMcpCommand(program: Command): void {
  program
    .command("mcp")
    .description("Start MCP server (stdio transport) for AI assistant integration")
    .action(async () => {
      // Dynamic import to avoid loading MCP SDK unless needed
      const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
      const { createServer } = await import("../../mcp/server.js");

      const server = createServer();
      const transport = new StdioServerTransport();

      await server.connect(transport);
    });
}
