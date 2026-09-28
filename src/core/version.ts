import { readFileSync } from "node:fs";

// Resolves to the package root from both src/core and dist/core
const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
  version: string;
};

export const VERSION = pkg.version;
