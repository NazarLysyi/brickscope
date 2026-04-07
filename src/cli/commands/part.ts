import type { Command } from "commander";
import { fetchPartDetails } from "../../core/rebrickable/partDetails.js";
import { formatToolError } from "../../core/utils/errors.js";
import { formatPartDetails } from "../output.js";

export function registerPartCommand(program: Command): void {
  program
    .command("part")
    .description("Get details about LEGO part(s): colors, sets containing the part")
    .argument("<ids...>", "LEGO part number(s), e.g. 3001")
    .option("-c, --color <name>", "Filter by color name (e.g. Black)")
    .option("--json", "Output raw JSON")
    .action(async (ids: string[], opts) => {
      try {
        if (ids.length === 1) {
          const result = await fetchPartDetails(ids[0], opts.color);

          if (opts.json) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            console.log(formatPartDetails(result));
          }
        } else {
          const results = [];

          // Sequential due to Rebrickable rate limit
          for (const partId of ids) {
            try {
              const result = await fetchPartDetails(partId, opts.color);
              results.push({ partId, status: "success" as const, result });
            } catch (err) {
              results.push({ partId, status: "error" as const, error: formatToolError(err) });
            }
          }

          if (opts.json) {
            console.log(JSON.stringify(results, null, 2));
          } else {
            for (const r of results) {
              console.log(`\n--- ${r.partId} ---`);
              if (r.status === "success") {
                console.log(formatPartDetails(r.result));
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
        console.error(error instanceof Error ? error.message : "Failed to fetch part details");
        process.exit(1);
      }
    });
}
