// The visibility LENS module (deployment-profiles-and-visibility-lens, shared-corpus):
// the one enforcement point's predicate over the REAL-SQLite env — both profiles, all
// three viewer positions, the curated tier + household hide, provenance precedence,
// the empty friend seam, and the purge/member-revoke interaction with `recipe_imports`
// (TENANT_TABLES). Grants are seeded directly; the lens is always COMPUTED (nothing
// per-viewer is ever written).
import { describe, it, expect } from "vitest";
import { sqliteEnv, type SqliteEnv } from "./sqlite-d1.js";
import {
  CURATED_TENANT,
  ANONYMOUS,
  memberViewer,
  friendHouseholds,
  visibleSlugs,
  isVisible,
  visibleSlugProvenance,
  lensHouseholds,
  readCuratedHide,
  recordImportGrant,
} from "../src/visibility.js";
import { db } from "../src/db.js";
import { resolveIdentity, directoryFromEnv } from "../src/tenant.js";
import { insertFoundingMember } from "../src/members-db.js";
import { revoke, revokeMember, TENANT_TABLES, type AdminDeps } from "../src/admin.js";
import type { KvStore } from "../src/kroger-user.js";

const A = "casey"; // household A
const B = "pat"; // household B (never A's friend — the seam is empty)

function seedRecipe(h: SqliteEnv, slug: string): void {
  h.raw.prepare("INSERT INTO recipes (slug, title) VALUES (?, ?)").run(slug, slug.toUpperCase());
}

function grant(h: SqliteEnv, recipe: string, tenant: string, via = "agent"): void {
  h.raw
    .prepare("INSERT OR IGNORE INTO recipe_imports (recipe, tenant, member, via, imported_at) VALUES (?, ?, ?, ?, '2026-01-01')")
    .run(recipe, tenant, tenant, via);
}

function setProfile(h: SqliteEnv, profile: "self-hosted" | "saas"): void {
  h.raw
    .prepare(
      "INSERT INTO operator_config (id, deployment_profile) VALUES (1, ?) " +
        "ON CONFLICT(id) DO UPDATE SET deployment_profile = excluded.deployment_profile",
    )
    .run(profile);
}

function setCuratedHide(h: SqliteEnv, tenant: string, hide: boolean): void {
  h.raw
    .prepare("INSERT INTO profile (tenant, curated_hide) VALUES (?, ?) ON CONFLICT(tenant) DO UPDATE SET curated_hide = excluded.curated_hide")
    .run(tenant, hide ? 1 : 0);
}

/** A: own recipe; B: its own recipe; plus one curated-only recipe. */
function corpus(h: SqliteEnv): void {
  for (const s of ["a-dish", "b-dish", "starter"]) seedRecipe(h, s);
  grant(h, "a-dish", A);
  grant(h, "b-dish", B);
  grant(h, "starter", CURATED_TENANT, "curated");
}

describe("the lens predicate — self-hosted (implicit all-to-all)", () => {
  it("every non-curated grant admits every member AND the anonymous reader; curated rows do not", async () => {
    const h = sqliteEnv([A, B]);
    corpus(h);
    // Unset profile → self-hosted (the D9 default; no data or config surgery).
    for (const viewer of [memberViewer(A), memberViewer(B), ANONYMOUS]) {
      expect(await visibleSlugs(h.env, viewer)).toEqual(new Set(["a-dish", "b-dish"]));
    }
    // Zero stored edges: the all-to-all relation is computed, never materialized.
    expect(h.rows("recipe_imports")).toHaveLength(3);
  });

  it("a zero-grant recipe is invisible until the reconcile attaches it", async () => {
    const h = sqliteEnv([A]);
    seedRecipe(h, "legacy");
    expect(await isVisible(h.env, memberViewer(A), "legacy")).toBe(false);
    expect(await isVisible(h.env, ANONYMOUS, "legacy")).toBe(false);
    await recordImportGrant(h.env, { recipe: "legacy", tenant: A, member: A, via: "agent", importedAt: "2026-01-02" });
    expect(await isVisible(h.env, memberViewer(A), "legacy")).toBe(true);
  });

  it("lensHouseholds is null (every household — no enumeration) and the group reads use the directory", async () => {
    const h = sqliteEnv([A, B]);
    expect(await lensHouseholds(h.env, A)).toBeNull();
  });
});

describe("the lens predicate — SaaS (scoped visibility)", () => {
  it("a member sees own + curated only; the friend seam is the EMPTY relation until the People change", async () => {
    const h = sqliteEnv([A, B]);
    corpus(h);
    setProfile(h, "saas");
    expect(await friendHouseholds(h.env, A)).toEqual([]); // the seam contract, pre-friendships
    expect(await visibleSlugs(h.env, memberViewer(A))).toEqual(new Set(["a-dish", "starter"]));
    expect(await visibleSlugs(h.env, memberViewer(B))).toEqual(new Set(["b-dish", "starter"]));
    // The out-of-lens point read is exactly as false as a nonexistent slug's.
    expect(await isVisible(h.env, memberViewer(A), "b-dish")).toBe(false);
    expect(await isVisible(h.env, memberViewer(A), "does-not-exist")).toBe(false);
  });

  it("the anonymous position is exactly the curated tier", async () => {
    const h = sqliteEnv([A, B]);
    corpus(h);
    setProfile(h, "saas");
    expect(await visibleSlugs(h.env, ANONYMOUS)).toEqual(new Set(["starter"]));
    expect(await isVisible(h.env, ANONYMOUS, "a-dish")).toBe(false);
  });

  it("curated_hide suppresses the WHOLE curated tier for ONE household only, reversibly; anonymous unaffected", async () => {
    const h = sqliteEnv([A, B]);
    corpus(h);
    setProfile(h, "saas");
    setCuratedHide(h, A, true);
    expect(await readCuratedHide(h.env, A)).toBe(true);
    expect(await visibleSlugs(h.env, memberViewer(A))).toEqual(new Set(["a-dish"]));
    // Other households and the anonymous reader are unaffected (the hide scopes one lens).
    expect(await visibleSlugs(h.env, memberViewer(B))).toEqual(new Set(["b-dish", "starter"]));
    expect(await visibleSlugs(h.env, ANONYMOUS)).toEqual(new Set(["starter"]));
    // Reversible — clearing restores the tier unchanged; nothing was deleted.
    setCuratedHide(h, A, false);
    expect(await visibleSlugs(h.env, memberViewer(A))).toEqual(new Set(["a-dish", "starter"]));
  });

  it("lensHouseholds is the caller's household plus the (empty) friend seam", async () => {
    const h = sqliteEnv([A, B]);
    setProfile(h, "saas");
    expect(await lensHouseholds(h.env, A)).toEqual([A]);
  });
});

