// check-licenses.mjs — fail when a *production* dependency's license isn't one this AGPL-3.0
// project may redistribute (open-source-license). The deployed Worker bundles its runtime deps,
// so each must carry a license an AGPL-3.0 work can incorporate; an unknown or disallowed license
// fails the gate, forcing a deliberate call before the dependency lands. Dev-only tooling
// (wrangler, vitest, tsc, openspec — never bundled or distributed) is out of scope. Pure Node, no
// deps: unit-tested pure helpers + a thin CLI, mirroring scripts/stamp-readme-badge.mjs and
// scripts/merge-wrangler-config.mjs.
//
//   node scripts/check-licenses.mjs           scan prod deps; exit 1 on any violation
//   node scripts/check-licenses.mjs --list    print every prod license seen (calibration aid)
//
// "What's in production" comes from `aube list --prod --recursive --json` (the production
// dependency graph across every workspace — aube, not a lockfile, since this repo is aube-native
// with no npm package-lock.json to walk). Each package's license is read from its own installed
// package.json (authoritative), found by walking aube's on-disk virtual store (node_modules/.aube)
// — reading the file directly, since an `exports` map can block `require.resolve('pkg/package.json')`.

import { readFileSync, readdirSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
// The monorepo root (where aube's virtual store `node_modules/.aube` and `pnpm-workspace.yaml`
// live) — walk up from packages/worker/scripts/ until the workspace manifest is found.
function findRoot(start) {
  let dir = start;
  for (let i = 0; i < 8; i++) {
    try {
      readFileSync(join(dir, "pnpm-workspace.yaml"));
      return dir;
    } catch {
      dir = join(dir, "..");
    }
  }
  return join(start, "..", "..", ".."); // fallback: packages/worker/scripts -> repo root
}
const ROOT = findRoot(HERE);

// SPDX ids an AGPL-3.0-only work may redistribute: permissive licenses (one-way compatible into
// AGPL), the GPL/LGPL/AGPL **v3** copyleft family (same-or-compatible), and weak-copyleft MPL-2.0.
// Deliberately EXCLUDES GPL-2.0-only / LGPL-2.x-only and anything proprietary or unknown — a
// borderline or unrecognized license must be reviewed and, if cleared, added to PACKAGE_EXCEPTIONS
// with a reason, not blanket-allowed here.
export const ALLOWED_LICENSES = new Set([
  "0BSD",
  "Apache-2.0",
  "BlueOak-1.0.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "CC0-1.0",
  "CC-BY-4.0",
  "ISC",
  "MIT",
  "MIT-0",
  "MPL-2.0",
  "Python-2.0",
  "Unlicense",
  "WTFPL",
  "Zlib",
  "AGPL-3.0-only",
  "AGPL-3.0-or-later",
  "GPL-3.0-only",
  "GPL-3.0-or-later",
  "LGPL-3.0-only",
  "LGPL-3.0-or-later",
  "LGPL-2.1-or-later",
  // Deprecated bare SPDX ids for the same v3 family (still declared by some packages).
  "AGPL-3.0",
  "GPL-3.0",
  "LGPL-3.0",
]);

// Installed `name@version` entries pre-cleared despite a license string that doesn't match the
// allowlist (e.g. a nonstandard SPDX string whose actual LICENSE file is permissive). Each entry
// is a deliberate, reasoned exception. Empty by default.
export const PACKAGE_EXCEPTIONS = {
  // "foo@1.2.3": "declares 'SEE LICENSE IN LICENSE' but the file is BSD-3-Clause — verified <date>",
};

/** True iff the leading "(" of `s` matches its trailing ")" — the parens wrap the whole string. */
function wraps(s) {
  if (!s.startsWith("(") || !s.endsWith(")")) return false;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")") {
      depth--;
      if (depth === 0 && i < s.length - 1) return false;
    }
  }
  return true;
}

