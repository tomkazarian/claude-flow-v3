import Database from "better-sqlite3";
import { drizzle, BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { resolve } from "node:path";
import { mkdirSync, existsSync } from "node:fs";
import * as schema from "./schema.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DEFAULT_DB_PATH = resolve(
  process.env["SWEEPS_DB_PATH"] ?? "./data/sweepstakes.db",
);
const BUSY_TIMEOUT_MS = 5_000;

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _db: BetterSQLite3Database<typeof schema> | undefined;
let _sqlite: Database.Database | undefined;

/**
 * Returns the Drizzle ORM database instance backed by better-sqlite3.
 * Lazily creates and configures the connection on first call.
 *
 * Configuration:
 * - WAL journal mode for concurrent read performance
 * - busy_timeout to avoid SQLITE_BUSY under contention
 * - foreign_keys enforcement enabled
 */
export function getDb(
  dbPath: string = DEFAULT_DB_PATH,
): BetterSQLite3Database<typeof schema> {
  if (_db) return _db;

  // Ensure the directory exists
  const dir = resolve(dbPath, "..");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  _sqlite = new Database(dbPath);

  // Performance & safety pragmas
  _sqlite.pragma("journal_mode = WAL");
  _sqlite.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);
  _sqlite.pragma("foreign_keys = ON");
  _sqlite.pragma("synchronous = NORMAL");

  _db = drizzle(_sqlite, { schema });

  return _db;
}

/**
 * Returns the raw better-sqlite3 instance.
 * Useful for migrations and raw SQL operations.
 * Calls getDb() first to ensure initialization.
 */
export function getSqlite(dbPath?: string): Database.Database {
  if (!_sqlite) {
    getDb(dbPath);
  }
  return _sqlite!;
}

/**
 * Closes the database connection and resets the singleton.
 * Safe to call multiple times.
 */
export function closeDb(): void {
  if (_sqlite) {
    _sqlite.close();
    _sqlite = undefined;
    _db = undefined;
  }
}

// Re-export schema for convenience
export { schema };
export type AppDatabase = BetterSQLite3Database<typeof schema>;
