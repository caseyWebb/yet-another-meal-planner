#!/usr/bin/env node
// build-vault.mjs — generate the committed Obsidian authoring vault from the authored
// source (vault-template/) and the recipe vocabulary (src/vocab.js).
//
// The vault is the third generated, committed artifact in this repo (alongside
// plugin/ from AGENT_INSTRUCTIONS.md and admin/dist/ from admin/src/). It is the
// corpus-authoring surface: a preconfigured vault whose Metadata Menu `recipe`
// fileClass turns every vocab-bound facet (protein / cuisine / season /
// requires_equipment, plus the open `course` set) into a dropdown CONSTRAINED TO THE
// SAME VOCABULARY the server validator uses — so an author cannot type `poltry`, and
// the dropdowns can never disagree with src/validate.ts because both read src/vocab.js.
//
// Mirrors build-admin.mjs/build-plugin.mjs: ESM, hand-rolled, deterministic (stable
// field order + stable ids), with a --check validate-only mode (the CI drift gate)
// that fails if the committed vault is stale against vocab.js or the template.
//
// PLUGINS. The three community plugins (Metadata Menu, Templater, Remotely Save) are
// pinned in vault-template/plugin-pins.json. Each plugin's small manifest.json is
// generated (committed) from the pin; the heavy main.js/styles.css are NOT committed
// (see .gitignore) — `--fetch-plugins` downloads them from the pinned GitHub release,
// verifies each sha256, and lays them into the built vault to produce the complete,
// openable distributable. So `--check` stays OFFLINE (it only validates the
// deterministic, vocab-derived config) and the public repo carries no multi-MB
// third-party bundles. See docs/SELF_HOSTING.md "Authoring recipes in Obsidian".
//
// Usage:
//   node scripts/build-vault.mjs                  # write the committed config vault → vault/
//   node scripts/build-vault.mjs --check          # validate-only: fail on drift (CI gate, offline)
//   node scripts/build-vault.mjs --fetch-plugins  # also vendor the pinned plugin binaries (network)
//   node scripts/build-vault.mjs --out DIR        # write to DIR instead of vault/

import { readFile, readdir, writeFile, mkdir, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE_DIR = path.join(REPO_ROOT, "vault-template");
const TEMPLATE_FILES_DIR = path.join(TEMPLATE_DIR, "files");
const PINS_PATH = path.join(TEMPLATE_DIR, "plugin-pins.json");
const VOCAB_PATH = path.join(REPO_ROOT, "src", "vocab.js");
const FILECLASS_REL = "fileClasses/recipe.md";

// The recipe authoring schema. The DESCRIPTIVE facets are derived on the cron
// (recipe-facet-derivation), so the vault offers a control only for the authored GATES +
// identity (the required set) plus the optional Tier B OVERRIDE dropdowns (blank → the
// classifier derives the value; a value pins an override). Pure-derived fields —
// `description`, `ingredients_key`, `perishable_ingredients`, `side_search_terms`,
// `meal_preppable` — are deliberately ABSENT: no human authors them. `vocab` names the
// controlled set a Select/Multi binds to; omit it for a free-form field.
export const FIELD_SPECS = Object.freeze([
  // Identity + the two hard gates (the required authored set — src/recipe-contract.js).
  { name: "title", type: "Input" },
  { name: "source", type: "Input" },
  { name: "time_total", type: "Number" },
  { name: "dietary", type: "Multi" }, // hard diet/allergen gate — author it
  { name: "requires_equipment", type: "Multi", vocab: "equipment" }, // hard makeability gate
  { name: "pairs_with", type: "Multi" },
  // Optional Tier B overrides — leave blank to let the classify pass derive them.
  { name: "course", type: "Multi", vocab: "course" }, // open: suggestions, author may add
  { name: "protein", type: "Select", vocab: "protein" }, // constrained
  { name: "cuisine", type: "Select", vocab: "cuisine" }, // constrained
  { name: "season", type: "Multi", vocab: "season" }, // constrained
  { name: "tags", type: "Multi" },
]);

// --- pure helpers --------------------------------------------------------

// Map a FIELD_SPECS `vocab` key to its value list from the loaded vocab module. The
// four controlled vocabularies are enforced by src/validate.ts; `course` is the OPEN
// suggestion set (COURSE_SUGGESTIONS) — offered as dropdown options but never enforced.
export function vocabValues(key, vocab) {
  switch (key) {
    case "protein":
      return vocab.PROTEIN_VOCAB;
    case "cuisine":
      return vocab.CUISINE_VOCAB;
    case "season":
      return vocab.SEASON_VOCAB;
    case "equipment":
      return vocab.EQUIPMENT_VOCAB;
    case "course":
      return vocab.COURSE_SUGGESTIONS;
    default:
      return null;
  }
}

// Deterministic 6-char base36 field id (FNV-1a over the field name). Metadata Menu
// needs a per-field id; deriving it from the name keeps the built fileClass
// byte-identical across rebuilds (a random id would defeat the --check drift gate).
// Reduce into the 6-char base36 space (36**6 ≈ 2.18e9) so the value always encodes
// to exactly 6 chars — never tail-truncating a 7-char hash (which would silently
// discard a digit of keyspace and make future field names more collision-prone).
export function fieldId(name) {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h % 36 ** 6).toString(36).padStart(6, "0");
}

