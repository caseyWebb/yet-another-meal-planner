// Tests for scripts/merge-wrangler-config.mjs — the deploy's config merge + KV-id pin.
// The KV-id / vars provenance cases are security-critical: the code repo's config is the
// maintainer's, so its ids/vars must never appear in another operator's deployed config.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mergeWranglerConfig,
  pinKvIds,
  pinD1Ids,
  pinBindingIds,
  bindingIdsChanged,
} from "../scripts/merge-wrangler-config.mjs";

// The maintainer's (code repo) config — carries real ids/vars that must NOT propagate.
const code = {
  name: "yamp",
  main: "src/index.ts",
  workers_dev: false,
  compatibility_date: "2025-06-01",
  compatibility_flags: ["nodejs_compat"],
  // The maintainer's own (non-secret) vars, if any — they must NEVER reach an operator.
  vars: {
    MAINTAINER_VAR: "maintainer-only-139471207",
  },
  kv_namespaces: [
    { binding: "KROGER_KV", id: "MAINTAINER_KROGER" },
    { binding: "TENANT_KV", id: "MAINTAINER_TENANT" },
    { binding: "OAUTH_KV", id: "MAINTAINER_OAUTH" },
  ],
  d1_databases: [
    { binding: "DB", database_name: "yamp", migrations_dir: "migrations/d1", database_id: "MAINTAINER_DB" },
  ],
  triggers: { crons: ["*/5 * * * *"] },
  observability: { enabled: true },
  ai: { binding: "AI" },
  // Mirrors the real wrangler.jsonc `assets` block (member-app-shell): the SPA fallback +
  // the full Worker-owned-path enumeration must survive the merge VERBATIM.
  assets: {
    directory: "./assets",
    binding: "ASSETS",
    not_found_handling: "single-page-application",
    run_worker_first: [
      "/mcp",
      "/mcp/*",
      "/token",
      "/register",
      "/.well-known/*",
      "/authorize",
      "/oauth/*",
      "/satellite/*",
      "/api",
      "/api/*",
      "/admin",
      "/admin/*",
      "/cookbook",
      "/cookbook/*",
      "/health",
      "/health.svg",
      "/source",
    ],
  },
  r2_buckets: [{ binding: "CORPUS", bucket_name: "yamp-corpus" }],
  analytics_engine_datasets: [
    { binding: "USAGE_AE", dataset: "yamp_usage" },
    { binding: "TOOL_AE", dataset: "yamp_tool" },
    { binding: "AI_AE", dataset: "yamp_ai" },
  ],
};

// A slim operator config (post-template).
const operator = {
  vars: { OPERATOR_VAR: "op" },
};

test("code-level triggers propagate when the operator lacks them", () => {
  const out = mergeWranglerConfig(code, operator);
  assert.deepEqual(out.triggers, { crons: ["*/5 * * * *"] });
});

test("the Workers AI binding propagates verbatim from code (no operator id/secret to strip)", () => {
  const out = mergeWranglerConfig(code, operator); // operator declares no `ai`
  assert.deepEqual(out.ai, { binding: "AI" });
});

test("the Workers Static Assets binding propagates verbatim from code (member SPA + admin)", () => {
  // Regression pin for the member-app-foundations change: the merge propagates `assets`
  // as a WHOLE-OBJECT copy, so `not_found_handling` (the SPA fallback) and the complete
  // `run_worker_first` enumeration reach every operator's deployed config untouched. A
  // future merge refactor that goes per-sub-key would silently drop them — the SPA shell
  // would then swallow every Worker-owned route on the next operator deploy.
  const out = mergeWranglerConfig(code, operator); // operator declares no `assets`
  assert.deepEqual(out.assets, code.assets);
  assert.equal(out.assets.not_found_handling, "single-page-application");
  assert.deepEqual(out.assets.run_worker_first, [
    "/mcp",
    "/mcp/*",
    "/token",
    "/register",
    "/.well-known/*",
    "/authorize",
    "/oauth/*",
    "/satellite/*",
    "/api",
    "/api/*",
    "/admin",
    "/admin/*",
    "/cookbook",
    "/cookbook/*",
    "/health",
    "/health.svg",
    "/source",
  ]);
});

test("the R2 corpus bucket binding propagates verbatim from code (the silent-drop trap)", () => {
  const out = mergeWranglerConfig(code, operator); // operator declares no `r2_buckets`
  assert.deepEqual(out.r2_buckets, [{ binding: "CORPUS", bucket_name: "yamp-corpus" }]);
});

