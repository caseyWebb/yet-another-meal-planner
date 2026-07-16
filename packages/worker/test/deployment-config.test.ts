// The deployment-profile channel + flip guards (deployment-profiles-and-visibility-lens,
// shared-corpus / operator-admin): the ONE accessor's NULL→self-hosted default, the
// full flip-guard acceptance/refusal matrix (validate-plus-confirm one way, the
// consent-inversion refusal the other), and the curated-source knob's three stored
// states (NULL = compiled default, '' = disabled, value = repoint) — all over the
// REAL-SQLite env so the singleton's column semantics are exercised for real.
import { describe, it, expect } from "vitest";
import { sqliteEnv, type SqliteEnv } from "./sqlite-d1.js";
import { loadDeploymentProfile } from "../src/deployment.js";
import {
  DEFAULT_CURATED_SOURCE_URL,
  loadDeploymentConfig,
  saveDeploymentConfig,
  validateProfileFlip,
} from "../src/operator-config.js";
import { getDeploymentConfig, putDeploymentConfig } from "../src/admin/config-api.js";
import { CURATED_TENANT } from "../src/visibility.js";
import { ToolError } from "../src/errors.js";

function grant(h: SqliteEnv, recipe: string, tenant: string): void {
  h.raw
    .prepare("INSERT OR IGNORE INTO recipe_imports (recipe, tenant, member, via, imported_at) VALUES (?, ?, ?, 'agent', '2026-01-01')")
    .run(recipe, tenant, tenant);
}

describe("loadDeploymentProfile — the one accessor", () => {
  it("resolves self-hosted with no singleton row, a NULL column, and an explicit value", async () => {
    const h = sqliteEnv();
    expect(await loadDeploymentProfile(h.env)).toBe("self-hosted"); // no row at all
    h.raw.exec("INSERT INTO operator_config (id, favorite_weight) VALUES (1, 0.2)");
    expect(await loadDeploymentProfile(h.env)).toBe("self-hosted"); // row, NULL column
    h.raw.exec("UPDATE operator_config SET deployment_profile = 'saas' WHERE id = 1");
    expect(await loadDeploymentProfile(h.env)).toBe("saas");
  });
});

describe("the flip guards (validateProfileFlip)", () => {
  it("a no-op write passes in both directions", async () => {
    const h = sqliteEnv();
    expect(await validateProfileFlip(h.env, "self-hosted", {})).toBeNull();
    await saveDeploymentConfig(h.env, { profile: "saas" });
    expect(await validateProfileFlip(h.env, "saas", {})).toBeNull();
  });

  it("self-hosted → SaaS needs the explicit confirm (needsConfirm ships back)", async () => {
    const h = sqliteEnv();
    const err = await validateProfileFlip(h.env, "saas", {});
    expect(err).toBeInstanceOf(ToolError);
    expect(err).toMatchObject({
      code: "validation_failed",
      context: { field: "deployment_profile", needsConfirm: true },
    });
    expect(await validateProfileFlip(h.env, "saas", { confirm: true })).toBeNull();
  });

  it("SaaS → self-hosted is REFUSED while >1 household owns a non-empty cookbook — confirm cannot override", async () => {
    const h = sqliteEnv();
    await saveDeploymentConfig(h.env, { profile: "saas" });
    grant(h, "a-dish", "casey");
    grant(h, "b-dish", "pat");
    grant(h, "starter", CURATED_TENANT); // curated grants never count toward the guard
    for (const confirm of [false, true]) {
      const err = await validateProfileFlip(h.env, "self-hosted", { confirm });
      expect(err).toMatchObject({ code: "conflict", context: { guard: "consent_inversion", households: 2 } });
    }
  });

  it("a single-household deployment (curated grants aside) may flip back", async () => {
    const h = sqliteEnv();
    await saveDeploymentConfig(h.env, { profile: "saas" });
    grant(h, "a-dish", "casey");
    grant(h, "starter", CURATED_TENANT);
    expect(await validateProfileFlip(h.env, "self-hosted", {})).toBeNull();
  });
});

describe("the admin operation (putDeploymentConfig) — no write on refusal", () => {
  it("writes the flag only through the guards; a refused flip leaves the profile untouched", async () => {
    const h = sqliteEnv();
    // Needs-confirm bounce first, then the confirmed write.
    await expect(putDeploymentConfig(h.env, { profile: "saas" })).rejects.toMatchObject({
      code: "validation_failed",
      context: { needsConfirm: true },
    });
    expect(await loadDeploymentProfile(h.env)).toBe("self-hosted"); // nothing written
    const { config } = await putDeploymentConfig(h.env, { profile: "saas", confirm: true });
    expect(config.profile).toBe("saas");
    expect(config.profileSet).toBe(true);
    // Two granted households → the inversion guard refuses and writes nothing.
    grant(h, "a", "casey");
    grant(h, "b", "pat");
    await expect(putDeploymentConfig(h.env, { profile: "self-hosted", confirm: true })).rejects.toMatchObject({
      code: "conflict",
    });
    expect(await loadDeploymentProfile(h.env)).toBe("saas");
  });

  it("rejects an off-vocabulary profile value", async () => {
    const h = sqliteEnv();
    await expect(putDeploymentConfig(h.env, { profile: "multi" })).rejects.toMatchObject({ code: "validation_failed" });
  });
});

describe("the curated-source knob", () => {
  it("defaults to the compiled product feed; repoints; disables on clear; resets on null", async () => {
    const h = sqliteEnv();
    let { config } = await getDeploymentConfig(h.env);
    expect(config.curatedSourceState).toBe("default");
    expect(config.curatedSourceUrl).toBe(DEFAULT_CURATED_SOURCE_URL);
    expect(config.curatedSourceDefault).toBe(DEFAULT_CURATED_SOURCE_URL);

    ({ config } = await putDeploymentConfig(h.env, { curated_source_url: "https://example.com/my-fork.xml" }));
    expect(config).toMatchObject({ curatedSourceState: "custom", curatedSourceUrl: "https://example.com/my-fork.xml" });

    ({ config } = await putDeploymentConfig(h.env, { curated_source_url: "" }));
    expect(config).toMatchObject({ curatedSourceState: "disabled", curatedSourceUrl: null });

    ({ config } = await putDeploymentConfig(h.env, { curated_source_url: null }));
    expect(config).toMatchObject({ curatedSourceState: "default", curatedSourceUrl: DEFAULT_CURATED_SOURCE_URL });
  });

  it("rejects a non-public repoint (the feed-url bar) and leaves the stored value alone", async () => {
    const h = sqliteEnv();
    await expect(saveDeploymentConfig(h.env, { curatedSourceUrl: "http://127.0.0.1/feed" })).rejects.toBeInstanceOf(ToolError);
    expect((await loadDeploymentConfig(h.env)).curatedSourceState).toBe("default");
  });

  it("a curated-source write never touches the profile column (and vice versa)", async () => {
    const h = sqliteEnv();
    await saveDeploymentConfig(h.env, { profile: "saas" });
    await saveDeploymentConfig(h.env, { curatedSourceUrl: "" });
    const { config } = await getDeploymentConfig(h.env);
    expect(config.profile).toBe("saas");
    expect(config.curatedSourceState).toBe("disabled");
  });
});
