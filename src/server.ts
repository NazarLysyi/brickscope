import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerHealthTool } from "./tools/health.js";
import { registerIdentifyTool } from "./tools/predict.js";
import { registerIdentifyPartTool } from "./tools/predictParts.js";
import { registerIdentifySetTool } from "./tools/predictSets.js";
import { registerIdentifyFigTool } from "./tools/predictFigs.js";

const SERVER_INSTRUCTIONS = `\
You are connected to the Brickognize LEGO recognition server.

Provide imagePath (absolute path to a local image file) to any recognition tool.

WHICH TOOL TO USE:
- Unknown item type → brickognize_identify
- Single brick/element → brickognize_identify_part
- Set box or assembled set → brickognize_identify_set
- Minifigure → brickognize_identify_fig
`;

export function createServer(): McpServer {
  const server = new McpServer(
    { name: "brickognize", version: "1.0.0" },
    { instructions: SERVER_INSTRUCTIONS },
  );

  registerHealthTool(server);
  registerIdentifyTool(server);
  registerIdentifyPartTool(server);
  registerIdentifySetTool(server);
  registerIdentifyFigTool(server);

  return server;
}