test("all three Analytics Engine dataset bindings propagate verbatim from code (the silent-drop trap)", () => {
  // usage-trends + tool-usage-trends + ai-usage-attribution: the merge copies the WHOLE array by
  // type, so the SECOND and THIRD dataset instances ride through. WITHOUT the allowlist line
  // `env.USAGE_AE` (per-job), `env.TOOL_AE` (per-tool-call), and `env.AI_AE` (per-AI-call) are all
  // undefined and every operator's points vanish.
  const out = mergeWranglerConfig(code, operator); // operator declares no analytics_engine_datasets
  assert.deepEqual(out.analytics_engine_datasets, [
    { binding: "USAGE_AE", dataset: "yamp_usage" },
    { binding: "TOOL_AE", dataset: "yamp_tool" },
    { binding: "AI_AE", dataset: "yamp_ai" },
  ]);
});

test("compatibility settings come from code even if the operator differs", () => {
  const out = mergeWranglerConfig(code, { ...operator, compatibility_date: "2020-01-01", compatibility_flags: [] });
  assert.equal(out.compatibility_date, "2025-06-01");
  assert.deepEqual(out.compatibility_flags, ["nodejs_compat"]);
  assert.equal(out.main, "src/index.ts");
  assert.deepEqual(out.observability, { enabled: true });
});

test("operator surface choices win (name, workers_dev, routes)", () => {
  const out = mergeWranglerConfig(code, {
    ...operator,
    name: "my-grocery",
    workers_dev: true,
    routes: [{ pattern: "grocery.example.com", custom_domain: true }],
  });
  assert.equal(out.name, "my-grocery");
  assert.equal(out.workers_dev, true);
  assert.deepEqual(out.routes, [{ pattern: "grocery.example.com", custom_domain: true }]);
});

test("vars are the operator's only — the maintainer's vars never leak", () => {
  const out = mergeWranglerConfig(code, operator);
  assert.deepEqual(out.vars, { OPERATOR_VAR: "op" });
  // The maintainer's own vars must NOT appear in the deployed config.
  assert.equal(out.vars.MAINTAINER_VAR, undefined);
  assert.ok(!JSON.stringify(out).includes("139471207"));
});

test("Instacart environment stays operator-owned and no maintainer key or default propagates", () => {
  const out = mergeWranglerConfig(
    { ...code, vars: { ...code.vars, INSTACART_API_ENV: "production", INSTACART_API_KEY: "never-copy" } },
    { ...operator, vars: { ...operator.vars, INSTACART_API_ENV: "development" } },
  );
  assert.equal(out.vars.INSTACART_API_ENV, "development");
  assert.equal(out.vars.INSTACART_API_KEY, undefined);
  assert.equal(Object.hasOwn(out, "secrets"), false);
});

test("KV: operator id wins and the code repo's id never appears", () => {
  const out = mergeWranglerConfig(code, {
    ...operator,
    kv_namespaces: [{ binding: "KROGER_KV", id: "OPERATOR_KROGER" }],
  });
  const kroger = out.kv_namespaces.find((n) => n.binding === "KROGER_KV");
  assert.equal(kroger.id, "OPERATOR_KROGER");
  // No maintainer KV id anywhere in the output.
  const blob = JSON.stringify(out);
  for (const id of ["MAINTAINER_KROGER", "MAINTAINER_TENANT", "MAINTAINER_OAUTH", "MAINTAINER_DB"]) {
    assert.ok(!blob.includes(id), `code id ${id} leaked into the deployed config`);
  }
});

test("a code-only binding deploys without an id (auto-provision)", () => {
  const out = mergeWranglerConfig(code, operator); // operator declares no KV
  // every code binding is present, all id-less
  assert.deepEqual(
    out.kv_namespaces,
    [{ binding: "KROGER_KV" }, { binding: "TENANT_KV" }, { binding: "OAUTH_KV" }],
  );
});

test("an operator-declared id-less binding stays id-less", () => {
  const out = mergeWranglerConfig(code, { ...operator, kv_namespaces: [{ binding: "KROGER_KV" }] });
  const kroger = out.kv_namespaces.find((n) => n.binding === "KROGER_KV");
  assert.equal(kroger.id, undefined);
});

// --- KV_NAMESPACE_LABELS (usage-observability: Fix 3 — deploy-derived namespace labels) ---

