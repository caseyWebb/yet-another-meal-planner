// Registration-time tool gating (mcp-tool-gating): the per-request RegistrationContext
// decides, per plane, which tools register at all — a gated tool appears in NO tools/list
// response and a call to it is the generic unknown-tool rejection, indistinguishable from a
// tool that never existed. Covers the registration matrix (member vs operator × Kroger on/off
// × Instacart on/off), the app-plane visibility metadata (commit_shop and its siblings never
// model-advertised), and `resolveRegistrationContext`'s own env/D1 detection.

import { describe, it, expect } from "vitest";
import {
  buildServer,
  resolveRegistrationContext,
  type RegistrationContext,
} from "../src/tools.js";
import { listRegisteredTools, withServer, invokeTool } from "./tool-harness.js";
import { sqliteEnv } from "./sqlite-d1.js";
import type { Env } from "../src/env.js";
import type { Tenant } from "../src/tenant.js";

const CALLER: Tenant = { id: "casey", member: "casey" };

// The member-surface enumeration (mcp-tool-gating "The member surface is the enumerated
// target set"): the 28 target tools, PLUS the in-flight registration owned by another
// change (add_night_vibe until remove-meal-dimension-shims closes), PLUS the one-window
// dispatch aliases while their window is open (toggle_favorite/toggle_reject,
// add_to_grocery_list/remove_from_grocery_list, list_guidance) — mirroring the
// `*_night_vibe` D21 precedent, these aliases dispatch onto their fused tool but are
// registered exactly like any other model-visible tool (no app-plane visibility
// restriction), so a stale plugin's persona can still see and call them. 34 names total;
// none of them carry app-only visibility. The ready-to-eat tools (add_draft_ready_to_eat,
// update_ready_to_eat, ready_to_eat_available below) are gone (remove-ready-to-eat) — see
// the "removed tools never come back" assertion.
const MEMBER_BASE_SET = [
  // reads
  "read_user_profile",
  "read_pantry",
  "read_to_buy",
  "read_meal_plan",
  "search_recipes",
  "read_recipe",
  "read_recipe_notes",
  // engine
  "propose_meal_plan",
  // widgets (model-visible verbs)
  "display_recipe",
  "display_meal_plan",
  "display_grocery_list",
  // writes
  "update_meal_plan",
  "update_pantry",
  "update_grocery_list",
  "log_cooked",
  "set_recipe_disposition",
  "add_recipe_note",
  "add_meal_vibe",
  "import_recipe",
  "add_store",
  "add_store_note",
  // config
  "update_preferences",
  "update_taste",
  "update_diet_principles",
  // signals
  "list_new_for_me",
  "retrospective",
  // narration
  "read_guidance",
  // escape
  "report_bug",
  // in-flight registration owned by another change
  "add_night_vibe",
  // one-window dispatch aliases (mcp-tool-gating D3), model-visible while open
  "toggle_favorite",
  "toggle_reject",
  "add_to_grocery_list",
  "remove_from_grocery_list",
  "list_guidance",
];

// The Kroger tool set (mcp-tool-gating "Store-integration tools register only when
// their integration is configured"): flyer (the kroger_flyer/store_flyer fusion),
// kroger_prices, display_order_review (+ its app-plane review ops), place_order, and
// kroger_login_url. compare_unit_price and match_ingredient_to_kroger_sku are cut
// entirely (ingredient-matching) — not Kroger-gated, just gone; ready_to_eat_available
// (formerly gated here too) is gone outright (remove-ready-to-eat).
const KROGER_TOOLS = [
  "kroger_login_url",
  "kroger_prices",
  "flyer",
  "place_order",
  "display_order_review",
  "read_order_review",
  "search_order_broader",
  "search_order_catalog",
  "save_order_brand_preference",
];
const INSTACART_TOOLS = ["create_instacart_handoff"];
const OPERATOR_TOOLS = ["list_proposals", "confirm_proposal", "reconcile_read_signals", "reconcile_enqueue_proposal"];

