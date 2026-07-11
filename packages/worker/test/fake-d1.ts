// A small in-memory D1 fake. Originally for the session-state tables (pantry,
// meal_plan, grocery_list) plus the recipes resolution SELECT used by log_cooked; now
// also the shared-corpus tables (aliases, feeds, discovery_*, flyer_terms, sku_cache,
// discovery_candidates, stores, store_notes, recipe_notes) the d1-shared-corpus slice
// added. It routes by SQL: SELECT/DELETE/INSERT with ON CONFLICT / INSERT OR IGNORE
// upserts keyed by each table's primary key, the tenant-scoped WHERE filters the
// session/profile tools rely on, and a handful of shared-corpus WHERE clauses
// (recipe/store/url equality). Enough fidelity to exercise the row writers' SQL/bind
// contract without a live D1.

import type { Env } from "../src/env.js";

export interface FakeD1 {
  env: Env;
  tables: Record<string, Record<string, unknown>[]>;
  /** Recorded batch invocations (each a list of executed {sql, binds}). */
  batches: { sql: string; binds: unknown[] }[][];
}

const PK: Record<string, string[]> = {
  pantry: ["tenant", "normalized_name"],
  waste_events: ["tenant", "id"],
  meal_plan: ["tenant", "recipe"],
  grocery_list: ["tenant", "normalized_name"],
  cooking_log: ["id"],
  tenant_activity: ["tenant"],
  // shared-corpus (d1-shared-corpus)
  ingredient_identity: ["id"],
  ingredient_alias: ["variant"],
  ingredient_edge: ["from_id", "to_id", "kind"],
  novel_ingredient_terms: ["term"],
  ingredient_normalization_log: ["id"],
  ingredient_coresolution_rejection: ["a", "b"],
  feeds: ["url"],
  discovery_members: ["address"],
  discovery_senders: ["address"],
  flyer_terms: ["term"],
  sku_cache: ["ingredient", "location_id"],
  discovery_candidates: ["id"],
  stores: ["slug"],
  store_notes: ["id"],
  recipe_notes: ["id"],
  bug_reports: ["id"],
  job_health: ["name"],
  job_runs: ["id"],
  night_vibes: ["tenant", "id"],
  night_vibe_derived: ["tenant", "id"],
  vibe_satisfaction: ["tenant", "cooking_log_id", "vibe_id"],
  pending_proposals: ["tenant", "id"],
  webauthn_credentials: ["credential_id"],
  // walled-source ingest (recipe-ingestion)
  ingest_keys: ["id"],
  ingest_candidates: ["id"],
  ingest_pushes: ["id"],
};

// Tables whose `id` PK is AUTOINCREMENT: an INSERT that omits `id` gets the next one,
// so successive inserts don't collide on an undefined id (mirrors SQLite autoincrement).
const AUTOINCREMENT_TABLES = new Set(["bug_reports", "ingredient_normalization_log", "cooking_log"]);

// Shared-corpus tables have no `tenant` column — SELECT/DELETE over them are global,
// filtered only by explicit WHERE equality clauses below.
const GLOBAL_TABLES = new Set([
  "ingredient_identity",
  "ingredient_alias",
  "ingredient_edge",
  "novel_ingredient_terms",
  "ingredient_normalization_log",
  "ingredient_coresolution_rejection",
  "feeds",
  "discovery_members",
  "discovery_senders",
  "flyer_terms",
  "sku_cache",
  "discovery_candidates",
  "stores",
  "store_notes",
  "recipe_notes",
  "bug_reports",
  "ingest_keys",
  "ingest_candidates",
  "ingest_pushes",
  "job_runs",
]);

