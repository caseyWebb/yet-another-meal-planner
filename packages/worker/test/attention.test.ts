// The read_user_profile attention block (data-read-tools D8): retrospective_due (cooking
// history + the last_retrospective_at watermark, 42-day threshold), unverified_perishables
// (produce/dairy/seafood/meat pantry rows, 7-day threshold), and stale_areas (the existing
// `missing` onboarding derivation) — deterministic, no AI, no write beyond the retrospective
// surfaces' own watermark stamp. Real migrated SQLite throughout, so migration 0062's new
// `profile.last_retrospective_at` column is exercised for real.

import { describe, it, expect } from "vitest";
import {
  assembleUserProfile,
  hasCookingHistory,
  isRetrospectiveDue,
  buildServer,
} from "../src/tools.js";
import { loadRetrospective } from "../src/cooking-tools.js";
import { readLastRetrospective } from "../src/profile-db.js";
import { countUnverifiedPerishables } from "../src/session-db.js";
import { sqliteEnv, type SqliteEnv } from "./sqlite-d1.js";
import { withServer, invokeTool } from "./tool-harness.js";
import type { Tenant } from "../src/tenant.js";

/** An ISO day (YYYY-MM-DD) `n` whole days before now. */
function daysAgoIso(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

/** An ISO day `days` before a FIXED anchor — for boundary tests, immune to real-clock flake. */
function isoDaysAgoFrom(now: Date, days: number): string {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function seedCookingLog(h: SqliteEnv, tenant: string, date: string): void {
  h.raw
    .prepare("INSERT INTO cooking_log (tenant, date, type, name, protein, cuisine) VALUES (?, ?, 'ad_hoc', ?, ?, ?)")
    .run(tenant, date, "homemade tacos", "beef", "mexican");
}

function seedPantryRow(h: SqliteEnv, tenant: string, name: string, category: string, lastVerifiedAt: string | null): void {
  h.raw
    .prepare("INSERT INTO pantry (tenant, name, normalized_name, category, last_verified_at) VALUES (?, ?, ?, ?, ?)")
    .run(tenant, name, name, category, lastVerifiedAt);
}

describe("isRetrospectiveDue — the 42-day threshold (pure)", () => {
  it("is false with no cooking history, regardless of watermark", () => {
    expect(isRetrospectiveDue(false, null)).toBe(false);
    expect(isRetrospectiveDue(false, daysAgoIso(1000))).toBe(false);
  });

  it("is true with cooking history and a null (never-read) watermark", () => {
    expect(isRetrospectiveDue(true, null)).toBe(true);
  });

  it("boundary: due at exactly 42 days old, not due at 41", () => {
    const now = new Date("2026-07-16T12:00:00Z");
    expect(isRetrospectiveDue(true, isoDaysAgoFrom(now, 42), now)).toBe(true);
    expect(isRetrospectiveDue(true, isoDaysAgoFrom(now, 41), now)).toBe(false);
  });

  it("is false for a recently-read watermark", () => {
    expect(isRetrospectiveDue(true, daysAgoIso(1))).toBe(false);
  });
});

describe("hasCookingHistory", () => {
  it("is false for an empty log and true once any row exists", async () => {
    const h = sqliteEnv(["casey"]);
    expect(await hasCookingHistory(h.env, "casey")).toBe(false);
    seedCookingLog(h, "casey", daysAgoIso(1));
    expect(await hasCookingHistory(h.env, "casey")).toBe(true);
  });
});

describe("countUnverifiedPerishables — perishable categories + the 7-day threshold", () => {
  it("counts produce/dairy/seafood/meat rows unverified for >= 7 days, NULL included", async () => {
    const h = sqliteEnv(["casey"]);
    const now = new Date("2026-07-16T00:00:00Z");
    seedPantryRow(h, "casey", "spinach", "produce", isoDaysAgoFrom(now, 7)); // exactly 7 -> counts
    seedPantryRow(h, "casey", "milk", "dairy", isoDaysAgoFrom(now, 6)); // 6 -> does not count
    seedPantryRow(h, "casey", "salmon", "seafood", null); // NULL -> counts
    seedPantryRow(h, "casey", "chicken", "meat", isoDaysAgoFrom(now, 30)); // very stale -> counts
    seedPantryRow(h, "casey", "rice", "grains", null); // non-perishable category -> never counts
    seedPantryRow(h, "casey", "fresh-basil", "produce", isoDaysAgoFrom(now, 1)); // fresh -> does not count

    expect(await countUnverifiedPerishables(h.env, "casey", now)).toBe(3);
  });

  it("a tenant with no pantry rows counts zero, and never AI/writes", async () => {
    const h = sqliteEnv(["casey"]);
    expect(await countUnverifiedPerishables(h.env, "casey")).toBe(0);
  });

  it("never counts another tenant's rows", async () => {
    const h = sqliteEnv(["casey", "pat"]);
    const now = new Date("2026-07-16T00:00:00Z");
    seedPantryRow(h, "pat", "spinach", "produce", null);
    expect(await countUnverifiedPerishables(h.env, "casey", now)).toBe(0);
  });
});

describe("assembleUserProfile — the attention block end to end", () => {
  it("an empty profile degrades cleanly: no pantry, no cooking log, no watermark", async () => {
    const h = sqliteEnv(["ghost"]);
    const profile = await assembleUserProfile(h.env, "ghost");
    expect(profile.attention).toEqual({
      retrospective_due: false,
      unverified_perishables: 0,
      stale_areas: profile.missing,
    });
    expect(profile.missing.length).toBeGreaterThan(0);
  });

  it("stale_areas mirrors missing exactly (present area excluded, absent areas included)", async () => {
    const h = sqliteEnv(["casey"]);
    h.raw.exec("INSERT INTO profile (tenant, taste) VALUES ('casey', 'loves spice')");
    const profile = await assembleUserProfile(h.env, "casey");
    expect(profile.attention.stale_areas).toEqual(profile.missing);
    expect(profile.attention.stale_areas).toContain("store");
    expect(profile.attention.stale_areas).not.toContain("taste");
  });

  it("three long-unverified produce/dairy rows surface as unverified_perishables: 3", async () => {
    const h = sqliteEnv(["casey"]);
    seedPantryRow(h, "casey", "spinach", "produce", daysAgoIso(30));
    seedPantryRow(h, "casey", "yogurt", "dairy", daysAgoIso(20));
    seedPantryRow(h, "casey", "shrimp", "seafood", daysAgoIso(10));
    seedPantryRow(h, "casey", "fresh-lettuce", "produce", daysAgoIso(1));
    const profile = await assembleUserProfile(h.env, "casey");
    expect(profile.attention.unverified_perishables).toBe(3);
  });
});

describe("last_retrospective_at stamping — reading the retrospective resets the nudge", () => {
  it("loadRetrospective stamps today's date; a prior null flips retrospective_due false", async () => {
    const h = sqliteEnv(["casey"]);
    seedCookingLog(h, "casey", daysAgoIso(100));

    expect(await readLastRetrospective(h.env, "casey")).toBeNull();
    const before = await assembleUserProfile(h.env, "casey");
    expect(before.attention.retrospective_due).toBe(true);

    await loadRetrospective(h.env, "casey", "month");

    const today = new Date().toISOString().slice(0, 10);
    expect(await readLastRetrospective(h.env, "casey")).toBe(today);
    const after = await assembleUserProfile(h.env, "casey");
    expect(after.attention.retrospective_due).toBe(false);
  });

  it("a validation failure (bad waste_mapping_version) never stamps the watermark", async () => {
    const h = sqliteEnv(["casey"]);
    seedCookingLog(h, "casey", daysAgoIso(100));
    await expect(
      loadRetrospective(h.env, "casey", "month", "4w", "4w", "not-a-real-version"),
    ).rejects.toMatchObject({ code: "validation_failed" });
    expect(await readLastRetrospective(h.env, "casey")).toBeNull();
  });

  it("the retrospective MCP tool stamps identically to the direct call", async () => {
    const h = sqliteEnv(["casey"]);
    seedCookingLog(h, "casey", daysAgoIso(100));
    const tenant: Tenant = { id: "casey", member: "casey" };
    const server = buildServer(h.env, tenant, "https://yamp.example.com", {
      profile: "self-hosted",
      operator: false,
      kroger: false,
      instacart: false,
    });
    const out = await withServer(server, (c) => invokeTool(c, "retrospective", { period: "month" }));
    expect(out.isError).toBe(false);
    const today = new Date().toISOString().slice(0, 10);
    expect(await readLastRetrospective(h.env, "casey")).toBe(today);
  });
});

describe("read_user_profile tool — the attention block reaches the MCP surface", () => {
  it("the tool result's attention block matches assembleUserProfile's", async () => {
    const h = sqliteEnv(["casey"]);
    seedCookingLog(h, "casey", daysAgoIso(100));
    seedPantryRow(h, "casey", "spinach", "produce", daysAgoIso(30));
    const tenant: Tenant = { id: "casey", member: "casey" };
    const server = buildServer(h.env, tenant, "https://yamp.example.com", {
      profile: "self-hosted",
      operator: false,
      kroger: false,
      instacart: false,
    });
    const out = await withServer(server, (c) => invokeTool(c, "read_user_profile", {}));
    expect(out.isError).toBe(false);
    const direct = await assembleUserProfile(h.env, "casey");
    expect((out.result as { attention: unknown }).attention).toEqual(direct.attention);
    expect(direct.attention).toMatchObject({ retrospective_due: true, unverified_perishables: 1 });
  });
});
