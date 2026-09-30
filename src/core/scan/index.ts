import { predictMany } from "../brickognize/batch.js";
import { mapPredictionResult } from "../brickognize/mappers.js";
import { PREDICT_ENDPOINTS } from "../image.js";
import { RECOMMENDED_BATCH_PARTS } from "../rebrickable/partDetails.js";
import { formatToolError, invalidInput } from "../utils/errors.js";
import { expandRect, findDuplicateBoxes, percentToPixels, pixelsToPercent } from "./geometry.js";
import { planIsolation } from "./isolation.js";
import { detectionImage, extractCrop, loadImage } from "./load.js";
import {
  resolveScanOptions,
  type DetectionSettings,
  type ResolvedScanOptions,
  type ScanOptions,
} from "./options.js";
import { renderAnnotated, renderCropSheet } from "./render.js";
import { readingOrder, segmentParts, type Segmentation } from "./segment.js";
import { photoTips, resolutionTip } from "./tips.js";
import type {
  LookupEntry,
  PartGroup,
  PercentBox,
  PhotoTip,
  RgbImage,
  ScanOutput,
  ScanRegion,
  ScanWarning,
  Size,
} from "./types.js";

const TOP_MATCHES = 3;
const TOP_COLORS = 3;
/** Crops smaller than this on both sides can't be identified (and are usually fractions). */
const MIN_CROP_PX = 24;
const TOO_SMALL =
  "Skipped: the box is too small to identify (a crop of a few pixels). Boxes are in percent (0–100).";

/**
 * Find LEGO parts in one photo, crop each one and identify the crops with Brickognize.
 * Auto-detection only proposes regions; callers review the rendered previews and pass
 * the approved `boxes` back for recognition.
 */
export async function scanImage(imagePath: string, options: ScanOptions = {}): Promise<ScanOutput> {
  const opts = resolveScanOptions(options);
  const deadline = Date.now() + opts.timeBudgetMs;
  const stop = AbortSignal.any([
    ...(opts.signal ? [opts.signal] : []),
    AbortSignal.timeout(opts.timeBudgetMs),
  ]);
  const prepared = await prepare(imagePath, { ...opts, signal: stop });
  const { warnings, detection } = prepared;
  let { regions } = prepared;

  let groups: PartGroup[] | undefined;
  let lookupBatches: LookupEntry[][] | undefined;

  if (!opts.detectOnly) {
    // Crops of a few pixels are fractions or slips; don't spend API requests on them.
    const tooSmall = new Map(prepared.tinyRegions.map((id) => [id - 1, TOO_SMALL] as const));
    const recognition = await recognizeRegions(prepared.crops, tooSmall, {
      includeRaw: opts.includeRaw,
      deadline,
      signal: opts.signal,
    });
    regions = regions.map((region, index) => ({ ...region, ...recognition.results[index] }));
    if (recognition.rateLimited) {
      warnings.push({
        code: "RATE_LIMITED",
        message:
          "Brickognize is limiting requests, so the remaining boxes were not sent. Wait a minute and scan the unidentified boxes again.",
      });
    }
    groups = groupParts(regions);
    lookupBatches = toLookupBatches(groups);
  }

  return {
    result: {
      summary: buildSummary(
        regions,
        detection,
        opts.detectOnly,
        prepared.omittedRegions,
        warnings,
        groups,
      ),
      image: prepared.size,
      padding: opts.padding,
      detection,
      detectionSettings: opts.detection,
      isolateParts: opts.isolateParts,
      detectOnly: opts.detectOnly,
      ...(groups ? { groups, lookupBatches } : {}),
      warnings,
      ...(prepared.tips.length > 0 ? { tips: prepared.tips } : {}),
      omittedRegions: prepared.omittedRegions,
      regions,
    },
    annotatedImage: prepared.annotatedImage,
    cropSheet: prepared.cropSheet,
  };
}

