// Assemble the deployed wrangler config (deploy-merge-wrangler-config). The operator
// deploy MERGES the code repo's wrangler.jsonc (code-level config) with the operator's
// data-repo wrangler.jsonc (operator-owned config), instead of replacing the former —
// so code-level config (triggers, compatibility flags, …) propagates to operators
// automatically instead of silently never deploying.
//
// SECURITY: the code repo's wrangler.jsonc is the MAINTAINER's real config, so every
// operator-owned value in it — `vars` (GITHUB_APP_ID / GITHUB_INSTALLATION_ID / DATA_*)
// and KV namespace ids — is the maintainer's and MUST NOT reach another operator. The
// merge takes operator-owned keys from the operator ONLY and strips the code repo's
// ids/vars unconditionally; otherwise a fresh operator's Worker would bind the
// maintainer's KV or inherit their GitHub App installation (a cross-tenant exposure).
//
// Two pure, unit-tested operations:
//   mergeWranglerConfig(code, operator) -> the config to deploy
//   pinKvIds(deployed, operator)         -> operator config with provisioned KV ids patched in
//
// CLI:
//   node scripts/merge-wrangler-config.mjs merge <operator.jsonc> <code.jsonc>   (writes <code.jsonc>)
//   node scripts/merge-wrangler-config.mjs pin   <deployed.jsonc> <operator.jsonc> (writes <operator.jsonc>)

import { readFileSync, writeFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import JSON5 from "json5";

// Code-level keys: always sourced from the CODE repo's config.
const CODE_LEVEL_KEYS = ["main", "compatibility_date", "compatibility_flags", "triggers", "observability"];

/**
 * Merge the code repo's config (`code`) with the operator's (`operator`) into the
 * config to deploy. Code-level keys come from code; operator-owned keys come from the
 * operator only (the code repo's `vars` and KV ids are the maintainer's and are dropped).
 */
export function mergeWranglerConfig(code, operator) {
  const out = {};

  // Operator surface choices: operator wins, code is a default.
  out.name = operator.name ?? code.name;
  if (operator.workers_dev !== undefined) out.workers_dev = operator.workers_dev;
  else if (code.workers_dev !== undefined) out.workers_dev = code.workers_dev;
  if (operator.routes !== undefined) out.routes = operator.routes;
  if (operator.route !== undefined) out.route = operator.route;

  // Code-level keys: always from code.
  for (const k of CODE_LEVEL_KEYS) {
    if (code[k] !== undefined) out[k] = code[k];
  }

  // vars: OPERATOR ONLY. The code repo's vars are the maintainer's and must never
  // propagate; the deploy injects DATA_OWNER/REPO/REF via --var on top at deploy time.
  if (operator.vars !== undefined) out.vars = operator.vars;

  // kv_namespaces: binding SET from code (new bindings propagate); each id from the
  // OPERATOR by binding, else omitted -> auto-provisioned. Code ids dropped unconditionally.
  out.kv_namespaces = mergeKvNamespaces(code.kv_namespaces, operator.kv_namespaces);

  return out;
}

function mergeKvNamespaces(codeKv = [], operatorKv = []) {
  const operatorIdByBinding = new Map(
    (operatorKv ?? []).filter((n) => n && n.binding).map((n) => [n.binding, n.id]),
  );
  return (codeKv ?? [])
    .filter((n) => n && n.binding)
    .map((n) => {
      const id = operatorIdByBinding.get(n.binding);
      // Drop the code repo's id unconditionally; use the operator's, or none (auto-provision).
      return id ? { binding: n.binding, id } : { binding: n.binding };
    });
}

/**
 * Patch the KV ids that `wrangler deploy` auto-provisioned into the deployed config
 * (read from `deployed`) back into the operator's config, matched by binding — creating
 * `kv_namespaces` if absent and preserving the operator's other keys. This keeps repeat
 * deploys bound to the same namespaces without re-bloating the operator's slim config
 * with code-level keys (the old wholesale copy-back would). Comments are not preserved —
 * the operator config becomes machine-managed JSON after the first deploy.
 */
export function pinKvIds(deployed, operator) {
  const provisioned = new Map(
    (deployed.kv_namespaces ?? []).filter((n) => n && n.binding && n.id).map((n) => [n.binding, n.id]),
  );
  if (provisioned.size === 0) return operator; // nothing to pin

  const byBinding = new Map(
    (Array.isArray(operator.kv_namespaces) ? operator.kv_namespaces : [])
      .filter((n) => n && n.binding)
      .map((n) => [n.binding, { ...n }]),
  );
  for (const [binding, id] of provisioned) {
    byBinding.set(binding, { ...(byBinding.get(binding) ?? { binding }), binding, id });
  }
  return { ...operator, kv_namespaces: [...byBinding.values()] };
}

// --- CLI ---

const parseFile = (p) => JSON5.parse(readFileSync(p, "utf8"));
const writeJson = (p, obj) => writeFileSync(p, JSON.stringify(obj, null, 2) + "\n");

const isMain = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [mode, a, b] = process.argv.slice(2);
  if (mode === "merge" && a && b) {
    // merge <operator> <code> -> write merged config to <code>
    writeJson(b, mergeWranglerConfig(parseFile(b), parseFile(a)));
    console.log(`merge: ${a} (operator) onto ${b} (code) -> ${b}`);
  } else if (mode === "pin" && a && b) {
    // pin <deployed> <operator> -> write operator config with provisioned ids
    writeJson(b, pinKvIds(parseFile(a), parseFile(b)));
    console.log(`pin: KV ids from ${a} -> ${b}`);
  } else {
    console.error("usage: merge-wrangler-config.mjs <merge|pin> <argA> <argB>");
    process.exit(1);
  }
}
