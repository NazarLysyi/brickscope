import type { PredictionResult } from "../core/brickognize/types.js";
import type { PartDetailsResult } from "../core/rebrickable/partDetails.js";
import type { SetDetailsResult } from "../core/rebrickable/setDetails.js";
import type { MinifigDetailsResult } from "../core/rebrickable/minifigDetails.js";

export function formatPrediction(result: PredictionResult): string {
  const lines: string[] = [];

  if (result.matches.length === 0) {
    lines.push("No matches found.");
    return lines.join("\n");
  }

  for (const match of result.matches) {
    const score = (match.score * 100).toFixed(1);
    lines.push(`  ${match.id}  ${match.name}  (${match.type}, ${score}%)`);
    for (const site of match.externalSites) {
      lines.push(`    ${site.name}: ${site.url}`);
    }
  }

  if (result.predictedColors && result.predictedColors.length > 0) {
    lines.push("");
    lines.push("Predicted colors:");
    for (const color of result.predictedColors) {
      lines.push(`  ${color.name} (${(color.score * 100).toFixed(1)}%)`);
    }
  }

  return lines.join("\n");
}

export function formatPartDetails(result: PartDetailsResult): string {
  const lines: string[] = [];

  lines.push(`Part ${result.part.partNum}: ${result.part.name}`);
  lines.push(`  URL: ${result.part.url}`);
  lines.push(`  Colors: ${result.totalColors}, Set appearances: ~${result.totalSetsAppearances}`);

  if (result.colorFilter) {
    if (result.colorMatched) {
      lines.push(`  Filtered by color: "${result.colorFilter}"`);
    } else {
      lines.push(`  Color "${result.colorFilter}" not found, showing top 5 colors`);
    }
  }

  lines.push("");

  for (const color of result.colorDetails) {
    lines.push(`  ${color.colorName} (${color.numSets} sets):`);
    for (const set of color.sets.slice(0, 10)) {
      lines.push(`    ${set.setNum}  ${set.setName} (${set.year}, ${set.numParts} pcs)`);
    }
    if (color.sets.length > 10) {
      lines.push(`    ... and ${color.sets.length - 10} more`);
    }
  }

  return lines.join("\n");
}

export function formatSetDetails(result: SetDetailsResult): string {
  const lines: string[] = [];

  lines.push(`Set ${result.set.setNum}: ${result.set.name} (${result.set.year})`);
  lines.push(
    `  Pieces: ${result.set.numParts}, Unique parts: ${result.parts.length}, Spare: ${result.spareParts.length}`,
  );
  lines.push(`  URL: ${result.set.url}`);
  lines.push("");
  lines.push("Parts:");

  for (const part of result.parts) {
    lines.push(`  ${part.quantity}x ${part.partNum}  ${part.name} [${part.color}]`);
  }

  if (result.spareParts.length > 0) {
    lines.push("");
    lines.push("Spare parts:");
    for (const part of result.spareParts) {
      lines.push(`  ${part.quantity}x ${part.partNum}  ${part.name} [${part.color}]`);
    }
  }

  return lines.join("\n");
}

export function formatMinifigDetails(result: MinifigDetailsResult): string {
  const lines: string[] = [];

  lines.push(`Minifigure ${result.minifig.id}: ${result.minifig.name}`);
  lines.push(`  Parts: ${result.minifig.numParts}`);
  lines.push(`  URL: ${result.minifig.url}`);
  lines.push("");

  if (result.appearsInSets.length > 0) {
    lines.push(`Appears in ${result.appearsInSets.length} set(s):`);
    for (const set of result.appearsInSets) {
      lines.push(`  ${set.setNum}  ${set.setName} (${set.numParts} pcs)`);
    }
  } else {
    lines.push("Does not appear in any sets.");
  }

  return lines.join("\n");
}