test("KV_NAMESPACE_LABELS is derived from the merged kv_namespaces (id:BINDING,...), coexisting with operator vars", () => {
  const out = mergeWranglerConfig(code, {
    ...operator,
    kv_namespaces: [
      { binding: "KROGER_KV", id: "OP_KROGER" },
      { binding: "TENANT_KV", id: "OP_TENANT" },
      { binding: "OAUTH_KV", id: "OP_OAUTH" },
    ],
  });
  assert.equal(out.vars.KV_NAMESPACE_LABELS, "OP_KROGER:KROGER_KV,OP_TENANT:TENANT_KV,OP_OAUTH:OAUTH_KV");
  // Coexists with the operator's other vars — doesn't clobber them.
  assert.equal(out.vars.OPERATOR_VAR, "op");
});

test("KV_NAMESPACE_LABELS only includes namespaces with a provisioned id, omitting id-less ones", () => {
  const out = mergeWranglerConfig(code, {
    ...operator,
    kv_namespaces: [{ binding: "KROGER_KV", id: "OP_KROGER" }], // TENANT_KV/OAUTH_KV left id-less
  });
  assert.equal(out.vars.KV_NAMESPACE_LABELS, "OP_KROGER:KROGER_KV");
});

test("KV_NAMESPACE_LABELS is ABSENT (not an empty string) when no namespace has a provisioned id yet (cold start)", () => {
  const out = mergeWranglerConfig(code, operator); // operator declares no kv_namespaces -> all id-less
  assert.equal(out.vars.KV_NAMESPACE_LABELS, undefined);
  // vars still present for the operator's own var, just without the label key.
  assert.equal(out.vars.OPERATOR_VAR, "op");
});

test("KV_NAMESPACE_LABELS still gets set even when the operator declares no other vars", () => {
  const bareOperator = { kv_namespaces: [{ binding: "KROGER_KV", id: "OP_KROGER" }] };
  const out = mergeWranglerConfig(code, bareOperator);
  assert.equal(out.vars.KV_NAMESPACE_LABELS, "OP_KROGER:KROGER_KV");
});

test("KV_NAMESPACE_LABELS wins over an operator-authored value of the same var (deploy-derived is authoritative)", () => {
  const out = mergeWranglerConfig(code, {
    vars: { KV_NAMESPACE_LABELS: "stale:HAND_AUTHORED" },
    kv_namespaces: [{ binding: "KROGER_KV", id: "OP_KROGER" }],
  });
  assert.equal(out.vars.KV_NAMESPACE_LABELS, "OP_KROGER:KROGER_KV");
});

test("the deployed config only contains the curated key set", () => {
  const out = mergeWranglerConfig(code, operator);
  const allowed = new Set([
    "name", "main", "workers_dev", "compatibility_date", "compatibility_flags",
    "triggers", "observability", "vars", "kv_namespaces", "d1_databases", "ai", "assets", "r2_buckets",
    "analytics_engine_datasets", "routes", "route",
  ]);
  for (const k of Object.keys(out)) assert.ok(allowed.has(k), `unexpected key in deployed config: ${k}`);
});

test("pinKvIds patches provisioned ids into the operator config by binding, creating kv_namespaces", () => {
  const deployed = {
    kv_namespaces: [
      { binding: "KROGER_KV", id: "PROV_KROGER" },
      { binding: "TENANT_KV", id: "PROV_TENANT" },
      { binding: "OAUTH_KV", id: "PROV_OAUTH" },
    ],
  };
  const out = pinKvIds(deployed, operator); // operator has no kv_namespaces
  assert.deepEqual(out.kv_namespaces, [
    { binding: "KROGER_KV", id: "PROV_KROGER" },
    { binding: "TENANT_KV", id: "PROV_TENANT" },
    { binding: "OAUTH_KV", id: "PROV_OAUTH" },
  ]);
  // other operator keys preserved
  assert.deepEqual(out.vars, { OPERATOR_VAR: "op" });
});

test("pinKvIds is a no-op when nothing was provisioned", () => {
  const deployed = { kv_namespaces: [{ binding: "KROGER_KV" }] }; // id-less
  const out = pinKvIds(deployed, operator);
  assert.deepEqual(out, operator);
});

test("bindingIdsChanged (KV): false when ids already match (existing/manual operator — pin stays silent)", () => {
  const existing = { vars: { OPERATOR_VAR: "OP" }, kv_namespaces: [
    { binding: "KROGER_KV", id: "K" }, { binding: "TENANT_KV", id: "T" }, { binding: "OAUTH_KV", id: "O" },
  ] };
  const deployed = { kv_namespaces: [
    { binding: "KROGER_KV", id: "K" }, { binding: "TENANT_KV", id: "T" }, { binding: "OAUTH_KV", id: "O" },
  ] };
  assert.equal(bindingIdsChanged(existing, pinKvIds(deployed, existing)), false);
});

