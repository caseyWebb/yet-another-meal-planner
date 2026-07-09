// The migration 0047 BACKFILL (converge-meal-planning-surfaces D4): existing provenance-stamped
// cooking-log history (`cooking_log.satisfied_vibe`, migration 0026) must be carried into the new
// `vibe_satisfaction` records so past attribution isn't lost when `readVibeLastSatisfied` switches
// its source. This applies every migration BEFORE 0047, seeds prior history, THEN applies 0047 — so
// the backfill runs against real pre-existing rows, exactly as a production `d1 migrations apply`
// would on a DB that already has cook history.

import { describe, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations", "d1");
const BACKFILL = "0047_vibe_satisfaction.sql";

/** Apply every migration whose filename sorts before `stop`, in order. */
function applyBefore(raw: DatabaseSync, stop: string): void {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql") && f < stop)
    .sort();
  for (const f of files) raw.exec(readFileSync(join(MIGRATIONS_DIR, f), "utf8"));
}

describe("migration 0047 — vibe_satisfaction backfill", () => {
  it("copies provenance-stamped cooks into vibe_satisfaction, skipping off-plan (null) rows", () => {
    const raw = new DatabaseSync(":memory:");
    applyBefore(raw, BACKFILL);

    // Prior history: two provenance-stamped cooks for one vibe (+ a different vibe) and one off-plan
    // cook with a NULL satisfied_vibe that must NOT be backfilled.
    const ins = raw.prepare(
      "INSERT INTO cooking_log (tenant, date, type, recipe, satisfied_vibe) VALUES (?, ?, 'recipe', ?, ?)",
    );
    ins.run("casey", "2026-05-01", "penne", "weeknight-pasta");
    ins.run("casey", "2026-05-10", "ziti", "weeknight-pasta");
    ins.run("casey", "2026-05-12", "curry", "spice-night");
    raw
      .prepare("INSERT INTO cooking_log (tenant, date, type, recipe, satisfied_vibe) VALUES (?, ?, 'recipe', ?, NULL)")
      .run("casey", "2026-05-20", "toast");

    // Now apply the backfill migration.
    raw.exec(readFileSync(join(MIGRATIONS_DIR, BACKFILL), "utf8"));

    const rows = raw
      .prepare("SELECT tenant, cooking_log_id, vibe_id, date, score FROM vibe_satisfaction ORDER BY cooking_log_id")
      .all() as { tenant: string; cooking_log_id: number; vibe_id: string; date: string; score: number | null }[];

    // Exactly the three non-null rows, keyed by the real cooking_log id, score NULL (unknown).
    expect(rows.map((r) => r.vibe_id)).toEqual(["weeknight-pasta", "weeknight-pasta", "spice-night"]);
    expect(rows.every((r) => r.tenant === "casey" && r.score === null)).toBe(true);
    expect(rows.map((r) => r.cooking_log_id)).toEqual([1, 2, 3]);

    // The derived MAX(date) for the repeated vibe is the later of the two backfilled cooks.
    const last = raw
      .prepare("SELECT vibe_id, MAX(date) AS d FROM vibe_satisfaction WHERE tenant = ? GROUP BY vibe_id")
      .all("casey") as { vibe_id: string; d: string }[];
    const byVibe = new Map(last.map((r) => [r.vibe_id, r.d]));
    expect(byVibe.get("weeknight-pasta")).toBe("2026-05-10");
    expect(byVibe.get("spice-night")).toBe("2026-05-12");
  });
});
