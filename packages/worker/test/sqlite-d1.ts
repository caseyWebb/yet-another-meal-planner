// A REAL-SQLite D1 adapter for tests, backed by node:sqlite (Node 22's built-in engine). The
// hand-rolled fake-d1.ts is a SQL-regex simulator — sufficient for simple row writers, but it
// cannot execute the pull channel's atomic claim (a conditional `UPDATE … RETURNING` with a
// subquery, `attempts = attempts + 1`, and a partial-unique dedup index). So the queue tests run
// against a genuine SQLite with the ACTUAL migration DDL applied, exercising the real semantics
// (atomicity, lease expiry, scope/capability filtering, attempt-cap parking, idempotent enqueue).
//
// It implements exactly the D1 surface src/db.ts uses: prepare().bind(...).first()/all()/run()
// plus batch(). RETURNING rows come back through .all() (as in real D1).

import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Env } from "../src/env.js";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations", "d1");

/** node:sqlite rejects `undefined` binds — coerce them (and the ?? default) to null. */
function normBinds(binds: unknown[]): unknown[] {
  return binds.map((b) => (b === undefined ? null : b));
}

// D1 binds positionally (`.bind(v0, v1, …)`) but the codebase's SQL uses numbered `?N`
// placeholders. Node 22.17.1's node:sqlite rejects numbered `?N` when fed positional args
// ("column index out of range"); it only accepts them as a named-parameters object. Emulate
// D1's positional→numbered mapping (the i-th bind fills `?{i+1}`) so any numbered SQL — including
// reuse or gaps — binds correctly across Node 22.17.x/.22. An empty object is a valid no-param bind.
function asNamed(binds: unknown[]): Record<string, unknown> {
  const named: Record<string, unknown> = {};
  binds.forEach((v, i) => {
    named[String(i + 1)] = v;
  });
  return named;
}

function makeD1(raw: DatabaseSync): D1Database {
  const prepare = (sql: string): D1PreparedStatement => {
    let binds: unknown[] = [];
    const stmt = {
      bind(...v: unknown[]) {
        binds = normBinds(v);
        return stmt;
      },
      async first<T>() {
        const row = raw.prepare(sql).get(asNamed(binds));
        return (row ?? null) as T | null;
      },
      async all<T>() {
        const results = raw.prepare(sql).all(asNamed(binds)) as T[];
        return { results, success: true as const, meta: { changes: 0 } };
      },
      async run() {
        const res = raw.prepare(sql).run(asNamed(binds));
        return { success: true as const, meta: { changes: Number(res.changes) } };
      },
      __sql: () => sql,
      __binds: () => binds,
    };
    return stmt as unknown as D1PreparedStatement;
  };
  return {
    prepare: (sql: string) => prepare(sql),
    async batch(stmts: unknown[]) {
      raw.exec("BEGIN");
      try {
        const out: unknown[] = [];
        for (const s of stmts) {
          const stmt = s as { __sql: () => string; __binds: () => unknown[] };
          out.push(raw.prepare(stmt.__sql()).run(asNamed(stmt.__binds())));
        }
        raw.exec("COMMIT");
        return out;
      } catch (e) {
        raw.exec("ROLLBACK");
        throw e;
      }
    },
  } as unknown as D1Database;
}

/** An in-memory KVNamespace fake (fixed-window rate-limit + tenant directory tests). */
export function memKv(initial: Record<string, string> = {}): KVNamespace {
  const m = new Map(Object.entries(initial));
  return {
    async get(key: string) {
      return m.get(key) ?? null;
    },
    async put(key: string, value: string) {
      m.set(key, value);
    },
    async delete(key: string) {
      m.delete(key);
    },
    async list({ prefix = "", cursor }: { prefix?: string; cursor?: string } = {}) {
      void cursor;
      const keys = [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name }));
      return { keys, list_complete: true, cacheStatus: null };
    },
  } as unknown as KVNamespace;
}

export interface SqliteEnv {
  env: Env;
  raw: DatabaseSync;
  /** Read every row of a table (test-only inspection helper). */
  rows<T = Record<string, unknown>>(table: string): T[];
}

/**
 * A fully-migrated real-SQLite Env: applies every `migrations/d1/*.sql` (in order) to a fresh
 * in-memory database, then wraps it as `env.DB`. `KROGER_KV`/`TENANT_KV` are in-memory fakes.
 */
export function sqliteEnv(seedTenants: string[] = []): SqliteEnv {
  const raw = new DatabaseSync(":memory:");
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const f of files) raw.exec(readFileSync(join(MIGRATIONS_DIR, f), "utf8"));

  const tenantSeed: Record<string, string> = {};
  for (const id of seedTenants) tenantSeed[`tenant:${id}`] = JSON.stringify({ id });

  const env = {
    DB: makeD1(raw),
    KROGER_KV: memKv(),
    TENANT_KV: memKv(tenantSeed),
  } as unknown as Env;

  return {
    env,
    raw,
    rows<T = Record<string, unknown>>(table: string): T[] {
      return raw.prepare(`SELECT * FROM ${table}`).all() as T[];
    },
  };
}