test("bindingIdsChanged (KV): true when a fresh id is provisioned (id-less -> id)", () => {
  const before = { kv_namespaces: [{ binding: "KROGER_KV" }] };
  const deployed = { kv_namespaces: [{ binding: "KROGER_KV", id: "NEW" }] };
  assert.equal(bindingIdsChanged(before, pinKvIds(deployed, before)), true);
});

test("bindingIdsChanged (KV): true when an id changes", () => {
  const before = { kv_namespaces: [{ binding: "KROGER_KV", id: "OLD" }] };
  const after = { kv_namespaces: [{ binding: "KROGER_KV", id: "NEW" }] };
  assert.equal(bindingIdsChanged(before, after), true);
});

// --- D1 (cloudflare-data-platform): mirrors the KV provenance/pin rules ---

test("D1: the binding + code metadata propagate, id-less, when the operator declares none", () => {
  const out = mergeWranglerConfig(code, operator); // operator declares no D1
  assert.deepEqual(out.d1_databases, [
    { binding: "DB", database_name: "yamp", migrations_dir: "migrations/d1" },
  ]);
  // The maintainer's database_id must NOT appear.
  assert.ok(!JSON.stringify(out).includes("MAINTAINER_DB"));
});

test("D1: operator database_id wins and the code repo's id never appears", () => {
  const out = mergeWranglerConfig(code, {
    ...operator,
    d1_databases: [{ binding: "DB", database_id: "OPERATOR_DB" }],
  });
  const db = out.d1_databases.find((d) => d.binding === "DB");
  assert.equal(db.database_id, "OPERATOR_DB");
  // code metadata is still carried from the code repo
  assert.equal(db.database_name, "yamp");
  assert.equal(db.migrations_dir, "migrations/d1");
  assert.ok(!JSON.stringify(out).includes("MAINTAINER_DB"));
});

test("D1: pinD1Ids patches a provisioned id into the operator config, creating d1_databases", () => {
  const deployed = { d1_databases: [{ binding: "DB", database_name: "yamp", database_id: "PROV_DB" }] };
  const out = pinD1Ids(deployed, operator); // operator has no d1_databases
  assert.deepEqual(out.d1_databases, [{ binding: "DB", database_id: "PROV_DB" }]);
  assert.deepEqual(out.vars, { OPERATOR_VAR: "op" });
});

test("D1: pinD1Ids is a no-op when nothing was provisioned (id-less deployed)", () => {
  const deployed = { d1_databases: [{ binding: "DB" }] };
  assert.deepEqual(pinD1Ids(deployed, operator), operator);
});

test("pinBindingIds pins KV and D1 ids in one pass", () => {
  const deployed = {
    kv_namespaces: [{ binding: "KROGER_KV", id: "PROV_KROGER" }],
    d1_databases: [{ binding: "DB", database_id: "PROV_DB" }],
  };
  const out = pinBindingIds(deployed, operator);
  assert.deepEqual(out.kv_namespaces, [{ binding: "KROGER_KV", id: "PROV_KROGER" }]);
  assert.deepEqual(out.d1_databases, [{ binding: "DB", database_id: "PROV_DB" }]);
});

test("bindingIdsChanged: true when a fresh D1 id is provisioned (id-less -> id)", () => {
  const before = { d1_databases: [{ binding: "DB" }] };
  const deployed = { d1_databases: [{ binding: "DB", database_id: "NEW" }] };
  assert.equal(bindingIdsChanged(before, pinBindingIds(deployed, before)), true);
});

test("bindingIdsChanged: false when both KV and D1 ids already match (pin stays silent)", () => {
  const existing = {
    kv_namespaces: [{ binding: "KROGER_KV", id: "K" }],
    d1_databases: [{ binding: "DB", database_id: "D" }],
  };
  const deployed = {
    kv_namespaces: [{ binding: "KROGER_KV", id: "K" }],
    d1_databases: [{ binding: "DB", database_id: "D" }],
  };
  assert.equal(bindingIdsChanged(existing, pinBindingIds(deployed, existing)), false);
});

test("bindingIdsChanged: true when only a KV id changes (D1 unchanged)", () => {
  const before = {
    kv_namespaces: [{ binding: "KROGER_KV", id: "OLD" }],
    d1_databases: [{ binding: "DB", database_id: "D" }],
  };
  const after = {
    kv_namespaces: [{ binding: "KROGER_KV", id: "NEW" }],
    d1_databases: [{ binding: "DB", database_id: "D" }],
  };
  assert.equal(bindingIdsChanged(before, after), true);
});
