import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import type { CacheBackend } from "./types.js";

interface CacheRow {
  value: string;
}

export class SqliteCache implements CacheBackend {
  readonly db: Database.Database;
  private readonly selectStmt: Database.Statement<[string], CacheRow>;
  private readonly upsertStmt: Database.Statement<[string, string]>;
  private readonly clearStmt: Database.Statement;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cache (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    this.selectStmt = this.db.prepare<[string], CacheRow>("SELECT value FROM cache WHERE key = ?");
    this.upsertStmt = this.db.prepare<[string, string]>(
      "INSERT OR REPLACE INTO cache (key, value) VALUES (?, ?)",
    );
    this.clearStmt = this.db.prepare("DELETE FROM cache");
  }

  get(key: string): string | null {
    const row = this.selectStmt.get(key);
    return row?.value ?? null;
  }

  set(key: string, value: string): void {
    this.upsertStmt.run(key, value);
  }

  clear(): number {
    return this.clearStmt.run().changes;
  }
}