// Every app-plane op (never model-advertised, regardless of gating) — asserted absent
// from the model-visible set in every cell, and present (registered) per its own gate.
const APP_ONLY_TOOLS = [
  "commit_shop",
  "read_grocery_snapshot",
  "grocery_add",
  "grocery_remove",
  "set_grocery_checked",
  "set_grocery_buy_anyway",
  "verify_grocery_pantry",
  "set_grocery_substitution",
  "relist_grocery_send_line",
  "mark_grocery_send_placed",
];
const KROGER_APP_ONLY_TOOLS = ["read_order_review", "search_order_broader", "search_order_catalog", "save_order_brand_preference"];

function ctxOf(operator: boolean, kroger: boolean, instacart: boolean): RegistrationContext {
  return { profile: "self-hosted", operator, kroger, instacart };
}

async function namesFor(env: Env, ctx: RegistrationContext): Promise<Set<string>> {
  const server = buildServer(env, CALLER, "https://yamp.example.com", ctx);
  const tools = await listRegisteredTools(server);
  return new Set(tools.map((t) => t.name));
}

/** The app-only visibility marker: exactly `["app"]`, never including "model". */
function isAppOnly(meta: Record<string, unknown> | undefined): boolean {
  const vis = (meta as { ui?: { visibility?: unknown } } | undefined)?.ui?.visibility;
  return Array.isArray(vis) && vis.length === 1 && vis[0] === "app";
}

/** The MODEL-VISIBLE registered set: every registered tool EXCEPT those carrying the
 *  app-only visibility marker — what a real MCP client's `tools/list` shows the model. */
async function modelVisibleNamesFor(env: Env, ctx: RegistrationContext): Promise<Set<string>> {
  const server = buildServer(env, CALLER, "https://yamp.example.com", ctx);
  const tools = await listRegisteredTools(server);
  return new Set(tools.filter((t) => !isAppOnly(t.meta)).map((t) => t.name));
}

describe("registration matrix — member vs operator × Kroger on/off × Instacart on/off", () => {
  it("gates each plane's tool set exactly on its ctx flag, independent of the others", async () => {
    const { env } = sqliteEnv(["casey"]);
    for (const operator of [false, true]) {
      for (const kroger of [false, true]) {
        for (const instacart of [false, true]) {
          const names = await namesFor(env, ctxOf(operator, kroger, instacart));
          for (const name of MEMBER_BASE_SET) {
            expect(names.has(name), `expected always-present ${name} in cell (operator:${operator}, kroger:${kroger}, instacart:${instacart})`).toBe(true);
          }
          for (const name of KROGER_TOOLS) {
            expect(names.has(name), `${name} gating mismatch in cell (operator:${operator}, kroger:${kroger}, instacart:${instacart})`).toBe(kroger);
          }
          for (const name of INSTACART_TOOLS) {
            expect(names.has(name), `${name} gating mismatch in cell (operator:${operator}, kroger:${kroger}, instacart:${instacart})`).toBe(instacart);
          }
          for (const name of OPERATOR_TOOLS) {
            expect(names.has(name), `${name} gating mismatch in cell (operator:${operator}, kroger:${kroger}, instacart:${instacart})`).toBe(operator);
          }
          // Removed tools never come back regardless of gating — including the three
          // ready-to-eat tools (remove-ready-to-eat): hard removal, no alias, no stub.
          for (const name of [
            "kroger_flyer",
            "store_flyer",
            "compare_unit_price",
            "match_ingredient_to_kroger_sku",
            "update_recipe",
            "parse_recipe",
            "create_recipe",
            "ready_to_eat_available",
            "add_draft_ready_to_eat",
            "update_ready_to_eat",
          ]) {
            expect(names.has(name), `${name} should never be registered`).toBe(false);
          }
        }
      }
    }
  });

  it("the model-visible surface on a fully-configured member deployment is EXACTLY the enumerated target set", async () => {
    const { env } = sqliteEnv(["casey"]);
    const names = await modelVisibleNamesFor(env, ctxOf(false, true, true));
    const expected = new Set([...MEMBER_BASE_SET, ...KROGER_TOOLS.filter((n) => !KROGER_APP_ONLY_TOOLS.includes(n)), ...INSTACART_TOOLS]);
    expect(names).toEqual(expected);
  });

  it("the model-visible surface on a walk-only (no Kroger, no Instacart) member deployment is EXACTLY the base set", async () => {
    const { env } = sqliteEnv(["casey"]);
    const names = await modelVisibleNamesFor(env, ctxOf(false, false, false));
    expect(names).toEqual(new Set(MEMBER_BASE_SET));
  });

  it("the operator session additionally carries EXACTLY the reconcile/proposal plane on top of the member set", async () => {
    const { env } = sqliteEnv(["casey"]);
    const names = await modelVisibleNamesFor(env, ctxOf(true, true, true));
    const expected = new Set([
      ...MEMBER_BASE_SET,
      ...KROGER_TOOLS.filter((n) => !KROGER_APP_ONLY_TOOLS.includes(n)),
      ...INSTACART_TOOLS,
      ...OPERATOR_TOOLS,
    ]);
    expect(names).toEqual(expected);
  });

  it("an unregistered tool call gets the generic unknown-tool rejection, not insufficient_permission", async () => {
    const { env } = sqliteEnv(["casey"]);
    const server = buildServer(env, CALLER, "https://yamp.example.com", ctxOf(false, false, false));
    const out = await withServer(server, (c) => invokeTool(c, "reconcile_read_signals", {}));
    expect(out.isError).toBe(true);
    expect(out.result).toMatchObject({ error: "not_found" });
    expect(JSON.stringify(out.result)).not.toMatch(/insufficient_permission/);
  });

  it("a stale call to a hard-removed tool gets the generic unknown-tool rejection (no shim)", async () => {
    const { env } = sqliteEnv(["casey"]);
    const server = buildServer(env, CALLER, "https://yamp.example.com", ctxOf(false, true, true));
    for (const name of [
      "save_guidance",
      "update_kitchen",
      "mark_pantry_verified",
      "create_recipe",
      "parse_recipe",
      "kroger_flyer",
      "store_flyer",
      "ready_to_eat_available",
      "add_draft_ready_to_eat",
      "update_ready_to_eat",
    ]) {
      const out = await withServer(server, (c) => invokeTool(c, name, {}));
      expect(out.isError, `${name} should be rejected`).toBe(true);
      expect(out.result, `${name} should be not_found, not a shim`).toMatchObject({ error: "not_found" });
    }
  });
});

