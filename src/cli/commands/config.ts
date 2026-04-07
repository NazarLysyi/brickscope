import type { Command } from "commander";
import { loadConfig, saveConfig, getConfigPath } from "../../core/config.js";
import * as readline from "node:readline/promises";

export function registerConfigCommand(program: Command): void {
  const config = program.command("config").description("Manage brickscope configuration");

  config
    .command("show")
    .description("Show current configuration")
    .action(() => {
      const cfg = loadConfig();
      const configPath = getConfigPath();

      console.log(`Config file: ${configPath}`);
      console.log("");

      if (Object.keys(cfg).length === 0) {
        console.log("No configuration set. Run 'brickscope config init' to set up.");
        return;
      }

      if (cfg.rebrickableApiKey) {
        const masked = cfg.rebrickableApiKey.slice(0, 4) + "..." + cfg.rebrickableApiKey.slice(-4);
        console.log(`  rebrickableApiKey: ${masked}`);
      }
      if (cfg.cache) {
        console.log(`  cache: ${cfg.cache}`);
      }
    });

  config
    .command("path")
    .description("Print config file location")
    .action(() => {
      console.log(getConfigPath());
    });

  config
    .command("set <key> <value>")
    .description("Set a configuration value (rebrickableApiKey, cache)")
    .action((key: string, value: string) => {
      const cfg = loadConfig();

      if (key === "rebrickableApiKey") {
        cfg.rebrickableApiKey = value;
      } else if (key === "cache") {
        if (!["none", "memory", "sqlite"].includes(value)) {
          console.error(`Invalid cache value "${value}". Valid: none, memory, sqlite`);
          process.exit(1);
        }
        cfg.cache = value as "none" | "memory" | "sqlite";
      } else {
        console.error(`Unknown config key "${key}". Valid keys: rebrickableApiKey, cache`);
        process.exit(1);
      }

      saveConfig(cfg);
      console.log(`Set ${key} = ${key === "rebrickableApiKey" ? "***" : value}`);
    });

  config
    .command("init")
    .description("Interactive setup wizard")
    .action(async () => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

      try {
        const cfg = loadConfig();

        const apiKey = await rl.question(
          `Rebrickable API key${cfg.rebrickableApiKey ? " (press Enter to keep current)" : ""}: `,
        );
        if (apiKey.trim()) {
          cfg.rebrickableApiKey = apiKey.trim();
        }

        const cache = await rl.question(
          `Cache mode (none/memory/sqlite)${cfg.cache ? ` [${cfg.cache}]` : " [none]"}: `,
        );
        if (cache.trim()) {
          if (!["none", "memory", "sqlite"].includes(cache.trim())) {
            console.error(`Invalid cache value. Using "${cfg.cache ?? "none"}".`);
          } else {
            cfg.cache = cache.trim() as "none" | "memory" | "sqlite";
          }
        }

        saveConfig(cfg);
        console.log(`\nConfiguration saved to ${getConfigPath()}`);
      } finally {
        rl.close();
      }
    });
}
