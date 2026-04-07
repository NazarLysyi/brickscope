import type { Command } from "commander";
import { predict } from "../../core/brickognize/client.js";
import { mapPredictionResult } from "../../core/brickognize/mappers.js";
import { resolveImage, PREDICT_ENDPOINTS } from "../../core/image.js";
import { runWithConcurrencyLimit } from "../../core/concurrency.js";
import { formatToolError } from "../../core/utils/errors.js";
import { formatPrediction } from "../output.js";

const CONCURRENCY_LIMIT = 5;

export function registerIdentifyCommand(program: Command): void {
  program
    .command("identify")
    .description("Identify LEGO item(s) from photo(s)")
    .argument("<images...>", "Path(s) to image files (JPEG, PNG, or WebP)")
    .option("-t, --type <type>", "Item type: general, part, set, fig", "general")
    .option("--json", "Output raw JSON")
    .action(async (images: string[], opts) => {
      const type = opts.type as keyof typeof PREDICT_ENDPOINTS;
      const endpoint = PREDICT_ENDPOINTS[type];

      if (!endpoint) {
        console.error(`Unknown type "${opts.type}". Valid types: general, part, set, fig`);
        process.exit(1);
      }

      try {
        if (images.length === 1) {
          const { blob, filename } = await resolveImage({ imagePath: images[0] });
          const raw = await predict(endpoint, blob, filename);
          const result = mapPredictionResult(raw, false);

          if (opts.json) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            console.log(formatPrediction(result));
          }
        } else {
          const tasks = images.map((imagePath) => async () => {
            try {
              const { blob, filename } = await resolveImage({ imagePath });
              const raw = await predict(endpoint, blob, filename);
              const result = mapPredictionResult(raw, false);
              return { imagePath, status: "success" as const, result };
            } catch (err) {
              return { imagePath, status: "error" as const, error: formatToolError(err) };
            }
          });

          const results = await runWithConcurrencyLimit(tasks, CONCURRENCY_LIMIT);

          if (opts.json) {
            console.log(JSON.stringify(results, null, 2));
          } else {
            for (const r of results) {
              console.log(`\n--- ${r.imagePath} ---`);
              if (r.status === "success") {
                console.log(formatPrediction(r.result));
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
        console.error(error instanceof Error ? error.message : "Identification failed");
        process.exit(1);
      }
    });
}
