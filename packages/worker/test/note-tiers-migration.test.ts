// Migration-chain tests for 0061_note_tiers (note-visibility-tiers): the real
// migration DDL over real SQLite, run against a database migrated through 0060 and
// seeded with genuinely pre-tier rows — proving the PURE mapping (private=1 →
// 'private', everything else → 'friends'), the count identity the production fixture
// capture asserts (post-migration tier counts equal the pre-migration private/shared
// counts), the NULL-guarded backfill's idempotence, and the CHECK constraint.

import { describe, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations", "d1");
const NOTE_TIERS = "0061_note_tiers.sql";

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

const migrationSql = () => readFileSync(join(MIGRATIONS_DIR, NOTE_TIERS), "utf8");

/** The NULL-guarded backfill statement, extracted VERBATIM from the migration file
 *  (the ALTER is the one exactly-once statement; "run twice" means the backfill). */
function backfillStatement(): string {
  const stmt = migrationSql()
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("UPDATE recipe_notes"));
  if (!stmt) throw new Error("backfill statement not found in 0061");
  return stmt;
}

function seedNote(raw: DatabaseSync, author: string, createdAt: string, priv: 0 | 1): void {
  raw
    .prepare(
      "INSERT INTO recipe_notes (id, recipe, author, body, tags, private, created_at) VALUES (?, 'tacos', ?, 'b', '[]', ?, ?)",
    )
    .run(`${author} tacos ${createdAt}`, author, priv, createdAt);
}

describe("0061_note_tiers over a pre-tier database", () => {
  it("maps every row purely: private=1 → 'private', everything else → 'friends'; counts are preserved", () => {
    const raw = migratedBefore(NOTE_TIERS);
    seedNote(raw, "casey", "2026-06-01", 0);
    seedNote(raw, "casey", "2026-06-02", 1);
    seedNote(raw, "pat", "2026-06-03", 0);
    seedNote(raw, "pat", "2026-06-04", 0);
    const before = raw.prepare("SELECT COUNT(*) AS n, SUM(private = 1) AS p FROM recipe_notes").get() as {
      n: number;
      p: number;
    };

    raw.exec(migrationSql());

    // The production-capture identity: tier counts equal the pre-migration split.
    const byTier = Object.fromEntries(
      (raw.prepare("SELECT tier, COUNT(*) AS n FROM recipe_notes GROUP BY tier").all() as { tier: string; n: number }[]).map(
        (r) => [r.tier, r.n],
      ),
    );
    expect(byTier).toEqual({ private: before.p, friends: before.n - before.p });
    expect(raw.prepare("SELECT COUNT(*) AS n FROM recipe_notes WHERE tier IS NULL").get()).toEqual({ n: 0 });
    // Nothing else changed: bodies, authors, privacy column untouched.
    const rows = raw.prepare("SELECT private, tier FROM recipe_notes ORDER BY created_at").all() as {
      private: number;
      tier: string;
    }[];
    expect(rows.map((r) => [r.private, r.tier])).toEqual([
      [0, "friends"],
      [1, "private"],
      [0, "friends"],
      [0, "friends"],
    ]);
  });

  it("the NULL-guarded backfill is idempotent and heals only NULL-tier rows (a rollback-window insert converges)", () => {
    const raw = migratedBefore(NOTE_TIERS);
    seedNote(raw, "casey", "2026-06-01", 1);
    raw.exec(migrationSql());
    // A member re-tiered their migrated note; then old code (rollback window) inserts a
    // NULL-tier row. Re-running the backfill heals the NULL and leaves the edit alone.
    raw.prepare("UPDATE recipe_notes SET tier = 'public', private = 0 WHERE created_at = '2026-06-01'").run();
    seedNote(raw, "casey", "2026-06-09", 0);
    raw.exec(backfillStatement());
    const rows = raw.prepare("SELECT tier FROM recipe_notes ORDER BY created_at").all() as { tier: string }[];
    expect(rows.map((r) => r.tier)).toEqual(["public", "friends"]);
  });

  it("the CHECK constraint rejects an unknown tier value", () => {
    const raw = migratedBefore(NOTE_TIERS);
    raw.exec(migrationSql());
    expect(() =>
      raw
        .prepare(
          "INSERT INTO recipe_notes (id, recipe, author, body, tags, private, created_at, tier) VALUES ('x tacos t', 'tacos', 'x', 'b', '[]', 0, 't', 'household')",
        )
        .run(),
    ).toThrow();
  });
});