// Minimal YAML scalar: quote only when a bare token would be misread (empty, leading
// special char, or anything outside the safe [A-Za-z0-9._-] set). The vocab tokens
// (`chicken`, `pressure-cooker`) are safe and emit bare; keys like "1" are quoted by
// the caller to stay strings.
export function yamlScalar(v) {
  const s = String(v);
  if (s !== "" && /^[A-Za-z0-9._-]+$/.test(s) && !/^[0-9]/.test(s)) return s;
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

// Render one Metadata Menu field block (frontmatter `fields:` list item). A
// controlled/suggested field carries its ValuesList; a free-form field gets `{}`.
function renderField(spec, vocab) {
  const lines = [`  - name: ${spec.name}`, `    type: ${spec.type}`];
  const values = spec.vocab ? vocabValues(spec.vocab, vocab) : null;
  if (values) {
    lines.push("    options:");
    lines.push("      sourceType: ValuesList");
    lines.push('      valuesListNotePath: ""');
    lines.push('      valuesFromDVQuery: ""');
    lines.push("      valuesList:");
    values.forEach((v, i) => lines.push(`        "${i + 1}": ${yamlScalar(v)}`));
  } else {
    lines.push("    options: {}");
  }
  lines.push('    path: ""');
  lines.push(`    id: ${fieldId(spec.name)}`);
  return lines.join("\n");
}

// Render the Metadata Menu `recipe` fileClass note (frontmatter field schema + a
// generated-file banner body). Pure over the vocab module — this is the load-bearing
// unit: its dropdown options ARE src/vocab.js, so they cannot drift from the validator.
export function renderRecipeFileClass(vocab) {
  const fields = FIELD_SPECS.map((spec) => renderField(spec, vocab)).join("\n");
  const frontmatter = [
    "---",
    "fields:",
    fields,
    "limit: 100",
    "mapWithTag: false",
    "tagNames: []",
    "filesPaths: []",
    "bookmarksGroups: []",
    "excludes: []",
    'extends: ""',
    "savedViews: []",
    'favoriteView: ""',
    "fieldsOrder: []",
    'version: "2.1"',
    "---",
  ].join("\n");
  const body = [
    "",
    "# recipe",
    "",
    "Metadata Menu fileClass for authoring recipes. **Generated** from `src/vocab.js`",
    "by `scripts/build-vault.mjs` — do not hand-edit; edit the source and run",
    "`aubr build:vault`. The `protein` / `cuisine` / `season` / `requires_equipment`",
    "dropdowns are constrained to the same vocabulary the server reconcile validates;",
    "`course` is the open suggestion set. `description` is intentionally absent — the",
    "Worker derives it.",
    "",
  ].join("\n");
  return `${frontmatter}\n${body}`;
}

// Render a pinned plugin's committed manifest.json (pretty, trailing newline) from the
// pin's embedded manifest — the single source for the manifest the build writes.
export function renderPluginManifest(pin) {
  return JSON.stringify(pin.manifest, null, 2) + "\n";
}

const SEP = "/";

// Assemble the in-memory vault as relpath -> Buffer. Pure: callers pass the already-read
// template files, the rendered fileClass, the pins, and (optionally) fetched plugin
// asset buffers, so the structure is unit-testable with no disk I/O. `templateFiles` is
// a Map<relpath, Buffer>; `pluginAssets` (optional) a Map<pluginId, Map<file, Buffer>>.
export function assembleVaultFiles({ templateFiles, fileClassContent, pins, pluginAssets }) {
  const files = new Map();
  const put = (rel, content) =>
    files.set(rel, Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8"));

  for (const [rel, buf] of templateFiles) put(rel, buf);
  put(FILECLASS_REL, fileClassContent);

  for (const pin of pins.plugins) {
    const base = `.obsidian/plugins/${pin.id}`;
    put(`${base}/manifest.json`, renderPluginManifest(pin));
    const assets = pluginAssets && pluginAssets.get(pin.id);
    if (assets) for (const [file, buf] of assets) put(`${base}/${file}`, buf);
  }
  return files;
}

// --- disk I/O ------------------------------------------------------------

async function listFilesRec(dir, base = dir, acc = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return acc;
    throw err;
  }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await listFilesRec(full, base, acc);
    else if (e.isFile()) acc.push(path.relative(base, full).split(path.sep).join(SEP));
  }
  return acc;
}

