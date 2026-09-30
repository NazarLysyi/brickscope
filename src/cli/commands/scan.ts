import type { Command } from "commander";
import { constants, type BigIntStats } from "node:fs";
import { access, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { resolveImagePath } from "../../core/image.js";
import {
  DETECTION_DEFAULTS,
  DETECTION_RANGES,
  loadScanner,
  MAX_REGIONS_LIMIT,
  resolveScanOptions,
  SCAN_DEFAULTS,
  type ScanOptions,
  type DetectionSettings,
} from "../../core/scan/options.js";
import type { ScanRegion, Size } from "../../core/scan/types.js";
import { imageNotFound } from "../../core/utils/errors.js";
import { formatScan } from "../output.js";

interface RegionsFile {
  image?: string;
  size?: Size;
  padding?: number;
  isolateParts?: boolean;
  detectionSettings?: DetectionSettings;
  boxes: unknown;
}

/** Decode a JSON file saved as UTF-8 (with or without BOM) or UTF-16 (e.g. by PowerShell). */
function decodeText(bytes: Buffer): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.subarray(2).toString("utf16le");
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    const body = Buffer.from(bytes.subarray(2, bytes.length - (bytes.length % 2)));
    return body.swap16().toString("utf16le");
  }
  return bytes.toString("utf8").replace(/^\uFEFF/, "");
}

