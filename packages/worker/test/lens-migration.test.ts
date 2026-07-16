// Migration-chain tests for 0059_recipe_imports (deployment-profiles-and-visibility-lens):
// the real migration DDL over real SQLite. The pre-0059 case builds a database migrated
// through 0058, seeds pre-lens rows (discovery_matches without a member dimension), then
// applies 0059 — proving the member backfill against genuinely old data, not a fresh
// schema. The grant PK / CHECK semantics are exercised over the full chain.
import { describe, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sqliteEnv } from "./sqlite-d1.js";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations", "d1");
const RECIPE_IMPORTS = "0059_recipe_imports.sql";

/** A real SQLite database migrated through every migration BEFORE `stopAt`. */
function migratedBefore(stopAt: string): DatabaseSync {
  const raw = new DatabaseSync(":memory:");
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const f of files) {
    if (f === stopAt) break;
    raw.exec(readFileSync(join(MIGRATIONS_DIR, f), "utf8"));
  }
  return raw;
}

const migrationSql = () => readFileSync(join(MIGRATIONS_DIR, RECIPE_IMPORTS), "utf8");

describe("0059_recipe_imports over a pre-lens database", () => {
  it("backfills discovery_matches.member = tenant for every pre-existing match row", () => {
    const raw = migratedBefore(RECIPE_IMPORTS);
    raw.exec("INSERT INTO discovery_matches (recipe, tenant, score, matched_at) VALUES ('ragu', 'casey', 0.7, '2026-05-01')");
    raw.exec("INSERT INTO discovery_matches (recipe, tenant, score, matched_at) VALUES ('ragu', 'alice', 0.6, '2026-05-02')");
    raw.exec(migrationSql());
    const rows = raw.prepare("SELECT recipe, tenant, member FROM discovery_matches ORDER BY tenant").all();
    // Exact under the founding-member invariant: every pre-split match was made for the
    // household's only member, whose id equals the tenant id.
    expect(rows).toEqual([
      { recipe: "ragu", tenant: "alice", member: "alice" },
      { recipe: "ragu", tenant: "casey", member: "casey" },
    ]);
  });

  it("leaves operator_config columns NULL — existing deployments resolve self-hosted with no write", () => {
    const raw = migratedBefore(RECIPE_IMPORTS);
    raw.exec("INSERT INTO operator_config (id, favorite_weight) VALUES (1, 0.2)");
    raw.exec(migrationSql());
    expect(raw.prepare("SELECT deployment_profile, curated_source_url FROM operator_config WHERE id = 1").get()).toEqual({
      deployment_profile: null,
      curated_source_url: null,
    });
  });
});

describe("recipe_imports over the full migration chain", () => {
  it("PK (recipe, tenant) enforces one provenance row per household; INSERT OR IGNORE keeps the first", () => {
    const { raw, rows } = sqliteEnv();
    raw.exec("INSERT INTO recipe_imports (recipe, tenant, member, via, imported_at) VALUES ('ragu', 'casey', 'casey', 'agent', '2026-01-01')");
    raw.exec("INSERT OR IGNORE INTO recipe_imports (recipe, tenant, member, via, imported_at) VALUES ('ragu', 'casey', 'm2', 'feed:x', '2026-02-02')");
    // A SECOND household's grant on the same recipe is a distinct row (both live).
    raw.exec("INSERT INTO recipe_imports (recipe, tenant, member, via, imported_at) VALUES ('ragu', 'pat', 'pat', 'agent', '2026-03-03')");
    expect(rows("recipe_imports")).toEqual([
      { recipe: "ragu", tenant: "casey", member: "casey", via: "agent", imported_at: "2026-01-01" },
      { recipe: "ragu", tenant: "pat", member: "pat", via: "agent", imported_at: "2026-03-03" },
    ]);
  });

  it("member is NOT NULL — no NULL-owner sentinel can ever be written", () => {
    const { raw } = sqliteEnv();
    expect(() =>
      raw.exec("INSERT INTO recipe_imports (recipe, tenant, member, via, imported_at) VALUES ('r', 't', NULL, 'agent', '2026-01-01')"),
    ).toThrow();
  });

  it("operator_config.deployment_profile CHECK rejects off-vocabulary values", () => {
    const { raw } = sqliteEnv();
    expect(() => raw.exec("INSERT INTO operator_config (id, deployment_profile) VALUES (1, 'multi-tenant')")).toThrow();
    raw.exec("INSERT INTO operator_config (id, deployment_profile) VALUES (1, 'saas')"); // the vocabulary passes
  });
});
