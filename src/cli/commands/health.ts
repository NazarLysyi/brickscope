import type { Command } from "commander";
import { checkHealth } from "../../core/brickognize/client.js";

export function registerHealthCommand(program: Command): void {
  program
    .command("health")
    .description("Check whether the Brickognize API is online")
    .option("--json", "Output raw JSON")
    .action(async (opts) => {
      try {
        const health = await checkHealth();
        if (opts.json) {
          console.log(JSON.stringify(health, null, 2));
        } else {
          const status = Object.values(health).every(Boolean) ? "healthy" : "degraded";
          console.log(`Brickognize API: ${status}`);
          for (const [key, value] of Object.entries(health)) {
            console.log(`  ${key}: ${value ? "ok" : "FAIL"}`);
          }
        }
      } catch (error) {
        console.error(error instanceof Error ? error.message : "Failed to check health");
        process.exit(1);
      }
    });
}
