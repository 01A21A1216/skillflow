import "server-only";

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import * as schema from "./schema";

const DB_DIR = path.join(process.cwd(), "data");
const DB_PATH = process.env.DATABASE_PATH ?? path.join(DB_DIR, "rcc.db");
const MIGRATIONS_DIR = path.join(process.cwd(), "drizzle");

function createConnection() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");

  const db = drizzle(sqlite, { schema });

  if (fs.existsSync(MIGRATIONS_DIR)) {
    migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  }

  return { sqlite, db };
}

/**
 * Next.js dev mode re-evaluates modules on every hot reload. Cache the
 * connection on globalThis so we keep exactly one SQLite handle per process.
 */
const globalForDb = globalThis as unknown as {
  __rccDb?: ReturnType<typeof createConnection>;
};

const connection = globalForDb.__rccDb ?? createConnection();
if (process.env.NODE_ENV !== "production") globalForDb.__rccDb = connection;

export const db = connection.db;
export const sqlite = connection.sqlite;
export { schema };