interface Prepared {
  size: Size;
  detection: "auto" | "manual";
  regions: ScanRegion[];
  omittedRegions: number;
  warnings: ScanWarning[];
  tips: PhotoTip[];
  /** 1-based ids of regions whose crop is too small to identify. */
  tinyRegions: number[];
  crops: Buffer[];
  annotatedImage: Buffer | null;
  cropSheet: Buffer | null;
}

/**
 * Everything that needs the decoded photo. Kept in its own scope so the working raster
 * (tens of MB) can be released before the network calls start.
 */
async function prepare(imagePath: string, opts: ResolvedScanOptions): Promise<Prepared> {
  const { size, working } = await loadImage(imagePath, opts.signal);

  const expected = opts.expectedSize;
  if (expected && (expected.width !== size.width || expected.height !== size.height)) {
    throw invalidInput(
      `The boxes were made for a ${expected.width}x${expected.height} image, but ${imagePath} is ` +
        `${size.width}x${size.height}. Detect regions on this photo first.`,
    );
  }

  const detection = opts.boxes ? "manual" : "auto";
  const { boxes, omittedRegions, warnings, tips, segmentation }: DetectedBoxes = opts.boxes
    ? { boxes: opts.boxes, omittedRegions: 0, warnings: [], tips: [], segmentation: null }
    : await detectRegions(working, opts.maxRegions, opts.detection);
  const workingSize = { width: working.width, height: working.height };
  const cropRects = boxes.map((box) =>
    expandRect(percentToPixels(box, workingSize), opts.padding, workingSize),
  );
  const tinyRegions = cropRects.flatMap((rect, index) =>
    Math.max(rect.width, rect.height) < MIN_CROP_PX ? [index + 1] : [],
  );
  warnings.push(...boxWarnings(boxes, tinyRegions));
  const regions: ScanRegion[] = boxes.map((box, index) => ({
    id: index + 1,
    box,
    cropBox: pixelsToPercent(cropRects[index], workingSize),
  }));

  // Paint other parts out of each crop. Supplied boxes need part masks, so detect for them too.
  const parts =
    opts.isolateParts && boxes.length > 1
      ? (segmentation ?? segmentParts(await detectionImage(working), opts.detection))
      : null;
  const plan = parts
    ? planIsolation(
        parts,
        boxes,
        regions.map((r) => r.cropBox),
        findDuplicateBoxes(boxes),
      )
    : null;

  // Crop once: the same JPEGs feed the crop sheet and Brickognize.
  const crops = await Promise.all(
    cropRects.map((rect, index) =>
      extractCrop(
        working,
        rect,
        parts && plan
          ? {
              labels: plan.labels,
              width: parts.width,
              height: parts.height,
              erase: plan.erase[index],
              onPaint: (labels) => {
                const ids = [...new Set([...labels].map((label) => plan.owners[label] + 1))].sort(
                  (a, b) => a - b,
                );
                if (ids.length > 0) regions[index].paintedOut = ids;
              },
            }
          : undefined,
      ),
    ),
  );
  const [annotatedImage, cropSheet] = opts.previews
    ? await Promise.all([
        renderAnnotated(working, regions),
        renderCropSheet(crops.map((jpeg, index) => ({ id: index + 1, jpeg }))),
      ])
    : [null, null];

  const resolution = resolutionTip(size);
  return {
    size,
    detection,
    regions,
    omittedRegions,
    warnings,
    tips: resolution ? [resolution, ...tips] : tips,
    tinyRegions,
    crops,
    annotatedImage,
    cropSheet,
  };
}

