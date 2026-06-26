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
  name: "grocery-mcp",
  main: "src/index.ts",
  workers_dev: false,
  compatibility_date: "2025-06-01",
  compatibility_flags: ["nodejs_compat"],
  vars: {
    GITHUB_APP_ID: "4022505",
    GITHUB_INSTALLATION_ID: "139471207",
    DATA_OWNER: "caseyWebb",
    DATA_REPO: "groceries-agent-data",
    DATA_REF: "main",
  },
  kv_namespaces: [
    { binding: "KROGER_KV", id: "MAINTAINER_KROGER" },
    { binding: "TENANT_KV", id: "MAINTAINER_TENANT" },
    { binding: "OAUTH_KV", id: "MAINTAINER_OAUTH" },
  ],
  d1_databases: [
    { binding: "DB", database_name: "grocery-mcp", migrations_dir: "migrations/d1", database_id: "MAINTAINER_DB" },
  ],
  triggers: { crons: ["*/5 * * * *"] },
  observability: { enabled: true },
  ai: { binding: "AI" },
};

// A slim operator config (post-template).
const operator = {
  vars: { GITHUB_APP_ID: "9999999" },
};

test("code-level triggers propagate when the operator lacks them", () => {
  const out = mergeWranglerConfig(code, operator);
  assert.deepEqual(out.triggers, { crons: ["*/5 * * * *"] });
});

test("the Workers AI binding propagates verbatim from code (no operator id/secret to strip)", () => {
  const out = mergeWranglerConfig(code, operator); // operator declares no `ai`
  assert.deepEqual(out.ai, { binding: "AI" });
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
  assert.deepEqual(out.vars, { GITHUB_APP_ID: "9999999" });
  // The maintainer's install id / data coords must NOT appear.
  assert.equal(out.vars.GITHUB_INSTALLATION_ID, undefined);
  assert.equal(out.vars.DATA_OWNER, undefined);
  assert.ok(!JSON.stringify(out).includes("139471207"));
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

test("the deployed config only contains the curated key set", () => {
  const out = mergeWranglerConfig(code, operator);
  const allowed = new Set([
    "name", "main", "workers_dev", "compatibility_date", "compatibility_flags",
    "triggers", "observability", "vars", "kv_namespaces", "d1_databases", "ai", "routes", "route",
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
  assert.deepEqual(out.vars, { GITHUB_APP_ID: "9999999" });
});

test("pinKvIds is a no-op when nothing was provisioned", () => {
  const deployed = { kv_namespaces: [{ binding: "KROGER_KV" }] }; // id-less
  const out = pinKvIds(deployed, operator);
  assert.deepEqual(out, operator);
});

test("bindingIdsChanged (KV): false when ids already match (existing/manual operator — pin stays silent)", () => {
  const existing = { vars: { GITHUB_APP_ID: "OP" }, kv_namespaces: [
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
    { binding: "DB", database_name: "grocery-mcp", migrations_dir: "migrations/d1" },
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
  assert.equal(db.database_name, "grocery-mcp");
  assert.equal(db.migrations_dir, "migrations/d1");
  assert.ok(!JSON.stringify(out).includes("MAINTAINER_DB"));
});

test("D1: pinD1Ids patches a provisioned id into the operator config, creating d1_databases", () => {
  const deployed = { d1_databases: [{ binding: "DB", database_name: "grocery-mcp", database_id: "PROV_DB" }] };
  const out = pinD1Ids(deployed, operator); // operator has no d1_databases
  assert.deepEqual(out.d1_databases, [{ binding: "DB", database_id: "PROV_DB" }]);
  assert.deepEqual(out.vars, { GITHUB_APP_ID: "9999999" });
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