describe("app-plane visibility — widget-callable ops never model-advertised", () => {
  const MODEL_VISIBLE_WIDGETS = ["display_grocery_list", "display_order_review", "display_recipe", "display_meal_plan"];
  // The three alias families (mcp-tool-gating D3): registered as plain, fully
  // model-visible dispatch tools during the window — NOT app-plane-restricted — the
  // same mechanism as the `*_night_vibe` precedent, so a stale plugin's persona (which
  // still only knows the old names) can actually see and call them. Only at window
  // close do toggle_favorite/toggle_reject flip to app-plane-only (design D2); that is
  // NOT this change's job.
  const ALIASES_MODEL_VISIBLE = ["toggle_favorite", "toggle_reject", "add_to_grocery_list", "remove_from_grocery_list", "list_guidance"];

  it("every app-plane op carries _meta.ui.visibility: [\"app\"]; commit_shop no longer leaks", async () => {
    const { env } = sqliteEnv(["casey"]);
    const server = buildServer(env, CALLER, "https://yamp.example.com", ctxOf(false, true, true));
    const tools = await listRegisteredTools(server);
    const byName = new Map(tools.map((t) => [t.name, t.meta]));
    for (const name of [...APP_ONLY_TOOLS, ...KROGER_APP_ONLY_TOOLS]) {
      const meta = byName.get(name);
      expect(meta, `${name} should be registered`).toBeDefined();
      expect((meta as { ui?: { visibility?: string[] } } | undefined)?.ui?.visibility, `${name} should be app-only`).toEqual(["app"]);
    }
  });

  it("the display_* widget tools stay model-visible (no restrictive visibility)", async () => {
    const { env } = sqliteEnv(["casey"]);
    const server = buildServer(env, CALLER, "https://yamp.example.com", ctxOf(false, true, true));
    const tools = await listRegisteredTools(server);
    const byName = new Map(tools.map((t) => [t.name, t.meta]));
    for (const name of MODEL_VISIBLE_WIDGETS) {
      const meta = byName.get(name) as { ui?: { visibility?: string[] } } | undefined;
      expect(meta?.ui?.visibility, `${name} should not be visibility-restricted`).toBeUndefined();
    }
  });

  it("the one-window dispatch aliases are hidden from NO plane — registered plain and model-visible, not app-restricted", async () => {
    const { env } = sqliteEnv(["casey"]);
    const server = buildServer(env, CALLER, "https://yamp.example.com", ctxOf(false, true, true));
    const tools = await listRegisteredTools(server);
    const names = new Set(tools.map((t) => t.name));
    const byName = new Map(tools.map((t) => [t.name, t.meta]));
    for (const name of ALIASES_MODEL_VISIBLE) {
      expect(names.has(name), `${name} should be registered`).toBe(true);
      const meta = byName.get(name) as { ui?: { visibility?: string[] } } | undefined;
      expect(meta?.ui?.visibility, `${name} should not be visibility-restricted (it must stay callable by a stale model)`).toBeUndefined();
    }
  });

  it("commit_shop is registered (widget-callable) even when its plane's own gates are off", async () => {
    // commit_shop rides no ctx gate at all (it is a grocery-widget op, not Kroger/Instacart/
    // operator-scoped) — it is always registered, just never model-visible.
    const { env } = sqliteEnv(["casey"]);
    const names = await namesFor(env, ctxOf(false, false, false));
    expect(names.has("commit_shop")).toBe(true);
  });
});

