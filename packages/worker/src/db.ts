// D1 data-access layer (cloudflare-data-platform). The single place the Worker
// touches D1: tools NEVER reference `env.DB` directly — they go through `db(env)`,
// which owns prepared statements, the batch/transaction helper, and error mapping.
// Keeping the SQL surface here makes it one reviewable place and lets the binding be
// renamed or sharded later without touching tools.
//
// Per the repo's "tools return structured errors, not throws" rule (D4), every D1
// failure (constraint violation, malformed SQL, an unreachable/unprovisioned db) is
// mapped to a `ToolError` with the `storage_error` code; no raw D1 exception ever
// escapes to the tool surface. The layer stays THIN — prepared-statement ergonomics,
// not a query builder / ORM.
//
// Upsert idiom: D1 has no bespoke upsert helper here (kept thin until a slice needs
// one). Common upserts (pantry, staples, brand prefs, overlay) use SQLite's native
// `INSERT … ON CONFLICT(<pk>) DO UPDATE SET col = excluded.col`, run through `run`:
//
//   await db(env).run(
//     "INSERT INTO pantry (tenant, item, qty) VALUES (?1, ?2, ?3) " +
//       "ON CONFLICT(tenant, item) DO UPDATE SET qty = excluded.qty",
//     tenant, item, qty,
//   );

import type { Env } from "./env.js";
import { ToolError } from "./errors.js";

/** The result of a write: rows affected, mirroring D1's `meta.changes`. */
export interface RunResult {
  changes: number;
}

/** The thin D1 surface tools use. All methods reject with a `storage_error` ToolError on D1 failure. */
export interface Db {
  /** First row of a query (or null when empty). `binds` are positional (`?1`, `?2`, …). */
  first<T = Record<string, unknown>>(sql: string, ...binds: unknown[]): Promise<T | null>;
  /** All rows of a query. `binds` are positional. */
  all<T = Record<string, unknown>>(sql: string, ...binds: unknown[]): Promise<T[]>;
  /** Run a write (INSERT/UPDATE/DELETE/DDL); returns the affected-row count. */
  run(sql: string, ...binds: unknown[]): Promise<RunResult>;
  /**
   * Run prepared statements as one D1 transaction (all-or-nothing; D1's `batch`).
   * Build statements with `db(env).prepare(sql, ...binds)`; the array runs in order.
   */
  batch(stmts: D1PreparedStatement[]): Promise<void>;
  /** Prepare + bind a statement for `batch`. Does not execute. */
  prepare(sql: string, ...binds: unknown[]): D1PreparedStatement;
}

/**
 * Turn any D1 failure into a structured `storage_error` ToolError, preserving the
 * SQL for debugging (it carries no tenant data — values are bound, not interpolated).
 * Never re-throws a raw exception.
 */
function asStorageError(op: string, sql: string, cause: unknown): ToolError {
  const message = cause instanceof Error ? cause.message : String(cause);
  return new ToolError("storage_error", `D1 ${op} failed: ${message}`, { sql });
}

/**
 * The D1 data-access layer bound to an Env. Cheap to construct per call (just closes
 * over `env.DB`), so tools call `db(env)` inline rather than threading an instance.
 */
export function db(env: Env): Db {
  const D1 = env.DB;
  const prepare = (sql: string, ...binds: unknown[]): D1PreparedStatement => {
    const stmt = D1.prepare(sql);
    return binds.length ? stmt.bind(...binds) : stmt;
  };

  return {
    prepare,

    async first<T = Record<string, unknown>>(sql: string, ...binds: unknown[]): Promise<T | null> {
      try {
        return await prepare(sql, ...binds).first<T>();
      } catch (e) {
        throw asStorageError("query", sql, e);
      }
    },

    async all<T = Record<string, unknown>>(sql: string, ...binds: unknown[]): Promise<T[]> {
      try {
        const res = await prepare(sql, ...binds).all<T>();
        return res.results;
      } catch (e) {
        throw asStorageError("query", sql, e);
      }
    },

    async run(sql: string, ...binds: unknown[]): Promise<RunResult> {
      try {
        const res = await prepare(sql, ...binds).run();
        return { changes: res.meta.changes };
      } catch (e) {
        throw asStorageError("run", sql, e);
      }
    },

    async batch(stmts: D1PreparedStatement[]): Promise<void> {
      try {
        await D1.batch(stmts);
      } catch (e) {
        throw asStorageError("batch", "<batch>", e);
      }
    },
  };
}

export interface InstacartLinkRow {
  tenant: string;
  content_hash: string;
  url: string;
  expires_at: string;
  created_at: string;
}

export function readInstacartLink(env: Env, tenant: string, contentHash: string): Promise<InstacartLinkRow | null> {
  return db(env).first<InstacartLinkRow>(
    "SELECT tenant, content_hash, url, expires_at, created_at FROM instacart_links WHERE tenant = ?1 AND content_hash = ?2",
    tenant, contentHash,
  );
}

export async function upsertInstacartLink(env: Env, row: InstacartLinkRow): Promise<void> {
  await db(env).run(
    "INSERT INTO instacart_links (tenant, content_hash, url, expires_at, created_at) VALUES (?1, ?2, ?3, ?4, ?5) " +
      "ON CONFLICT(tenant, content_hash) DO UPDATE SET url = excluded.url, expires_at = excluded.expires_at, created_at = excluded.created_at",
    row.tenant, row.content_hash, row.url, row.expires_at, row.created_at,
  );
}

export async function deleteExpiredInstacartLinks(env: Env, tenant: string, before: string): Promise<void> {
  await db(env).run("DELETE FROM instacart_links WHERE tenant = ?1 AND expires_at <= ?2", tenant, before);
}