describe("provenance (the member list-surface hint)", () => {
  it("precedence own > friend > curated; self-hosted reads another household's grant as friend", async () => {
    const h = sqliteEnv([A, B]);
    corpus(h);
    grant(h, "a-dish", CURATED_TENANT, "curated"); // own + curated on one slug → own wins
    const p = await visibleSlugProvenance(h.env, memberViewer(A));
    expect(p.get("a-dish")).toBe("own");
    expect(p.get("b-dish")).toBe("friend"); // the implicit all-to-all edge
    // The curated tier is SaaS-only (D9): under self-hosted a curated-only recipe is
    // simply outside the lens, so it never earns a provenance entry at all.
    expect(p.has("starter")).toBe(false);
  });

  it("under SaaS a curated grant on an own recipe still reads own", async () => {
    const h = sqliteEnv([A]);
    corpus(h);
    grant(h, "a-dish", CURATED_TENANT, "curated");
    setProfile(h, "saas");
    const p = await visibleSlugProvenance(h.env, memberViewer(A));
    expect(p.get("a-dish")).toBe("own");
    expect(p.get("starter")).toBe("curated");
    expect(p.has("b-dish")).toBe(false); // out of lens → not in the map at all
  });
});

describe("grant idempotence (first provenance wins)", () => {
  it("a household's second import changes nothing", async () => {
    const h = sqliteEnv([A]);
    seedRecipe(h, "dish");
    await recordImportGrant(h.env, { recipe: "dish", tenant: A, member: A, via: "agent", importedAt: "2026-01-01" });
    await recordImportGrant(h.env, { recipe: "dish", tenant: A, member: "someone-else", via: "feed:x", importedAt: "2026-02-02" });
    expect(h.rows("recipe_imports")).toEqual([
      { recipe: "dish", tenant: A, member: A, via: "agent", imported_at: "2026-01-01" },
    ]);
  });
});

describe("the reserved curated tenant is unclaimable (shared-corpus)", () => {
  it("never resolves an identity: not allowlisted, no members row, no session path", async () => {
    const h = sqliteEnv([A]);
    const resolved = await resolveIdentity(h.env, CURATED_TENANT, undefined, directoryFromEnv(h.env));
    expect(resolved).toMatchObject({ error: "unauthorized" });
    expect(h.rows("members").some((m) => m.id === CURATED_TENANT)).toBe(false);
  });

  it("is outside the self-service username grammar", async () => {
    // src/signup.ts USERNAME_RE requires a [a-z0-9] start — `~` can never start a claim.
    const { isValidUsername } = await import("../src/signup.js");
    expect(isValidUsername(CURATED_TENANT)).toBe(false);
  });
});

describe("purge and member-revoke over recipe_imports (tasks 1.3)", () => {
  const deps = (h: SqliteEnv): AdminDeps => ({
    tenantKv: h.env.TENANT_KV,
    krogerKv: h.env.KROGER_KV as unknown as KvStore,
    oauthKv: h.env.KROGER_KV as unknown as KvStore,
    db: db(h.env),
    randomCode: () => "x",
  });

  it("recipe_imports is on the one-place purge list", () => {
    expect(TENANT_TABLES).toContain("recipe_imports");
  });

  it("household purge deletes the tenant's grants — and visibility follows; curated rows survive", async () => {
    const h = sqliteEnv([A, B]);
    corpus(h);
    await insertFoundingMember(db(h.env), A, 1000);
    await insertFoundingMember(db(h.env), B, 2000);
    await revoke(deps(h), A);
    // A's grant rows are gone; a recipe visible only through them left every lens.
    expect(h.rows<{ tenant: string }>("recipe_imports").map((r) => r.tenant).sort()).toEqual([B, CURATED_TENANT]);
    expect(await isVisible(h.env, memberViewer(B), "a-dish")).toBe(false);
    // The shared corpus row itself is NOT deleted (visibility is an overlay, never segmentation).
    expect(h.rows<{ slug: string }>("recipes").map((r) => r.slug)).toContain("a-dish");
  });

  it("member-revoke leaves recipe_imports untouched (the household keeps its recipes)", async () => {
    const h = sqliteEnv([A]);
    corpus(h);
    await insertFoundingMember(db(h.env), A, 1000);
    await db(h.env).run(
      "INSERT INTO members (id, tenant, handle, created_at) VALUES (?1, ?2, ?3, ?4)",
      "m2", A, "m2-handle", 2000,
    );
    await revokeMember(deps(h), A, "m2");
    expect(h.rows<{ tenant: string }>("recipe_imports").filter((r) => r.tenant === A)).toHaveLength(1);
    expect(await isVisible(h.env, memberViewer(A), "a-dish")).toBe(true);
  });
});