async function readTemplateFiles() {
  const rels = await listFilesRec(TEMPLATE_FILES_DIR);
  const map = new Map();
  for (const rel of rels) map.set(rel, await readFile(path.join(TEMPLATE_FILES_DIR, rel)));
  return map;
}

// Load the vocab module (the CLI imports it once per run).
async function loadVocab() {
  return import(pathToFileURL(VOCAB_PATH).href);
}

// Fetch a pinned plugin's assets from its GitHub release, verifying each sha256.
async function fetchPluginAssets(pins) {
  const out = new Map();
  for (const pin of pins.plugins) {
    const assets = new Map();
    for (const [file, sha] of Object.entries(pin.assets)) {
      const url = `https://github.com/${pin.repo}/releases/download/${pin.version}/${file}`;
      const res = await fetch(url, { redirect: "follow" });
      if (!res.ok) throw new Error(`fetch ${url} → HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const got = createHash("sha256").update(buf).digest("hex");
      if (got !== sha)
        throw new Error(`sha256 mismatch for ${pin.id}/${file}: expected ${sha}, got ${got}`);
      assets.set(file, buf);
    }
    out.set(pin.id, assets);
    console.log(`fetched ${pin.id}@${pin.version} (${[...assets.keys()].join(", ")})`);
  }
  return out;
}

async function buildFiles({ fetchPlugins } = {}) {
  const [templateFiles, vocab, pinsRaw] = await Promise.all([
    readTemplateFiles(),
    loadVocab(),
    readFile(PINS_PATH, "utf8"),
  ]);
  const pins = JSON.parse(pinsRaw);
  const pluginAssets = fetchPlugins ? await fetchPluginAssets(pins) : null;
  return assembleVaultFiles({
    templateFiles,
    fileClassContent: renderRecipeFileClass(vocab),
    pins,
    pluginAssets,
  });
}

// --- CLI -----------------------------------------------------------------

// Files the config-only build never produces but the committed vault legitimately
// carries (the gitignored, fetched plugin binaries). --check must not flag them stray.
function isVendoredBinary(rel) {
  return /^\.obsidian\/plugins\/[^/]+\/(main\.js|styles\.css)$/.test(rel);
}

async function check(files, outRoot) {
  let stale = false;
  for (const [rel, content] of files) {
    const p = path.join(outRoot, rel);
    let current = null;
    try {
      current = await readFile(p);
    } catch {
      /* missing */
    }
    if (current === null || !current.equals(content)) {
      console.error(`stale: ${rel}`);
      stale = true;
    }
  }
  // Stray committed files (not produced by the build and not a vendored binary) are
  // also drift — e.g. a renamed template left behind.
  for (const rel of await listFilesRec(outRoot)) {
    if (!files.has(rel) && !isVendoredBinary(rel)) {
      console.error(`stray: ${rel} (not produced by build-vault)`);
      stale = true;
    }
  }
  if (stale) {
    console.error("vault is out of date — run `aubr build:vault` and commit vault/.");
    process.exit(1);
  }
  console.log(`vault up to date (${files.size} generated file(s)).`);
}

async function writeOut(files, outRoot, { fetchPlugins }) {
  // Self-heal: drop any existing generated file the build no longer produces (e.g. a
  // renamed template), so the committed vault never carries a stale leftover. Preserve
  // the gitignored vendored binaries (main.js/styles.css) an author may have fetched —
  // a config-only rebuild must not wipe them.
  for (const rel of await listFilesRec(outRoot)) {
    if (!files.has(rel) && !isVendoredBinary(rel)) await rm(path.join(outRoot, rel));
  }
  for (const [rel, content] of files) {
    const p = path.join(outRoot, rel);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, content);
  }
  console.log(
    `vault built: ${files.size} file(s) → ${path.relative(REPO_ROOT, outRoot) || outRoot}` +
      (fetchPlugins ? " (with vendored plugins)" : " (did not re-fetch plugin binaries; use --fetch-plugins to (re)vendor them)"),
  );
}

async function main() {
  const argv = process.argv.slice(2);
  const checkOnly = argv.includes("--check");
  const fetchPlugins = argv.includes("--fetch-plugins");
  const outArg = argv.indexOf("--out");
  const outRoot = path.resolve(REPO_ROOT, outArg !== -1 ? argv[outArg + 1] : "vault");

  const files = await buildFiles({ fetchPlugins });
  if (checkOnly) await check(files, outRoot);
  else await writeOut(files, outRoot, { fetchPlugins });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.stack || String(err));
    process.exit(1);
  });
}