/** Drop wrapping parens, a `WITH <exception>` tail, and a trailing `+` from one SPDX atom. */
function normalizeAtom(s) {
  let a = s.trim();
  while (wraps(a)) a = a.slice(1, -1).trim();
  a = a.replace(/\s+WITH\s+.+$/i, "").trim(); // judge "... WITH exception" by its base license
  a = a.replace(/\+$/, "").trim();
  return a;
}

/** Split `s` on top-level (paren-depth 0) ` OP ` occurrences, case-insensitive. */
function splitTop(s, op) {
  const token = ` ${op} `;
  const parts = [];
  let depth = 0;
  let last = 0;
  for (let i = 0; i <= s.length - token.length; i++) {
    const c = s[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (depth === 0 && s.slice(i, i + token.length).toUpperCase() === token) {
      parts.push(s.slice(last, i));
      i += token.length - 1;
      last = i + 1;
    }
  }
  parts.push(s.slice(last));
  return parts.map((p) => p.trim());
}

/**
 * Evaluate an SPDX license expression against ALLOWED_LICENSES. `OR` passes if ANY operand passes
 * (you may pick the compatible one); `AND` passes only if ALL operands pass; a bare id passes iff
 * it's allowed. Unknown/empty → false, so it surfaces as a violation.
 */
export function isLicenseAllowed(expr) {
  if (typeof expr !== "string") return false;
  let s = expr.trim();
  if (!s) return false;
  while (wraps(s)) s = s.slice(1, -1).trim();
  const ors = splitTop(s, "OR");
  if (ors.length > 1) return ors.some((p) => isLicenseAllowed(p));
  const ands = splitTop(s, "AND");
  if (ands.length > 1) return ands.every((p) => isLicenseAllowed(p));
  return ALLOWED_LICENSES.has(normalizeAtom(s));
}

/** Extract a license string from a package.json object, handling the deprecated forms. */
export function licenseOf(pkg) {
  if (!pkg) return "";
  if (typeof pkg.license === "string") return pkg.license;
  if (pkg.license && typeof pkg.license === "object" && typeof pkg.license.type === "string") return pkg.license.type;
  if (Array.isArray(pkg.licenses)) {
    const types = pkg.licenses.map((l) => (l && typeof l.type === "string" ? l.type : "")).filter(Boolean);
    if (types.length) return `(${types.join(" OR ")})`;
  }
  return "";
}

/** Read + parse a JSON file, or null if absent/unreadable. */
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Flatten an `aube list --prod --recursive --json` tree into unique `{ name, version }` production
 * dependency records. The tree's top-level entries are the workspace packages themselves (they carry
 * a `path`); their nested `dependencies` are the third-party production closure. Workspace
 * cross-links (`@grocery-agent/*`, emitted without a version) are internal first-party code, not
 * redistributable third-party deps, so they're skipped. Pure over the parsed JSON (testable).
 */
export function flattenProdTree(tree) {
  const seen = new Set();
  const out = [];
  const visit = (deps) => {
    for (const [name, info] of Object.entries(deps || {})) {
      if (!name.startsWith("@grocery-agent/")) {
        const version = info?.version || "";
        const id = `${name}@${version}`;
        if (!seen.has(id)) {
          seen.add(id);
          out.push({ name, version });
        }
      }
      if (info?.dependencies) visit(info.dependencies);
    }
  };
  for (const entry of Array.isArray(tree) ? tree : []) visit(entry.dependencies);
  return out;
}

/**
 * Index every installed package by `name@version` (and by bare `name` as a fallback) → license, by
 * walking aube's on-disk virtual store (`node_modules/.aube`). Recursion stops at each package
 * boundary (a directory holding a `package.json`), so a package's own bundled `node_modules` isn't
 * descended into and the walk stays bounded. Reads each `package.json` from disk directly.
 */
