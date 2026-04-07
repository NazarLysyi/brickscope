import { getMinifigDetails, getMinifigSets } from "./client.js";

export interface MinifigDetailsResult {
  minifig: {
    id: string;
    name: string;
    numParts: number;
    imageUrl: string | null;
    url: string;
  };
  appearsInSets: {
    setNum: string;
    setName: string;
    numParts: number;
    imageUrl: string | null;
    setUrl: string;
  }[];
}

export async function fetchMinifigDetails(minifigId: string): Promise<MinifigDetailsResult> {
  const minifig = await getMinifigDetails(minifigId);
  const sets = await getMinifigSets(minifigId);

  return {
    minifig: {
      id: minifig.set_num,
      name: minifig.name,
      numParts: minifig.num_parts,
      imageUrl: minifig.set_img_url,
      url: minifig.set_url,
    },
    appearsInSets: sets.map((s) => ({
      setNum: s.set_num,
      setName: s.name,
      numParts: s.num_parts,
      imageUrl: s.set_img_url,
      setUrl: s.set_url,
    })),
  };
}

export function buildMinifigSummary(result: MinifigDetailsResult): string {
  return (
    `Minifigure ${result.minifig.id}: ${result.minifig.name}. ` +
    `${result.minifig.numParts} parts. Appears in ${result.appearsInSets.length} set(s).`
  );
}
