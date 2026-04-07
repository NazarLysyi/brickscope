import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform } from "node:os";

export interface BrickognizeConfig {
  rebrickableApiKey?: string;
  cache?: "none" | "memory" | "sqlite";
}

function getConfigDir(): string {
  if (platform() === "win32") {
    return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "brickscope");
  }
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "brickscope");
}

export function getConfigPath(): string {
  return join(getConfigDir(), "config.json");
}

export function loadConfig(): BrickognizeConfig {
  const configPath = getConfigPath();
  if (!existsSync(configPath)) return {};

  try {
    const raw = readFileSync(configPath, "utf-8");
    return JSON.parse(raw) as BrickognizeConfig;
  } catch {
    return {};
  }
}

export function saveConfig(config: BrickognizeConfig): void {
  const configDir = getConfigDir();
  mkdirSync(configDir, { recursive: true });
  writeFileSync(getConfigPath(), JSON.stringify(config, null, 2) + "\n", "utf-8");
}

/**
 * Resolve configuration with priority: env vars > config file.
 * Applies resolved values to process.env so downstream code works unchanged.
 */
export function applyConfig(): void {
  const config = loadConfig();

  if (!process.env.REBRICKABLE_API_KEY && config.rebrickableApiKey) {
    process.env.REBRICKABLE_API_KEY = config.rebrickableApiKey;
  }

  if (!process.env.BRICKOGNIZE_CACHE && config.cache) {
    process.env.BRICKOGNIZE_CACHE = config.cache;
  }
}
