#!/usr/bin/env node
import { Command } from "commander";
import { applyConfig } from "../core/config.js";
import { initCache } from "../core/cache/index.js";
import { setCache } from "../core/rebrickable/client.js";
import { registerHealthCommand } from "./commands/health.js";
import { registerIdentifyCommand } from "./commands/identify.js";
import { registerPartCommand } from "./commands/part.js";
import { registerSetCommand } from "./commands/set.js";
import { registerMinifigCommand } from "./commands/minifig.js";
import { registerMcpCommand } from "./commands/mcp.js";
import { registerConfigCommand } from "./commands/config.js";

// Load config file values (env vars take priority)
applyConfig();

// Initialize cache from resolved config
const cache = initCache();
setCache(cache);

const program = new Command()
  .name("brickscope")
  .description("Identify LEGO parts, sets, and minifigures from images")
  .version("0.1.0");

registerHealthCommand(program);
registerIdentifyCommand(program);
registerPartCommand(program);
registerSetCommand(program);
registerMinifigCommand(program);
registerMcpCommand(program);
registerConfigCommand(program);

program.parse();