export function buildLicenseIndex(root = ROOT) {
  const byId = new Map();
  const byName = new Map();
  const walk = (dir, depth) => {
    if (depth > 6) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((e) => e.name === "package.json")) {
      const pkg = readJson(join(dir, "package.json"));
      if (pkg?.name && typeof pkg.version === "string") {
        const license = licenseOf(pkg);
        byId.set(`${pkg.name}@${pkg.version}`, license);
        if (!byName.has(pkg.name)) byName.set(pkg.name, license);
      }
      return; // package boundary — don't descend into its bundled node_modules
    }
    for (const e of entries) {
      if (e.isDirectory() || e.isSymbolicLink()) walk(join(dir, e.name), depth + 1);
    }
  };
  walk(join(root, "node_modules", ".aube"), 0);
  return { byId, byName };
}

/**
 * The production dependencies to license-check, each as `{ name, version, license, installed }`.
 * Enumerated from `aube list --prod --recursive --json` and licensed from the installed-store index.
 * `installed` is false for a dependency present in the graph but not on disk — the platform-specific
 * optional native binaries (`fsevents`, `lightningcss-<os>`, `@rolldown/binding-<os>`, …) that only
 * install on their matching OS/arch. Those never ship in this build's artifact, so the CLI skips
 * them (and reports the count) rather than flagging them as unlicensed.
 */
export function collectProductionDeps(root = ROOT) {
  const raw = execFileSync("aube", ["list", "--prod", "--recursive", "--depth", "999", "--json"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
  });
  const deps = flattenProdTree(JSON.parse(raw));
  const { byId, byName } = buildLicenseIndex(root);
  return deps.map(({ name, version }) => {
    const license = byId.get(`${name}@${version}`) ?? byName.get(name) ?? "";
    return { name, version, license, installed: byId.has(`${name}@${version}`) || byName.has(name) };
  });
}

// --- CLI ---
const isMain = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const list = process.argv.includes("--list");
  let deps;
  try {
    deps = collectProductionDeps();
  } catch (e) {
    console.error(`check-licenses: cannot enumerate production deps via 'aube list': ${e.message}`);
    process.exit(2);
  }

  // Uninstalled deps are the platform-specific optional native binaries for other OS/arch; they
  // never ship in this build's artifact, so they're out of scope (and carry no readable license
  // locally). Reported, not silently dropped.
  const installed = deps.filter((d) => d.installed);
  const skipped = deps.length - installed.length;

  if (list) {
    const byLicense = new Map();
    for (const d of installed) {
      const key = d.license || "(none)";
      if (!byLicense.has(key)) byLicense.set(key, []);
      byLicense.get(key).push(`${d.name}@${d.version}`);
    }
    for (const key of [...byLicense.keys()].sort()) {
      console.log(`${isLicenseAllowed(key) ? "ok " : "NO "} ${key}  (${byLicense.get(key).length})`);
    }
    if (skipped) console.log(`(skipped ${skipped} uninstalled platform-optional dep(s))`);
    process.exit(0);
  }

  const violations = [];
  const seen = new Set();
  for (const d of installed) {
    const id = `${d.name}@${d.version}`;
    if (seen.has(id)) continue;
    seen.add(id);
    if (PACKAGE_EXCEPTIONS[id]) continue;
    if (!isLicenseAllowed(d.license)) violations.push(d);
  }

  if (violations.length) {
    console.error(`check-licenses: ${violations.length} production dependency license(s) not allowed for an AGPL-3.0 project:\n`);
    for (const v of violations.sort((a, b) => a.name.localeCompare(b.name))) {
      console.error(`  ${v.name}@${v.version}  —  ${v.license || "(no license field)"}`);
    }
    console.error(`\nIf a flagged license is genuinely AGPL-3.0-compatible, add its SPDX id to ALLOWED_LICENSES,`);
    console.error(`or add "<name>@<version>" to PACKAGE_EXCEPTIONS with a reason. Otherwise, do not ship the dependency.`);
    process.exit(1);
  }
  const tail = skipped ? ` (${skipped} uninstalled platform-optional dep(s) out of scope)` : "";
  console.log(`check-licenses: ${seen.size} production dependencies, all licenses AGPL-3.0-compatible.${tail}`);
}
