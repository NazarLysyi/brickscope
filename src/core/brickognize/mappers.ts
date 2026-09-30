import type {
  RawSearchResults,
  PredictionResult,
  PredictedColor,
  Match,
  BoundingBox,
} from "./types.js";

const NO_BOUNDING_BOX: RawSearchResults["bounding_box"] = {
  left: 0,
  upper: 0,
  right: 0,
  lower: 0,
  image_width: 0,
  image_height: 0,
  score: 0,
};

export function mapPredictionResult(raw: RawSearchResults, includeRaw: boolean): PredictionResult {
  // A response without a detected object may omit the box; don't fail the whole result.
  const box = raw.bounding_box ?? NO_BOUNDING_BOX;
  const boundingBox: BoundingBox = {
    left: box.left,
    upper: box.upper,
    right: box.right,
    lower: box.lower,
    imageWidth: box.image_width,
    imageHeight: box.image_height,
    score: box.score,
  };

  const matches: Match[] = (raw.items ?? [])
    .map((item) => ({
      id: item.id,
      name: item.name,
      type: item.type,
      category: item.category,
      score: item.score,
      imageUrl: item.img_url,
      externalSites: (item.external_sites ?? []).map((site) => ({
        name: site.name,
        url: site.url,
      })),
    }))
    .sort((a, b) => b.score - a.score);

  const predictedColors: PredictedColor[] | undefined = raw.colors
    ?.map((c) => ({
      id: c.id,
      name: c.name,
      score: c.score,
    }))
    .sort((a, b) => b.score - a.score);

  const summary = buildSummary(matches, predictedColors);

  return {
    summary,
    listingId: raw.listing_id,
    boundingBox,
    matches,
    ...(predictedColors ? { predictedColors } : {}),
    ...(includeRaw ? { raw } : {}),
  };
}

function buildSummary(matches: Match[], colors?: PredictedColor[]): string {
  if (matches.length === 0) {
    return "No matches found.";
  }

  const top = matches[0];
  const score = (top.score * 100).toFixed(1);
  let summary = `Top match: ${top.name} (${top.type} ${top.id}) with score ${score}%. ${matches.length} total match${matches.length === 1 ? "" : "es"}.`;

  if (colors && colors.length > 0) {
    const colorStr = colors.map((c) => `${c.name} (${(c.score * 100).toFixed(1)}%)`).join(", ");
    summary += ` Predicted color: ${colorStr}.`;
  }

  return summary;
}