describe("resolveRegistrationContext — the env/D1 detection the gates key on", () => {
  function envWithKroger(id?: string, secret?: string): Env {
    const { env } = sqliteEnv(["casey"]);
    return { ...env, KROGER_CLIENT_ID: id, KROGER_CLIENT_SECRET: secret } as unknown as Env;
  }

  it("kroger is true only when BOTH client id and secret are non-empty", async () => {
    expect((await resolveRegistrationContext(envWithKroger(undefined, undefined), CALLER)).kroger).toBe(false);
    expect((await resolveRegistrationContext(envWithKroger("id", undefined), CALLER)).kroger).toBe(false);
    expect((await resolveRegistrationContext(envWithKroger("id", ""), CALLER)).kroger).toBe(false);
    expect((await resolveRegistrationContext(envWithKroger("  ", "secret"), CALLER)).kroger).toBe(false);
    expect((await resolveRegistrationContext(envWithKroger("id", "secret"), CALLER)).kroger).toBe(true);
  });

  it("instacart is true only when getInstacartConfig resolves (key + a known environment)", async () => {
    const { env } = sqliteEnv(["casey"]);
    const none = { ...env } as unknown as Env;
    const badEnv = { ...env, INSTACART_API_KEY: "k", INSTACART_API_ENV: "staging" } as unknown as Env;
    const ok = { ...env, INSTACART_API_KEY: "k", INSTACART_API_ENV: "development" } as unknown as Env;
    expect((await resolveRegistrationContext(none, CALLER)).instacart).toBe(false);
    expect((await resolveRegistrationContext(badEnv, CALLER)).instacart).toBe(false);
    expect((await resolveRegistrationContext(ok, CALLER)).instacart).toBe(true);
  });

  it("operator is true only for the tenant matching OWNER_TENANT_ID (case-insensitive)", async () => {
    const { env } = sqliteEnv(["casey"]);
    const noOwner = { ...env } as unknown as Env;
    const otherOwner = { ...env, OWNER_TENANT_ID: "pat" } as unknown as Env;
    const sameOwner = { ...env, OWNER_TENANT_ID: "Casey" } as unknown as Env;
    expect((await resolveRegistrationContext(noOwner, CALLER)).operator).toBe(false);
    expect((await resolveRegistrationContext(otherOwner, CALLER)).operator).toBe(false);
    expect((await resolveRegistrationContext(sameOwner, CALLER)).operator).toBe(true);
  });

  it("profile defaults to self-hosted with no operator_config row and follows the D1 singleton", async () => {
    const h = sqliteEnv(["casey"]);
    expect((await resolveRegistrationContext(h.env, CALLER)).profile).toBe("self-hosted");
    h.raw.exec("INSERT INTO operator_config (id, deployment_profile) VALUES (1, 'saas')");
    expect((await resolveRegistrationContext(h.env, CALLER)).profile).toBe("saas");
  });
});
