import type { PredictionResult } from "../core/brickognize/types.js";
import type { PartDetailsResult } from "../core/rebrickable/partDetails.js";
import type { SetDetailsResult } from "../core/rebrickable/setDetails.js";
import type { MinifigDetailsResult } from "../core/rebrickable/minifigDetails.js";
import type { ScanResult } from "../core/scan/types.js";

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

export function formatScan(
  result: ScanResult,
  files: { annotated: string | null; crops: string | null; regions: string | null },
): string {
  const lines: string[] = [result.summary, ""];
  const settings = result.detectionSettings;
  if (settings) {
    lines.push(
      `Detection: min contrast ${settings.minContrast}, min part size ${settings.minPartSize}%, join gap ${settings.joinGap}%`,
      "",
    );
  }

  for (const region of result.regions) {
    const label = `  #${region.id}`;
    const top = region.matches?.[0];
    if (!region.status) {
      lines.push(`${label}  [${region.box.join(", ")}]`);
    } else if (region.status === "success" && top) {
      const color = region.colors?.[0]?.name;
      const score = (top.score * 100).toFixed(1);
      lines.push(`${label}  ${top.id}  ${top.name}${color ? ` [${color}]` : ""}  ${score}%`);
    } else if (region.status === "no_match") {
      lines.push(`${label}  no match`);
    } else {
      lines.push(`${label}  error: ${region.error}`);
    }
  }

  if (result.groups && result.groups.length > 0) {
    lines.push("", "Parts (provisional):");
    for (const group of result.groups) {
      const color = group.colorName ? ` [${group.colorName}]` : "";
      lines.push(`  ${group.count}x ${group.partId}  ${group.name}${color}`);
    }
  }

  if (result.warnings.length > 0) {
    lines.push("", "Warnings:");
    for (const warning of result.warnings) {
      lines.push(`  ${warning.code}: ${warning.message}`);
    }
  }

  if (result.tips && result.tips.length > 0) {
    lines.push("", "Tips for the next photo:");
    for (const tip of result.tips) {
      lines.push(`  - ${tip.message}`);
    }
  }

  const written = [
    ["Annotated", files.annotated],
    ["Crops", files.crops],
    ["Regions", files.regions],
  ].filter((entry): entry is [string, string] => entry[1] !== null);
  if (written.length > 0) {
    lines.push("", "Files:");
    for (const [label, path] of written) {
      lines.push(`  ${`${label}:`.padEnd(10)} ${path}`);
    }
  }

  return lines.join("\n");
}
