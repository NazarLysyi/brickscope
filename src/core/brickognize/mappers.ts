import type {
  RawSearchResults,
  PredictionResult,
  PredictedColor,
  Match,
  BoundingBox,
} from "./types.js";

export function mapPredictionResult(raw: RawSearchResults, includeRaw: boolean): PredictionResult {
  const boundingBox: BoundingBox = {
    left: raw.bounding_box.left,
    upper: raw.bounding_box.upper,
    right: raw.bounding_box.right,
    lower: raw.bounding_box.lower,
    imageWidth: raw.bounding_box.image_width,
    imageHeight: raw.bounding_box.image_height,
    score: raw.bounding_box.score,
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

  const predictedColors: PredictedColor[] | undefined = raw.colors?.map((c) => ({
    id: c.id,
    name: c.name,
    score: c.score,
  }));

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
