// Raw API response types (matching Brickognize OpenAPI spec)

export interface RawExternalSite {
  name: string;
  url: string;
}

export interface RawCandidateItem {
  id: string;
  name: string;
  img_url: string;
  external_sites: RawExternalSite[];
  category: string | null;
  type: "part" | "set" | "fig" | "sticker";
  score: number;
}

export interface RawBoundingBox {
  left: number;
  upper: number;
  right: number;
  lower: number;
  image_width: number;
  image_height: number;
  score: number;
}

export interface RawColorPrediction {
  id: string;
  name: string;
  score: number;
}

export interface RawSearchResults {
  listing_id: string;
  bounding_box: RawBoundingBox;
  items: RawCandidateItem[];
  colors?: RawColorPrediction[];
}

// Normalized output types

export interface ExternalSite {
  name: string;
  url: string;
}

export interface Match {
  id: string;
  name: string;
  type: "part" | "set" | "fig" | "sticker";
  category: string | null;
  score: number;
  imageUrl: string;
  externalSites: ExternalSite[];
}

export interface BoundingBox {
  left: number;
  upper: number;
  right: number;
  lower: number;
  imageWidth: number;
  imageHeight: number;
  score: number;
}

export interface PredictedColor {
  id: string;
  name: string;
  score: number;
}

export interface PredictionResult {
  summary: string;
  listingId: string;
  boundingBox: BoundingBox;
  matches: Match[];
  predictedColors?: PredictedColor[];
  raw?: RawSearchResults;
}

export type HealthResponse = Record<string, boolean>;