function boxWarnings(boxes: PercentBox[], tiny: number[]): ScanWarning[] {
  const warnings: ScanWarning[] = [];
  for (const [a, b] of findDuplicateBoxes(boxes)) {
    warnings.push({
      code: "DUPLICATE_REGION",
      message: `Regions ${a} and ${b} overlap heavily or one contains the other, so the same part may be counted twice.`,
      regionIds: [a, b],
    });
  }
  if (tiny.length > 0) {
    const fractions = boxes.every((box) => box.every((v) => v <= 1));
    warnings.push({
      code: "TINY_REGION",
      message:
        `Region(s) ${tiny.join(", ")} crop to just a few pixels and are not sent for identification. ` +
        (fractions
          ? "All boxes are within 0–1, which looks like fractions: boxes are in percent, so multiply them by 100."
          : "Boxes are in percent (0–100) of the image."),
      regionIds: tiny,
    });
  }
  return warnings;
}

interface DetectedBoxes {
  boxes: PercentBox[];
  omittedRegions: number;
  warnings: ScanWarning[];
  tips: PhotoTip[];
  segmentation: Segmentation | null;
}

async function detectRegions(
  working: RgbImage,
  maxRegions: number,
  settings: DetectionSettings,
): Promise<DetectedBoxes> {
  const detection = await detectionImage(working);
  const segmentation = segmentParts(detection, settings);
  const found = segmentation.rects;
  // Over the cap, keep the largest regions: specks and noise are the smallest.
  const kept =
    found.length > maxRegions
      ? readingOrder(
          [...found].sort((a, b) => b.width * b.height - a.width * a.height).slice(0, maxRegions),
        )
      : found;
  const omittedRegions = found.length - kept.length;
  const warnings: ScanWarning[] = [];

  if (kept.length === 0) {
    warnings.push({
      code: "NO_REGIONS",
      message:
        "No parts were found. Pass boxes manually, or reshoot on a plain background that contrasts with the parts.",
    });
  }

  if (!segmentation.backgroundUniform) {
    warnings.push({
      code: "BACKGROUND_NOT_UNIFORM",
      message:
        "The background is textured, noisy or mostly covered, so auto-detection may have missed parts or boxed background. Check the annotated image and pass corrected boxes.",
    });
  }

  const flagged = (flag: "touchesBorder" | "large") =>
    kept.flatMap((rect, index) => (rect[flag] ? [index + 1] : []));

  const touching = flagged("touchesBorder");
  if (touching.length > 0) {
    warnings.push({
      code: "REGION_TOUCHES_BORDER",
      message: `Region(s) ${touching.join(", ")} touch the image edge: the part may be cut off, or the box may be background, a table around the sheet, or a shadow.`,
      regionIds: touching,
    });
  }

  const large = flagged("large");
  if (large.length > 0) {
    warnings.push({
      code: "LARGE_REGION",
      message: `Region(s) ${large.join(", ")} are unusually large: they may hold several touching parts (split them) or be background, a table around the sheet, or a shadow (drop them).`,
      regionIds: large,
    });
  }

  if (omittedRegions > 0) {
    warnings.push({
      code: "TRUNCATED",
      message: `Found ${found.length} regions but kept only the ${kept.length} largest (maxRegions). ${omittedRegions} smaller region(s) were not processed; raise maxRegions or add their boxes manually.`,
    });
  }

  return {
    boxes: kept.map((rect) => pixelsToPercent(rect, detection)),
    omittedRegions,
    warnings,
    tips: photoTips(segmentation),
    segmentation,
  };
}

type Recognition = Pick<ScanRegion, "status" | "matches" | "colors" | "error" | "raw">;

