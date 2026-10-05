import { getPartColors, getPartColorSets, getPartDetails } from "./client.js";
import type { RebrickablePartColor } from "./types.js";
import { isRetryableLookupError } from "../utils/errors.js";

/** Most parts brickognize_batch_part_details accepts per call. */
export const MAX_BATCH_PARTS = 20;

/**
 * Parts per batch that finish within a 60s client timeout on a cold cache: a common part
 * takes about 12 throttled requests (details, colors, up to 10 pages of sets) at ~1.1s each.
 */
export const RECOMMENDED_BATCH_PARTS = 3;

export function normalizeColorName(name: string): string {
  return name.trim().toLowerCase();
}

export function matchColorByName(
  colors: RebrickablePartColor[],
  colorName: string,
): RebrickablePartColor | undefined {
  const normalized = normalizeColorName(colorName);
  return colors.find((c) => normalizeColorName(c.color_name) === normalized);
}

export interface PartDetailsResult {
  part: {
    partNum: string;
    name: string;
    imageUrl: string | null;
    url: string;
  };
  totalColors: number;
  totalSetsAppearances: number;
  /** Some set lists are incomplete; look up remainingColors individually. */
  partial?: boolean;
  remainingColors?: string[];
  colorFilter?: string;
  colorMatched?: boolean;
  colorDetails: {
    colorId: number;
    colorName: string;
    numSets: number;
    imageUrl: string | null;
    sets: {
      setNum: string;
      setName: string;
      year: number;
      numParts: number;
      imageUrl: string | null;
      setUrl: string;
    }[];
  }[];
}

export async function fetchPartDetails(
  partId: string,
  colorName?: string,
  signal?: AbortSignal,
): Promise<PartDetailsResult> {
  const part = await getPartDetails(partId, signal);
  const colors = await getPartColors(partId, signal);

  let targetColors: RebrickablePartColor[];
  let filterMode: "exact" | "top";

  if (colorName) {
    const matched = matchColorByName(colors, colorName);
    if (matched) {
      targetColors = [matched];
      filterMode = "exact";
    } else {
      targetColors = [...colors].sort((a, b) => b.num_sets - a.num_sets).slice(0, 5);
      filterMode = "top";
    }
  } else {
    targetColors = [...colors].sort((a, b) => b.num_sets - a.num_sets).slice(0, 5);
    filterMode = "top";
  }

  // Sequential to respect Rebrickable rate limit (1 req/sec)
  const colorSets: PartDetailsResult["colorDetails"] = [];
  const remainingColors: string[] = [];
  for (const color of targetColors) {
    let sets;
    try {
      signal?.throwIfAborted();
      sets = await getPartColorSets(
        partId,
        color.color_id,
        signal,
        filterMode === "top" ? 1 : undefined,
      );
    } catch (error) {
      // Keep what was fetched; a transient failure (timeout, 429, 5xx) leaves the rest to retry.
      if (!signal?.aborted && !isRetryableLookupError(error)) throw error;
      remainingColors.push(...targetColors.slice(colorSets.length).map((c) => c.color_name));
      break;
    }
    if (sets.length < color.num_sets) remainingColors.push(color.color_name);
    colorSets.push({
      colorId: color.color_id,
      colorName: color.color_name,
      numSets: color.num_sets,
      imageUrl: color.part_img_url,
      sets: sets.map((s) => ({
        setNum: s.set_num,
        setName: s.name,
        year: s.year,
        numParts: s.num_parts,
        imageUrl: s.set_img_url,
        setUrl: s.set_url,
      })),
    });
  }

  const totalSets = colors.reduce((sum, c) => sum + c.num_sets, 0);

  return {
    part: {
      partNum: part.part_num,
      name: part.name,
      imageUrl: part.part_img_url,
      url: part.part_url,
    },
    totalColors: colors.length,
    totalSetsAppearances: totalSets,
    ...(colorName ? { colorFilter: colorName, colorMatched: filterMode === "exact" } : {}),
    colorDetails: colorSets,
    ...(remainingColors.length > 0 ? { partial: true, remainingColors } : {}),
  };
}

export function buildPartSummary(result: PartDetailsResult): string {
  let summary = `Part ${result.part.partNum}: ${result.part.name}. `;
  summary += `Available in ${result.totalColors} color(s), appears in ~${result.totalSetsAppearances} set(s).`;

  if (result.colorMatched && result.colorDetails.length === 1) {
    const c = result.colorDetails[0];
    summary += ` Filtered by color "${c.colorName}": ${c.numSets} set(s).`;
  } else if (result.colorFilter && !result.colorMatched) {
    summary += ` Color "${result.colorFilter}" not found in Rebrickable, showing top 5 colors.`;
  } else {
    summary +=
      ` Top colors: ` +
      result.colorDetails.map((c) => `${c.colorName} (${c.numSets} sets)`).join(", ") +
      ".";
  }

  if (result.partial)
    summary += ` Partial set lists; look up these colors individually: ${result.remainingColors?.join(", ")}.`;
  return summary;
}
