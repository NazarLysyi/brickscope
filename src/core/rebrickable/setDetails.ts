import { getSetDetails, getSetParts } from "./client.js";

export function normalizeSetNum(setId: string): string {
  // Rebrickable expects set numbers with a "-1" suffix (e.g. "75192-1")
  if (!/-\d+$/.test(setId)) {
    return `${setId}-1`;
  }
  return setId;
}

export interface SetDetailsResult {
  set: {
    setNum: string;
    name: string;
    year: number;
    themeId: number;
    numParts: number;
    imageUrl: string | null;
    url: string;
  };
  parts: {
    partNum: string;
    name: string;
    color: string;
    colorRgb: string;
    quantity: number;
    numSets: number;
    imageUrl: string | null;
    elementId: string | null;
  }[];
  spareParts: {
    partNum: string;
    name: string;
    color: string;
    quantity: number;
  }[];
}

export async function fetchSetDetails(setId: string): Promise<SetDetailsResult> {
  const setNum = normalizeSetNum(setId);
  const set = await getSetDetails(setNum);
  const parts = await getSetParts(setNum);

  const regularParts = parts.filter((p) => !p.is_spare);
  const spareParts = parts.filter((p) => p.is_spare);

  return {
    set: {
      setNum: set.set_num,
      name: set.name,
      year: set.year,
      themeId: set.theme_id,
      numParts: set.num_parts,
      imageUrl: set.set_img_url,
      url: set.set_url,
    },
    parts: regularParts.map((p) => ({
      partNum: p.part.part_num,
      name: p.part.name,
      color: p.color.name,
      colorRgb: p.color.rgb,
      quantity: p.quantity,
      numSets: p.num_sets,
      imageUrl: p.part.part_img_url,
      elementId: p.element_id,
    })),
    spareParts: spareParts.map((p) => ({
      partNum: p.part.part_num,
      name: p.part.name,
      color: p.color.name,
      quantity: p.quantity,
    })),
  };
}

export function buildSetSummary(result: SetDetailsResult): string {
  return (
    `Set ${result.set.setNum}: ${result.set.name} (${result.set.year}). ` +
    `${result.set.numParts} pieces, ${result.parts.length} unique parts, ${result.spareParts.length} spare parts.`
  );
}
