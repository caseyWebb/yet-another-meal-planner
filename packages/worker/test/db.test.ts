import { describe, it, expect } from "vitest";
import { db } from "../src/db.js";
import { ToolError } from "../src/errors.js";
import type { Env } from "../src/env.js";

// The vitest harness runs in the default node environment (no workerd/miniflare
// pool), so there is no real D1 binding to bind here. We exercise the wrapper's
// contract — bind threading, result shaping, and the structured-error mapping — against
// a hand-rolled fake `D1Database` that mirrors the workers-types surface db.ts uses.
// A live D1 round-trip (the SQL itself) is verified by the deploy-time `wrangler d1
// migrations apply` + `/health` probe, not in unit tests.

type FakeStmt = {
  bind: (...values: unknown[]) => FakeStmt;
  first: <T>() => Promise<T | null>;
  all: <T>() => Promise<{ results: T[]; success: true; meta: { changes: number } }>;
  run: () => Promise<{ success: true; meta: { changes: number } }>;
  __sql: string;
  __binds: unknown[];
};

interface FakeD1 {
  db: D1Database;
  calls: { sql: string; binds: unknown[] }[];
  batched: D1PreparedStatement[][];
}

// `behaviour` lets a test make a given op throw (to assert error mapping) or return
// a chosen row set / change count.
function fakeD1(behaviour: {
  firstRow?: unknown;
  rows?: unknown[];
  changes?: number;
  throwOn?: "first" | "all" | "run" | "batch";
} = {}): FakeD1 {
  const calls: { sql: string; binds: unknown[] }[] = [];
  const batched: D1PreparedStatement[][] = [];
  const boom = () => {
    throw new Error("constraint failed: UNIQUE");
  };

  const makeStmt = (sql: string): FakeStmt => {
    const stmt: FakeStmt = {
      __sql: sql,
      __binds: [],
      bind(...values: unknown[]) {
        stmt.__binds = values;
        return stmt;
      },
      async first<T>() {
        calls.push({ sql, binds: stmt.__binds });
        if (behaviour.throwOn === "first") boom();
        return (behaviour.firstRow ?? null) as T | null;
      },
      async all<T>() {
        calls.push({ sql, binds: stmt.__binds });
        if (behaviour.throwOn === "all") boom();
        return { results: (behaviour.rows ?? []) as T[], success: true as const, meta: { changes: 0 } };
      },
      async run() {
        calls.push({ sql, binds: stmt.__binds });
        if (behaviour.throwOn === "run") boom();
        return { success: true as const, meta: { changes: behaviour.changes ?? 0 } };
      },
    };
    return stmt;
  };

  const database = {
    prepare: (sql: string) => makeStmt(sql) as unknown as D1PreparedStatement,
    async batch(statements: D1PreparedStatement[]) {
      batched.push(statements);
      if (behaviour.throwOn === "batch") boom();
      return [];
    },
  } as unknown as D1Database;

  return { db: database, calls, batched };
}

const env = (d1: D1Database): Env => ({ DB: d1 }) as unknown as Env;

describe("db() data-access layer", () => {
  it("first returns the row and threads positional binds", async () => {
    const f = fakeD1({ firstRow: { ok: 1 } });
    const row = await db(env(f.db)).first<{ ok: number }>("SELECT 1 AS ok WHERE x = ?1", "v");
    expect(row).toEqual({ ok: 1 });
    expect(f.calls).toEqual([{ sql: "SELECT 1 AS ok WHERE x = ?1", binds: ["v"] }]);
  });

  it("first returns null on an empty result", async () => {
    const f = fakeD1({ firstRow: null });
    expect(await db(env(f.db)).first("SELECT 1")).toBeNull();
  });

  it("all unwraps the results array", async () => {
    const f = fakeD1({ rows: [{ a: 1 }, { a: 2 }] });
    expect(await db(env(f.db)).all<{ a: number }>("SELECT a FROM t")).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("run reports the affected-row count from meta.changes", async () => {
    const f = fakeD1({ changes: 3 });
    expect(await db(env(f.db)).run("DELETE FROM t WHERE a > ?1", 0)).toEqual({ changes: 3 });
  });

  it("batch runs prepared statements as one transaction", async () => {
    const f = fakeD1();
    const d = db(env(f.db));
    await d.batch([d.prepare("INSERT INTO t VALUES (?1)", 1), d.prepare("INSERT INTO t VALUES (?1)", 2)]);
    expect(f.batched).toHaveLength(1);
    expect(f.batched[0]).toHaveLength(2);
  });

  it("prepare binds only when binds are supplied (id-less statement stays unbound)", async () => {
    const f = fakeD1();
    const stmt = db(env(f.db)).prepare("SELECT 1") as unknown as FakeStmt;
    expect(stmt.__binds).toEqual([]);
  });

  for (const op of ["first", "all", "run"] as const) {
    it(`${op} maps a D1 failure to a storage_error ToolError (no raw throw)`, async () => {
      const f = fakeD1({ throwOn: op });
      const d = db(env(f.db));
      const call =
        op === "first" ? d.first("SELECT 1") : op === "all" ? d.all("SELECT 1") : d.run("DELETE FROM t");
      await expect(call).rejects.toMatchObject({
        name: "ToolError",
        code: "storage_error",
        context: { sql: op === "run" ? "DELETE FROM t" : "SELECT 1" },
      });
      await expect(call).rejects.toBeInstanceOf(ToolError);
    });
  }

  it("batch maps a D1 failure to a storage_error ToolError", async () => {
    const f = fakeD1({ throwOn: "batch" });
    const d = db(env(f.db));
    await expect(d.batch([d.prepare("INSERT INTO t VALUES (1)")])).rejects.toMatchObject({
      name: "ToolError",
      code: "storage_error",
    });
  });
});
