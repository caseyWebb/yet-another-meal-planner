// Assemble the deployed wrangler config (deploy-merge-wrangler-config). The operator
// deploy MERGES the code repo's wrangler.jsonc (code-level config) with the operator's
// data-repo wrangler.jsonc (operator-owned config), instead of replacing the former —
// so code-level config (triggers, compatibility flags, …) propagates to operators
// automatically instead of silently never deploying.
//
// SECURITY: the code repo's wrangler.jsonc is the MAINTAINER's real config, so every
// operator-owned value in it — `vars` (GITHUB_APP_ID / GITHUB_INSTALLATION_ID / DATA_*),
// KV namespace ids, and D1 database ids — is the maintainer's and MUST NOT reach another
// operator. The merge takes operator-owned keys from the operator ONLY and strips the
// code repo's ids/vars unconditionally; otherwise a fresh operator's Worker would bind
// the maintainer's KV/D1 or inherit their GitHub App installation (a cross-tenant
// exposure). KV namespaces and D1 databases follow the identical id-stripping rule.
//
// Two pure, unit-tested operations:
//   mergeWranglerConfig(code, operator)  -> the config to deploy
//   pinBindingIds(deployed, operator)    -> operator config with provisioned KV + D1 ids patched in
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

  // d1_databases: same rule as KV. The binding SET (and its `database_name` /
  // `migrations_dir`) comes from code so a new binding propagates to every operator;
  // the `database_id` comes from the OPERATOR by binding, else omitted -> auto-provisioned.
  // The code repo's `database_id` is dropped unconditionally (cross-tenant safety).
  if (code.d1_databases !== undefined || operator.d1_databases !== undefined) {
    out.d1_databases = mergeD1Databases(code.d1_databases, operator.d1_databases);
  }

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
 * Merge D1 database bindings, mirroring mergeKvNamespaces. The binding set and its
 * code-owned metadata (`database_name`, `migrations_dir`) come from code; the
 * `database_id` comes from the operator by binding, else omitted (auto-provision). The
 * code repo's `database_id` is dropped unconditionally — same cross-tenant safety rule
 * as KV ids.
 */
function mergeD1Databases(codeD1 = [], operatorD1 = []) {
  const operatorIdByBinding = new Map(
    (operatorD1 ?? []).filter((d) => d && d.binding).map((d) => [d.binding, d.database_id]),
  );
  return (codeD1 ?? [])
    .filter((d) => d && d.binding)
    .map((d) => {
      const out = { binding: d.binding };
      // Preserve code-owned metadata so the deploy + native migrations resolve correctly.
      if (d.database_name !== undefined) out.database_name = d.database_name;
      if (d.migrations_dir !== undefined) out.migrations_dir = d.migrations_dir;
      const id = operatorIdByBinding.get(d.binding);
      if (id) out.database_id = id; // operator's id, or none (auto-provision)
      return out;
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

/**
 * Patch the D1 database ids that `wrangler deploy` auto-provisioned into the deployed
 * config back into the operator's config, matched by binding — the D1 counterpart of
 * pinKvIds. Preserves the operator's other D1 keys (`database_name`, `migrations_dir`)
 * and creates `d1_databases` if absent.
 */
export function pinD1Ids(deployed, operator) {
  const provisioned = new Map(
    (deployed.d1_databases ?? [])
      .filter((d) => d && d.binding && d.database_id)
      .map((d) => [d.binding, d.database_id]),
  );
  if (provisioned.size === 0) return operator; // nothing to pin

  const byBinding = new Map(
    (Array.isArray(operator.d1_databases) ? operator.d1_databases : [])
      .filter((d) => d && d.binding)
      .map((d) => [d.binding, { ...d }]),
  );
  for (const [binding, database_id] of provisioned) {
    byBinding.set(binding, { ...(byBinding.get(binding) ?? { binding }), binding, database_id });
  }
  return { ...operator, d1_databases: [...byBinding.values()] };
}

/** Pin both KV namespace ids and D1 database ids in one pass (deploy pin step). */
export function pinBindingIds(deployed, operator) {
  return pinD1Ids(deployed, pinKvIds(deployed, operator));
}

/**
 * Did the binding→id mapping actually change between two configs, across BOTH
 * `kv_namespaces` and `d1_databases`? Used to keep the pin step a true no-op (leaving
 * the operator's config and its comments untouched, and the deploy's commit/push
 * silently skipped) when ids are already set — existing or manual-setup operators.
 * Returns true only when an id was added or changed for either binding type.
 */
export function bindingIdsChanged(before, after) {
  const kvIds = (cfg) =>
    new Map((cfg.kv_namespaces ?? []).filter((n) => n && n.binding).map((n) => [n.binding, n.id ?? null]));
  const d1Ids = (cfg) =>
    new Map(
      (cfg.d1_databases ?? []).filter((d) => d && d.binding).map((d) => [d.binding, d.database_id ?? null]),
    );
  const mapsDiffer = (b, a) => {
    if (a.size !== b.size) return true;
    for (const [binding, id] of a) if (b.get(binding) !== id) return true;
    return false;
  };
  return mapsDiffer(kvIds(before), kvIds(after)) || mapsDiffer(d1Ids(before), d1Ids(after));
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
    // pin <deployed> <operator> -> write operator config with provisioned ids, but ONLY
    // when an id actually changed. Leaving the file untouched otherwise keeps the deploy's
    // `git diff --quiet` check true, so the commit/push is silently skipped for operators
    // whose ids are already set (so they need no `contents: write` permission).
    const operator = parseFile(b);
    const patched = pinBindingIds(parseFile(a), operator);
    if (bindingIdsChanged(operator, patched)) {
      writeJson(b, patched);
      console.log(`pin: KV + D1 ids from ${a} -> ${b}`);
    } else {
      console.log(`pin: no KV/D1 id changes — left ${b} untouched`);
    }
  } else {
    console.error("usage: merge-wrangler-config.mjs <merge|pin> <argA> <argB>");
    process.exit(1);
  }
}
