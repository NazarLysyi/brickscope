// Rebrickable API v3 response types

export interface RebrickablePage<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface RebrickablePart {
  part_num: string;
  name: string;
  part_cat_id: number;
  year_from: number | null;
  year_to: number | null;
  part_url: string;
  part_img_url: string | null;
  external_ids: Record<string, string[]>;
  prints: string[];
  molds: string[];
  alternates: string[];
  print_of: string | null;
}

export interface RebrickablePartColor {
  color_id: number;
  color_name: string;
  num_sets: number;
  num_set_parts: number;
  part_img_url: string | null;
  elements: string[];
}

export interface RebrickableSet {
  set_num: string;
  name: string;
  year: number;
  theme_id: number;
  num_parts: number;
  set_img_url: string | null;
  set_url: string;
  last_modified_dt: string;
}

// /parts/{id}/colors/{colorId}/sets/ returns the same shape as a full set
export type RebrickableSetReference = RebrickableSet;

export interface RebrickableSetPart {
  id: number;
  inv_part_id: number;
  part: {
    part_num: string;
    name: string;
    part_cat_id: number;
    year_from: number | null;
    year_to: number | null;
    part_url: string;
    part_img_url: string | null;
    external_ids: Record<string, string[]>;
    prints: string[];
    molds: string[];
    alternates: string[];
    print_of: string | null;
  };
  color: {
    id: number;
    name: string;
    rgb: string;
    is_trans: boolean;
    external_ids?: Record<string, unknown>;
  };
  num_sets: number;
  quantity: number;
  is_spare: boolean;
  set_num: string;
  element_id: string | null;
}

export interface RebrickableMinifig {
  set_num: string;
  name: string;
  num_parts: number;
  set_img_url: string | null;
  set_url: string;
  last_modified_dt: string;
}

// /minifigs/{id}/sets/ returns the same shape as a minifig entry
export type RebrickableMinifigSet = RebrickableMinifig;