export function fakeD1(
  init: { tables?: Record<string, Record<string, unknown>[]>; recipes?: string[] } = {},
): FakeD1 {
  const tables: Record<string, Record<string, unknown>[]> = {
    pantry: [],
    waste_events: [],
    meal_plan: [],
    grocery_list: [],
    job_health: [],
    ...(init.tables ?? {}),
  };
  const known = new Set(init.recipes ?? []);
  const batches: { sql: string; binds: unknown[] }[][] = [];

  const tableOf = (sql: string): string | null => {
    const m = /(?:FROM|INTO|UPDATE)\s+(\w+)/i.exec(sql);
    return m ? m[1] : null;
  };

  // Apply the WHERE-equality filters the corpus/session reads use. Each maps a column
  // to the positional bind it compares against (?N). Unrecognized clauses are ignored.
  const applyWhere = (sql: string, binds: unknown[], rows: Record<string, unknown>[]): Record<string, unknown>[] => {
    let out = rows;
    const eq = (col: string, n: number) => {
      out = out.filter((r) => r[col] === binds[n - 1]);
    };
    if (/category = \?2/i.test(sql)) eq("category", 2);
    if (/\blocation = \?2/i.test(sql)) eq("location", 2);
    if (/\blocation = \?3/i.test(sql)) eq("location", 3);
    if (/prepared_from IS NOT NULL/i.test(sql)) out = out.filter((r) => r.prepared_from != null);
    // Pending-classification scans (ingredient-category phases 2/3).
    if (/\bcategory IS NULL/i.test(sql)) out = out.filter((r) => r.category == null);
    if (/\bdepartment IS NULL/i.test(sql)) out = out.filter((r) => r.department == null);
    if (/status = \?2/i.test(sql)) eq("status", 2);
    if (/\brecipe = \?1/i.test(sql)) eq("recipe", 1);
    if (/\brecipe = \?2/i.test(sql)) eq("recipe", 2);
    if (/LOWER\(recipe\) = LOWER\(\?2\)/i.test(sql)) {
      out = out.filter((r) => String(r.recipe).toLowerCase() === String(binds[1]).toLowerCase());
    }
    if (/\bstore = \?1/i.test(sql)) eq("store", 1);
    if (/\bslug = \?1/i.test(sql)) eq("slug", 1);
    if (/credential_id = \?1/i.test(sql)) eq("credential_id", 1);
    if (/key_hash = \?1/i.test(sql)) eq("key_hash", 1);
    if (/status = 'active'/i.test(sql)) out = out.filter((r) => r.status === "active");
    if (/\blocation_id = \?1/i.test(sql)) eq("location_id", 1);
    if (/\bname = \?1/i.test(sql)) eq("name", 1);
    // Re-confirm eligibility (literal predicates on ingredient_identity, no positional binds).
    if (/source = 'auto'/i.test(sql)) out = out.filter((r) => r.source === "auto");
    if (/concrete = 1/i.test(sql)) out = out.filter((r) => r.concrete === 1);
    // Concept-node set (readConceptIds): literal concrete = 0 — a NULL concrete is not 0 in SQL.
    if (/concrete = 0/i.test(sql)) out = out.filter((r) => r.concrete === 0);
    if (/representative IS NULL/i.test(sql)) out = out.filter((r) => r.representative == null);
    // Embedding-backfill batch (embedding IS NOT NULL never reaches the fake; IS NULL does).
    if (/embedding IS NULL/i.test(sql)) out = out.filter((r) => r.embedding == null);
    if (/reconfirmed_at IS NULL/i.test(sql)) out = out.filter((r) => r.reconfirmed_at == null);
    // Re-audit eligibility (alias/edge backlog: un-stamped rows only).
    if (/audited_at IS NULL/i.test(sql)) out = out.filter((r) => r.audited_at == null);
    // Substitution edges are excluded from the factual/edge-audit `ingredient_edge` reads
    // (converge-meal-planning-surfaces): the `kind != 'substitution'` literal on those SELECTs.
    if (/kind\s*(?:!=|<>)\s*'substitution'/i.test(sql)) out = out.filter((r) => r.kind !== "substitution");
    // Edge-drop replay selection (normalization-audit-calibration).
    if (/\boutcome = \?1/i.test(sql)) eq("outcome", 1);
    // The unreplayed-drop gauge probe (audit-admin): the SQL mirror of the replay mark —
    // keep rows whose detail is NULL, un-parseable, non-object, or carries no non-null
    // `replayed_at` (matches `detail IS NULL OR NOT json_valid(detail) OR
    // json_extract(detail, '$.replayed_at') IS NULL`).
    if (/json_extract\(detail, '\$\.replayed_at'\) IS NULL/i.test(sql)) {
      out = out.filter((r) => {
        const d = r.detail;
        if (typeof d !== "string" || !d) return true;
        try {
          const v = JSON.parse(d) as unknown;
          if (!v || typeof v !== "object" || Array.isArray(v)) return true;
          const mark = (v as Record<string, unknown>).replayed_at;
          return mark === undefined || mark === null;
        } catch {
          return true;
        }
      });
    }
    // The admin edge-decision stream (audit-admin): literal outcome IN ('a', 'b', …).
    const outcomeIn = /\boutcome IN \(([^)]+)\)/i.exec(sql);
    if (outcomeIn) {
      const values = [...outcomeIn[1].matchAll(/'([^']*)'/g)].map((x) => x[1]);
      out = out.filter((r) => values.includes(String(r.outcome)));
    }
    // Per-job run-history reads (readJobRuns).
    if (/\bjob = \?1/i.test(sql)) eq("job", 1);
    if (/normalized_name = \?2/i.test(sql)) eq("normalized_name", 2);
    // A member-scoped read keyed on something else first (getProposal: id = ?1 AND tenant = ?2).
    if (/\btenant = \?2/i.test(sql)) eq("tenant", 2);
    // The cooking-log dedupe probe (logCooked opts.dedupe) + the tenant-scoped delete-by-id.
    if (/\bdate = \?2/i.test(sql)) eq("date", 2);
    if (/\btype = \?3/i.test(sql)) eq("type", 3);
    if (/\brecipe = \?4/i.test(sql)) eq("recipe", 4);
    if (/\bname = \?4/i.test(sql)) eq("name", 4);
    if (/\bid = \?2/i.test(sql)) eq("id", 2);
    // Attributed notes: privacy rule (private=0 OR author=?2), and self-scoped
    // findOwnNote (author=?2 AND created_at=?3).
    if (/\(private = 0 OR author = \?2\)/i.test(sql)) {
      out = out.filter((r) => r.private === 0 || r.author === binds[1]);
    } else if (/\bauthor = \?2/i.test(sql)) {
      eq("author", 2);
    }
    // The explorer reads a member's authored notes by `author = ?1` (no privacy clause).
    if (/\bauthor = \?1/i.test(sql)) eq("author", 1);
    if (/created_at = \?3/i.test(sql)) eq("created_at", 3);
    return out;
  };

  const exec = (sql: string, binds: unknown[]): { rows: Record<string, unknown>[]; changes: number } => {
    const table = tableOf(sql);
    if (/^SELECT/i.test(sql)) {
      // The recipes slug-resolution shim (log_cooked): with no `recipes` table seeded, a
      // SELECT resolves against the `known` set. When a test DOES seed `tables.recipes`
      // (the data explorer reads real projection rows), fall through to a normal SELECT.
      if (table === "recipes" && !tables.recipes) {
        const slug = binds[0];
        return { rows: typeof slug === "string" && known.has(slug) ? [{ ok: 1 }] : [], changes: 0 };
      }
      if (!table || !tables[table]) return { rows: [], changes: 0 };
      // Tenant-scope only when the query actually filters by `tenant = ?1`; otherwise
      // (global tables, and cross-tenant reads like overlay-by-recipe) read all rows and
      // let the WHERE-equality filters below narrow.
      const base =
        !GLOBAL_TABLES.has(table) && /\btenant = \?1/i.test(sql)
          ? tables[table].filter((r) => r.tenant === binds[0])
          : tables[table];
      let rows = applyWhere(sql, binds, base);
      // The derived last-satisfied aggregation (readVibeLastSatisfied): MAX(date) per vibe_id over
      // the caller's cook-time satisfaction records (vibe_satisfaction, migration 0047).
      if (/MAX\(date\) AS d/i.test(sql) && /GROUP BY vibe_id/i.test(sql)) {
        const byVibe = new Map<unknown, unknown>();
        for (const r of rows) {
          if (r.vibe_id == null) continue;
          const prev = byVibe.get(r.vibe_id);
          if (prev === undefined || String(r.date) > String(prev)) byVibe.set(r.vibe_id, r.date);
        }
        return {
          rows: [...byVibe].map(([vibe_id, d]) => ({ vibe_id, d })),
          changes: 0,
        };
      }
      // The derived last_cooked aggregation (readLastCookedMap): MAX(date) per recipe
      // over the caller's type='recipe' rows.
      if (/MAX\(date\) AS last_cooked/i.test(sql) && /GROUP BY recipe/i.test(sql)) {
        const byRecipe = new Map<unknown, unknown>();
        for (const r of rows) {
          if (r.type !== "recipe" || r.recipe == null) continue;
          const prev = byRecipe.get(r.recipe);
          if (prev === undefined || String(r.date) > String(prev)) byRecipe.set(r.recipe, r.date);
        }
        return {
          rows: [...byRecipe].map(([recipe, last_cooked]) => ({ recipe, last_cooked })),
          changes: 0,
        };
      }
      // COUNT(*) AS <alias> — the admin backlog counts (audit-admin). Applied after WHERE.
      const count = /^SELECT\s+COUNT\(\*\)\s+AS\s+(\w+)/i.exec(sql);
      if (count) return { rows: [{ [count[1]]: rows.length }], changes: 0 };
      // Honor the simple ORDER BY clauses the corpus reads use.
      const order = /ORDER BY\s+(\w+)(\s+DESC)?/i.exec(sql);
      if (order) {
        const col = order[1];
        const dir = order[2] ? -1 : 1;
        rows = [...rows].sort((a, b) => {
          const av = a[col] as string;
          const bv = b[col] as string;
          return av < bv ? -dir : av > bv ? dir : 0;
        });
      }
      // Honor a bind-parameterized LIMIT (`LIMIT ?N`, the bounded corpus reads).
      const limit = /LIMIT \?(\d+)/i.exec(sql);
      if (limit) rows = rows.slice(0, Number(binds[Number(limit[1]) - 1]));
      return { rows: rows.map((r) => ({ ...r })), changes: 0 };
    }
    if (/^DELETE/i.test(sql)) {
      if (!table || !tables[table]) return { rows: [], changes: 0 };
      const before = tables[table].length;
      if (GLOBAL_TABLES.has(table)) {
        // Column-equality WHERE (single, or AND-joined multi — the edge/sku composite-PK
        // deletes) removes the matching row(s); any other shape is a table-wide delete.
        const where = /\bWHERE\s+(.+)$/is.exec(sql);
        const conds = where
          ? [...where[1].matchAll(/(\w+)\s*=\s*\?(\d+)/g)].map((x) => ({ col: x[1], n: Number(x[2]) }))
          : [];
        const keep = (r: Record<string, unknown>): boolean => {
          if (conds.length) return !conds.every(({ col, n }) => r[col] === binds[n - 1]);
          return false; // table-wide delete
        };
        tables[table] = tables[table].filter((r) => keep(r));
      } else {
        tables[table] = tables[table].filter((r) => {
          if (r.tenant !== binds[0]) return true;
          if (/LOWER\(recipe\) = LOWER\(\?2\)/i.test(sql))
            return String(r.recipe).toLowerCase() !== String(binds[1]).toLowerCase();
          if (/recipe = \?2/i.test(sql)) return r.recipe !== binds[1];
          // Dual-key remove: `normalized_name IN (?2, ?3)` deletes rows matching either bind.
          if (/normalized_name IN \(\?2, \?3\)/i.test(sql))
            return r.normalized_name !== binds[1] && r.normalized_name !== binds[2];
          if (/normalized_name = \?2/i.test(sql)) return r.normalized_name !== binds[1];
          // Tenant-scoped delete by row id (night_vibes, cooking_log).
          if (/\bid = \?2/i.test(sql)) return r.id !== binds[1];
          return false; // tenant-wide delete
        });
      }
      return { rows: [], changes: before - tables[table].length };
    }
    if (/^INSERT/i.test(sql)) {
      if (!table || !tables[table]) return { rows: [], changes: 0 };
      const cols = /INSERT (?:OR IGNORE )?INTO \w+ \(([^)]+)\)/i.exec(sql)![1].split(",").map((c) => c.trim());
      const row: Record<string, unknown> = {};
      cols.forEach((c, i) => (row[c] = binds[i] ?? null));
      // Autoincrement `id` when the table declares it and the INSERT omitted it.
      if (AUTOINCREMENT_TABLES.has(table) && row.id == null) {
        const maxId = tables[table].reduce((m, r) => Math.max(m, Number(r.id) || 0), 0);
        row.id = maxId + 1;
      }
      const pk = PK[table] ?? ["tenant", "normalized_name"];
      const idx = tables[table].findIndex((r) => pk.every((k) => r[k] === row[k]));
      if (idx >= 0) {
        if (/ON CONFLICT/i.test(sql)) {
          const setCols = [...sql.matchAll(/(\w+) = excluded\.(\w+)/gi)].map((m) => m[1]);
          const merged = { ...tables[table][idx] };
          for (const c of setCols) merged[c] = row[c];
          tables[table][idx] = merged;
          return { rows: [], changes: 1 };
        }
        // INSERT OR IGNORE (or a plain INSERT) on an existing PK/UNIQUE → no-op.
        return { rows: [], changes: 0 };
      }
      // UNIQUE(url) constraint on discovery_candidates: an INSERT OR IGNORE whose url
      // already exists is a no-op even though the PK (id) differs.
      if (
        (table === "discovery_candidates" || table === "ingest_candidates") &&
        /OR IGNORE/i.test(sql) &&
        "url" in row
      ) {
        if (tables[table].some((r) => r.url === row.url)) return { rows: [], changes: 0 };
      }
      tables[table].push(row);
      return { rows: [], changes: 1 };
    }
    if (/^UPDATE/i.test(sql)) {
      if (!table || !tables[table]) return { rows: [], changes: 0 };
      // Column-equality UPDATE: SET col=?N[, …] WHERE colA = ?N [AND colB = ?N …] — note
      // edits by id, the re-confirm/re-audit stamps by id/variant/edge composite PK. A SET
      // expression that isn't a plain `col = ?N` bind (e.g. `attempts = attempts + 1`) is
      // not simulated; a WHERE with no equality binds is a no-op.
      const m = /SET\s+(.+?)\s+WHERE\s+(.+)$/is.exec(sql);
      if (!m) return { rows: [], changes: 0 };
      const setCols = [...m[1].matchAll(/(\w+)\s*=\s*\?(\d+)/g)].map((x) => ({ col: x[1], n: Number(x[2]) }));
      // Literal SET assignments (`col = 'value'`), e.g. the sweep's `status = 'superseded'`.
      const setLits = [...m[1].matchAll(/(\w+)\s*=\s*'([^']*)'/g)].map((x) => ({ col: x[1], val: x[2] }));
      const conds = [...m[2].matchAll(/(\w+)\s*=\s*\?(\d+)/g)].map((x) => ({ col: x[1], n: Number(x[2]) }));
      // Literal WHERE equality (`col = 'value'`), e.g. the `status = 'pending'` guard.
      const condLits = [...m[2].matchAll(/(\w+)\s*=\s*'([^']*)'/g)].map((x) => ({ col: x[1], val: x[2] }));
      // A single `col IN (?a, ?b, …)` set membership (the chunked supersede sweep).
      const inMatch = /(\w+)\s+IN\s*\(([^)]+)\)/i.exec(m[2]);
      const inCond = inMatch
        ? { col: inMatch[1], values: [...inMatch[2].matchAll(/\?(\d+)/g)].map((x) => binds[Number(x[1]) - 1]) }
        : null;
      if (conds.length === 0 && condLits.length === 0 && !inCond) return { rows: [], changes: 0 };
      let changes = 0;
      for (const r of tables[table]) {
        const ok =
          conds.every(({ col, n }) => r[col] === binds[n - 1]) &&
          condLits.every(({ col, val }) => String(r[col]) === val) &&
          (!inCond || inCond.values.includes(r[inCond.col]));
        if (ok) {
          for (const { col, n } of setCols) r[col] = binds[n - 1] ?? null;
          for (const { col, val } of setLits) r[col] = val;
          changes++;
        }
      }
      return { rows: [], changes };
    }
    return { rows: [], changes: 0 };
  };

  const makeStmt = (sql: string) => {
    let binds: unknown[] = [];
    const stmt = {
      bind(...v: unknown[]) {
        binds = v;
        return stmt;
      },
      async first<T>() {
        return (exec(sql, binds).rows[0] ?? null) as T | null;
      },
      async all<T>() {
        return { results: exec(sql, binds).rows as T[], success: true as const, meta: { changes: 0 } };
      },
      async run() {
        return { success: true as const, meta: { changes: exec(sql, binds).changes } };
      },
      __sql: () => sql,
      __binds: () => binds,
      __exec: () => exec(sql, binds),
    };
    return stmt;
  };

  const DB = {
    prepare: (sql: string) => makeStmt(sql) as unknown as D1PreparedStatement,
    async batch(stmts: unknown[]) {
      const recorded: { sql: string; binds: unknown[] }[] = [];
      for (const s of stmts) {
        const stmt = s as { __sql: () => string; __binds: () => unknown[]; __exec: () => void };
        recorded.push({ sql: stmt.__sql(), binds: stmt.__binds() });
        stmt.__exec();
      }
      batches.push(recorded);
      return [];
    },
  } as unknown as D1Database;

  return { env: { DB } as unknown as Env, tables, batches };
}
