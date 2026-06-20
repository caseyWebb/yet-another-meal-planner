// Tests for scripts/merge-wrangler-config.mjs — the deploy's config merge + KV-id pin.
// The KV-id / vars provenance cases are security-critical: the code repo's config is the
// maintainer's, so its ids/vars must never appear in another operator's deployed config.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeWranglerConfig, pinKvIds } from "../scripts/merge-wrangler-config.mjs";

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
  triggers: { crons: ["*/5 * * * *"] },
  observability: { enabled: true },
};

// A slim operator config (post-template).
const operator = {
  vars: { GITHUB_APP_ID: "9999999" },
};

test("code-level triggers propagate when the operator lacks them", () => {
  const out = mergeWranglerConfig(code, operator);
  assert.deepEqual(out.triggers, { crons: ["*/5 * * * *"] });
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
  for (const id of ["MAINTAINER_KROGER", "MAINTAINER_TENANT", "MAINTAINER_OAUTH"]) {
    assert.ok(!blob.includes(id), `code KV id ${id} leaked into the deployed config`);
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
    "triggers", "observability", "vars", "kv_namespaces", "routes", "route",
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
