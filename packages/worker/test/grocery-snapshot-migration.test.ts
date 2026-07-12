import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations", "d1");
const MIGRATION = "0053_grocery_snapshot.sql";

function migrated(): DatabaseSync {
  const raw = new DatabaseSync(":memory:");
  for (const file of readdirSync(DIR).filter((f) => f.endsWith(".sql") && f < MIGRATION).sort()) {
    raw.exec(readFileSync(join(DIR, file), "utf8"));
  }
  raw.prepare("INSERT INTO grocery_list (tenant,name,normalized_name,status,added_at) VALUES ('casey','Milk','milk','active','2026-07-01')").run();
  raw.prepare("INSERT INTO order_sends (id,tenant,store,fulfillment,created_at) VALUES ('send-1','casey','kroger','kroger_online','2026-07-01T12:00:00Z')").run();
  raw.exec(readFileSync(join(DIR, MIGRATION), "utf8"));
  return raw;
}

describe("migration 0053 — grocery snapshot", () => {
  it("reads old rows unchecked/version one and old sends unplaced", () => {
    const raw = migrated();
    expect(raw.prepare("SELECT checked_at,row_version,updated_at FROM grocery_list").get()).toEqual({ checked_at: null, row_version: 1, updated_at: null });
    expect(raw.prepare("SELECT placed_at FROM order_sends").get()).toEqual({ placed_at: null });
  });

  it("isolates substitution decisions by tenant", () => {
    const raw = migrated();
    const now = "2026-07-12T12:00:00Z";
    const stmt = raw.prepare("INSERT INTO grocery_substitution_decisions (tenant,original_key,replacement_key,attribution_signature,created_at,updated_at) VALUES (?,?,?,?,?,?)");
    stmt.run("casey", "milk", "oat milk", "[]", now, now);
    stmt.run("everett", "milk", "soy milk", "[]", now, now);
    expect(raw.prepare("SELECT count(*) AS n FROM grocery_substitution_decisions").get()).toEqual({ n: 2 });
  });
});