function parseJson(text: string, source: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${source} is not valid JSON.`);
  }
}

/** A regions.json from a previous run, or a bare array of boxes. */
export function toRegionsFile(json: unknown, source: string): RegionsFile {
  if (Array.isArray(json)) return { boxes: json };
  if (json === null || typeof json !== "object" || !("boxes" in json)) {
    throw new Error(`${source} must be an array of boxes or an object with a "boxes" array.`);
  }
  const file = json as Record<string, unknown>;
  const isCount = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v > 0;
  const size = file.size as Record<string, unknown> | undefined;
  if (size !== undefined && !(isCount(size?.width) && isCount(size?.height))) {
    throw new Error(`${source}: "size" must be { "width": number, "height": number }.`);
  }
  if (file.image !== undefined && typeof file.image !== "string") {
    throw new Error(`${source}: "image" must be a file path.`);
  }
  if (file.padding !== undefined && typeof file.padding !== "number") {
    throw new Error(`${source}: "padding" must be a number.`);
  }
  if (file.isolateParts !== undefined && typeof file.isolateParts !== "boolean") {
    throw new Error(`${source}: "isolateParts" must be a boolean.`);
  }
  if (file.detectionSettings !== undefined) {
    if (
      !file.detectionSettings ||
      typeof file.detectionSettings !== "object" ||
      Array.isArray(file.detectionSettings)
    ) {
      throw new Error(`${source}: "detectionSettings" must be an object.`);
    }
    const settings = file.detectionSettings as DetectionSettings;
    resolveScanOptions({
      minContrast: settings.minContrast,
      minPartSize: settings.minPartSize,
      joinGap: settings.joinGap,
    });
  }
  return json as RegionsFile;
}

function parseNumber(value: string, option: string): number {
  // Plain decimals only (".1", "1.", "1e-1"); Number() alone would also take "0x10".
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(value.trim())) {
    throw new Error(`${option} must be a number, got "${value}".`);
  }
  return Number(value.trim());
}

/** regions.json with one box per line, so an agent can edit it and pass it back via --boxes-file. */
export function formatRegionsFile(
  image: string,
  size: Size,
  padding: number,
  regions: ScanRegion[],
  isolateParts: boolean,
  detectionSettings: DetectionSettings,
) {
  const boxes = regions
    .map((r) => `    ${JSON.stringify(r.box).replaceAll(",", ", ")}`)
    .join(",\n");
  return (
    `{\n  "image": ${JSON.stringify(image)},\n  "size": ${JSON.stringify(size)},\n` +
    `  "padding": ${padding},\n  "isolateParts": ${isolateParts},\n  "detectionSettings": ${JSON.stringify(detectionSettings)},\n  "boxes": [${boxes ? `\n${boxes}\n  ` : ""}]\n}\n`
  );
}

async function statOrNull(path: string): Promise<BigIntStats | null> {
  try {
    return await stat(path, { bigint: true });
  } catch {
    return null;
  }
}

/**
 * Whether `path` is the same file as the input: device and inode match (bigint, so 64-bit
 * NTFS ids compare exactly). Filesystems that report inode 0 (e.g. some SMB shares) fall
 * back to comparing real paths, case-insensitively where the filesystem usually is.
 */
async function isInputFile(path: string, input: { path: string; stat: BigIntStats }) {
  const existing = await statOrNull(path);
  if (!existing) return false;
  if (existing.ino !== 0n && input.stat.ino !== 0n) {
    return existing.dev === input.stat.dev && existing.ino === input.stat.ino;
  }
  const fold = (p: string) =>
    process.platform === "darwin" || process.platform === "win32" ? p.toLowerCase() : p;
  const [a, b] = await Promise.all([realpath(path), realpath(input.path)]);
  return fold(a) === fold(b);
}

export function registerScanCommand(program: Command): void {
  program
    .command("scan")
    .description("Find and identify multiple LEGO parts in one photo")
    .argument("<image>", "Path to a photo with several parts (JPEG, PNG, WebP, or HEIC)")
    .option("--detect-only", "Only find parts and write previews, without identifying them")
    .option(
      "--boxes <json>",
      "Approved part boxes as JSON [[x1,y1,x2,y2],...] in percent of the image (replaces auto-detection; [] approves none)",
    )
    .option(
      "--boxes-file <path>",
      "Read approved boxes, padding, isolation and detection settings from a regions.json",
    )
    .option(
      "-o, --out-dir <dir>",
      "Where to write annotated.jpg, crops.jpg and regions.json, overwriting them (default: a new temp dir)",
    )
    .option(
      "--padding <ratio>",
      `Crop padding as a fraction of the part's longer side (default: ${SCAN_DEFAULTS.padding}, or the value in --boxes-file)`,
    )
    .option(
      "--max-regions <n>",
      `Maximum auto-detected regions to process, largest first (1-${MAX_REGIONS_LIMIT})`,
      String(SCAN_DEFAULTS.maxRegions),
    )
    .option(
      "--min-contrast <deltaE>",
      `Detection: how different from the surface a part must be (${DETECTION_RANGES.minContrast.join("-")}, default ${DETECTION_DEFAULTS.minContrast}); raise on wood grain or patterned fabric`,
    )
    .option(
      "--min-part-size <percent>",
      `Detection: smallest region kept, in % of the photo (default ${DETECTION_DEFAULTS.minPartSize}); raise to drop specks`,
    )
    .option(
      "--join-gap <percent>",
      `Detection: gaps up to this wide (% of the shorter side) join into one region (default ${DETECTION_DEFAULTS.joinGap}); lower to separate parts lying close`,
    )
    .option(
      "--isolate",
      "Paint other detected parts out of each crop with the background color (when a small part's crop catches a big neighbor)",
    )
    .option("--no-isolate", "Disable isolation saved in --boxes-file")
    .option("--json", "Output raw JSON")
    .action(async (image: string, opts) => {
      let createdTempDir: string | null = null;
      try {
        if (opts.boxes !== undefined && opts.boxesFile !== undefined) {
          throw new Error("Use either --boxes or --boxes-file, not both.");
        }
        const regionsFile =
          opts.boxes !== undefined
            ? toRegionsFile(parseJson(opts.boxes, "--boxes"), "--boxes")
            : opts.boxesFile !== undefined
              ? toRegionsFile(
                  parseJson(decodeText(await readFile(opts.boxesFile)), opts.boxesFile),
                  opts.boxesFile,
                )
              : null;

        const inputPath = resolveImagePath(image).path;
        const inputStat = await statOrNull(inputPath);
        if (!inputStat) throw imageNotFound(inputPath);

        if (regionsFile?.image && resolve(regionsFile.image) !== inputPath) {
          console.error(
            `Note: ${opts.boxesFile ?? "--boxes"} was made for ${regionsFile.image}; using it for ${inputPath}.`,
          );
        }

        const scanOptions: ScanOptions = {
          boxes: regionsFile?.boxes,
          expectedSize: regionsFile?.size,
          detectOnly: opts.detectOnly === true,
          padding:
            opts.padding !== undefined
              ? parseNumber(opts.padding, "--padding")
              : (regionsFile?.padding ?? SCAN_DEFAULTS.padding),
          maxRegions: parseNumber(opts.maxRegions, "--max-regions"),
          isolateParts: opts.isolate ?? regionsFile?.isolateParts ?? false,
          minContrast: regionsFile?.detectionSettings?.minContrast,
          minPartSize: regionsFile?.detectionSettings?.minPartSize,
          joinGap: regionsFile?.detectionSettings?.joinGap,
          ...(opts.minContrast !== undefined
            ? { minContrast: parseNumber(opts.minContrast, "--min-contrast") }
            : {}),
          ...(opts.minPartSize !== undefined
            ? { minPartSize: parseNumber(opts.minPartSize, "--min-part-size") }
            : {}),
          ...(opts.joinGap !== undefined
            ? { joinGap: parseNumber(opts.joinGap, "--join-gap") }
            : {}),
        };
        const { padding } = resolveScanOptions(scanOptions);

        // Prepare the output directory before any API calls, so a bad --out-dir fails fast.
        let outDir: string;
        if (opts.outDir !== undefined) {
          outDir = resolve(opts.outDir);
          await mkdir(outDir, { recursive: true });
          await access(outDir, constants.W_OK);
        } else {
          outDir = createdTempDir = await mkdtemp(join(tmpdir(), "brickscope-scan-"));
        }
        const paths = {
          annotated: join(outDir, "annotated.jpg"),
          crops: join(outDir, "crops.jpg"),
          regions: join(outDir, "regions.json"),
        };
        // Compare file identity, not path strings: case-insensitive filesystems and links
        // can make a different-looking output path the input photo itself.
        for (const path of Object.values(paths)) {
          if (await isInputFile(path, { path: inputPath, stat: inputStat })) {
            throw new Error(
              `Refusing to overwrite the input image ${inputPath}; choose another --out-dir.`,
            );
          }
        }

        const { scanImage } = await loadScanner();
        const { result, annotatedImage, cropSheet } = await scanImage(image, scanOptions);
        createdTempDir = null;

        // Write each file this run produces; a crop sheet from an earlier run into the same
        // directory would no longer match, so it goes (it was checked above not to be the input).
        const written: { annotated: string | null; crops: string | null; regions: string | null } =
          { annotated: null, crops: null, regions: null };
        let writeError: unknown = null;
        try {
          if (annotatedImage) {
            await writeFile(paths.annotated, annotatedImage);
            written.annotated = paths.annotated;
          }
          await writeFile(
            paths.regions,
            formatRegionsFile(
              inputPath,
              result.image,
              padding,
              result.regions,
              result.isolateParts,
              result.detectionSettings,
            ),
          );
          written.regions = paths.regions;
          if (cropSheet) {
            await writeFile(paths.crops, cropSheet);
            written.crops = paths.crops;
          } else {
            // Best effort: a stale sheet from an earlier run shouldn't block anything.
            await rm(paths.crops, { force: true }).catch(() => undefined);
          }
        } catch (err) {
          writeError = err;
        }

        if (opts.json) {
          console.log(JSON.stringify({ ...result, files: written }, null, 2));
        } else {
          console.log(formatScan(result, written));
        }
        if (writeError) {
          console.error(
            `Could not write output files to ${outDir}: ${writeError instanceof Error ? writeError.message : String(writeError)}`,
          );
          // Not process.exit(): it can drop piped stdout that hasn't been flushed yet.
          process.exitCode = 1;
        }
      } catch (error) {
        if (createdTempDir) await rm(createdTempDir, { recursive: true, force: true });
        console.error(error instanceof Error ? error.message : "Scan failed");
        process.exitCode = 1;
      }
    });
}
