import type { RawSearchResults, PredictionResult, Match, BoundingBox } from "./types.js";

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

  const summary = buildSummary(matches);

  return {
    summary,
    listingId: raw.listing_id,
    boundingBox,
    matches,
    ...(includeRaw ? { raw } : {}),
  };
}

function buildSummary(matches: Match[]): string {
  if (matches.length === 0) {
    return "No matches found.";
  }

  const top = matches[0];
  const score = (top.score * 100).toFixed(1);
  return `Top match: ${top.name} (${top.type} ${top.id}) with score ${score}%. ${matches.length} total match${matches.length === 1 ? "" : "es"}.`;
}