async function recognizeRegions(
  crops: Buffer[],
  skip: Map<number, string>,
  options: { includeRaw: boolean; deadline: number; signal?: AbortSignal },
): Promise<{ results: Recognition[]; rateLimited: boolean }> {
  const sent = crops.flatMap((crop, index) => (skip.has(index) ? [] : [{ crop, index }]));
  // Inputs are ready in memory, so the stop signal predictMany hands them isn't needed.
  const { outcomes, rateLimited } = await predictMany(
    PREDICT_ENDPOINTS.part,
    sent.map(({ crop }) => async () => ({
      blob: new Blob([new Uint8Array(crop)], { type: "image/jpeg" }),
      filename: "crop.jpg",
    })),
    { deadline: options.deadline, signal: options.signal },
  );

  const results: Recognition[] = crops.map((_, index) => ({
    status: "error",
    error: skip.get(index),
  }));
  sent.forEach(({ index }, k) => {
    const outcome = outcomes[k];
    if (outcome.status === "error") {
      results[index] = { status: "error", error: outcome.error };
      return;
    }
    try {
      const result = mapPredictionResult(outcome.raw, options.includeRaw);
      results[index] = {
        status: result.matches.length > 0 ? "success" : "no_match",
        matches: result.matches
          .slice(0, TOP_MATCHES)
          .map(({ id, name, type, category, score }) => ({ id, name, type, category, score })),
        colors: (result.predictedColors ?? []).slice(0, TOP_COLORS),
        ...(result.raw ? { raw: result.raw } : {}),
      };
    } catch (err) {
      results[index] = { status: "error", error: formatToolError(err) };
    }
  });
  return { results, rateLimited };
}

/** Group identified regions by top part and top color. */
function groupParts(regions: ScanRegion[]): PartGroup[] {
  const groups = new Map<string, PartGroup>();

  for (const region of regions) {
    const top = region.matches?.[0];
    if (region.status !== "success" || !top || top.type !== "part") continue;

    const colorName = region.colors?.[0]?.name ?? null;
    const key = `${top.id}\u0000${colorName ?? ""}`;
    const group = groups.get(key);

    if (group) {
      group.count++;
      group.regionIds.push(region.id);
      group.minScore = Math.min(group.minScore, top.score);
    } else {
      groups.set(key, {
        partId: top.id,
        name: top.name,
        colorName,
        count: 1,
        regionIds: [region.id],
        minScore: top.score,
      });
    }
  }

  return [...groups.values()].sort((a, b) => b.count - a.count || a.partId.localeCompare(b.partId));
}

export function toLookupBatches(groups: PartGroup[]): LookupEntry[][] {
  const entries = groups.map((g) =>
    g.colorName ? { partId: g.partId, colorName: g.colorName } : { partId: g.partId },
  );
  const batches: LookupEntry[][] = [];
  for (let i = 0; i < entries.length; i += RECOMMENDED_BATCH_PARTS) {
    batches.push(entries.slice(i, i + RECOMMENDED_BATCH_PARTS));
  }
  return batches;
}

function buildSummary(
  regions: ScanRegion[],
  detection: "auto" | "manual",
  detectOnly: boolean,
  omittedRegions: number,
  warnings: ScanWarning[],
  groups?: PartGroup[],
): string {
  const parts: string[] = [];

  if (regions.length === 0) {
    parts.push(
      detection === "manual"
        ? "No boxes were approved, so there is nothing to identify."
        : "No regions were found.",
    );
  } else if (detectOnly) {
    parts.push(
      `Found ${regions.length} region(s) (${detection === "auto" ? "auto-detected" : "from supplied boxes"}). ` +
        "Review the annotated image and crop sheet, then scan again with the approved boxes.",
    );
  } else {
    const count = (status: string) => regions.filter((r) => r.status === status).length;
    parts.push(
      `Scanned ${regions.length} region(s): ${count("success")} identified, ${count("no_match")} without a match, ${count("error")} failed.`,
    );
    if (groups && groups.length > 0) {
      parts.push(
        `${groups.length} distinct part/color group(s); they are provisional, so review low scores.`,
      );
    }
  }

  if (omittedRegions > 0) {
    parts.push(`${omittedRegions} region(s) omitted by maxRegions.`);
  }
  if (warnings.length > 0) {
    parts.push(`Warnings: ${[...new Set(warnings.map((w) => w.code))].join(", ")}.`);
  }

  return parts.join(" ");
}
