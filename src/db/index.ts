import "server-only";

import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

import * as schema from "./schema";

/**
 * Postgres connection pool.
 *
 * A pool rather than a single connection because the product requirement is
 * that several recruiters work at once: SQLite served this app well as a
 * single-writer store, but "all updates must immediately appear for other
 * authorized users" needs concurrent writers and, later, LISTEN/NOTIFY.
 *
 * Next.js re-evaluates modules on hot reload, so the pool is cached on
 * globalThis to avoid leaking a new pool on every edit.
 */

const CONNECTION =
  process.env.DATABASE_URL ?? "postgres://rcc:rcc_local_dev@localhost:5433/rcc";

function createPool() {
  const pool = new Pool({
    connectionString: CONNECTION,
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  // A pool error would otherwise be an unhandled rejection and take the
  // process down; a dropped backend should just retire that client.
  pool.on("error", (error) => {
    console.error("[db] idle client error:", error.message);
  });

  return pool;
}

const globalForDb = globalThis as unknown as {
  __rccPool?: Pool;
};

const pool = globalForDb.__rccPool ?? createPool();
if (process.env.NODE_ENV !== "production") globalForDb.__rccPool = pool;

export const db = drizzle(pool, { schema });
export { pool, schema, CONNECTION };
