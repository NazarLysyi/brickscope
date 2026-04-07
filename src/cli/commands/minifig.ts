import type { Command } from "commander";
import { fetchMinifigDetails } from "../../core/rebrickable/minifigDetails.js";
import { formatToolError } from "../../core/utils/errors.js";
import { formatMinifigDetails } from "../output.js";

export function registerMinifigCommand(program: Command): void {
  program
    .command("minifig")
    .description("Get LEGO minifigure details and which sets contain it")
    .argument("<ids...>", "Minifigure ID(s), e.g. fig-000001")
    .option("--json", "Output raw JSON")
    .action(async (ids: string[], opts) => {
      try {
        if (ids.length === 1) {
          const result = await fetchMinifigDetails(ids[0]);

          if (opts.json) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            console.log(formatMinifigDetails(result));
          }
        } else {
          const results = [];

          for (const minifigId of ids) {
            try {
              const result = await fetchMinifigDetails(minifigId);
              results.push({ minifigId, status: "success" as const, result });
            } catch (err) {
              results.push({ minifigId, status: "error" as const, error: formatToolError(err) });
            }
          }

          if (opts.json) {
            console.log(JSON.stringify(results, null, 2));
          } else {
            for (const r of results) {
              console.log(`\n--- ${r.minifigId} ---`);
              if (r.status === "success") {
                console.log(formatMinifigDetails(r.result));
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
        console.error(error instanceof Error ? error.message : "Failed to fetch minifig details");
        process.exit(1);
      }
    });
}
