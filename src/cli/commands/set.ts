import type { Command } from "commander";
import { fetchSetDetails } from "../../core/rebrickable/setDetails.js";
import { formatToolError } from "../../core/utils/errors.js";
import { formatSetDetails } from "../output.js";

export function registerSetCommand(program: Command): void {
  program
    .command("set")
    .description("Get LEGO set details: inventory, year, theme, piece count")
    .argument("<ids...>", 'Set number(s), e.g. 75192 (the "-1" suffix is added automatically)')
    .option("--json", "Output raw JSON")
    .action(async (ids: string[], opts) => {
      try {
        if (ids.length === 1) {
          const result = await fetchSetDetails(ids[0]);

          if (opts.json) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            console.log(formatSetDetails(result));
          }
        } else {
          const results = [];

          for (const setId of ids) {
            try {
              const result = await fetchSetDetails(setId);
              results.push({ setId, status: "success" as const, result });
            } catch (err) {
              results.push({ setId, status: "error" as const, error: formatToolError(err) });
            }
          }

          if (opts.json) {
            console.log(JSON.stringify(results, null, 2));
          } else {
            for (const r of results) {
              console.log(`\n--- ${r.setId} ---`);
              if (r.status === "success") {
                console.log(formatSetDetails(r.result));
              } else {
                console.error(`Error: ${r.error}`);
              }
            }

            const succeeded = results.filter((r) => r.status === "success").length;
            const failed = results.length - succeeded;
            console.log(
              `\nBatch: ${succeeded}/${results.length} succeeded${failed > 0 ? `, ${failed} failed` : ""}`,
            );
          }
        }
      } catch (error) {
        console.error(error instanceof Error ? error.message : "Failed to fetch set details");
        process.exit(1);
      }
    });
}
