// Tests for scripts/build-vault.mjs — the authoring vault generator. Covers the
// load-bearing contract: the Metadata Menu dropdown options ARE src/vocab.js (so they
// can't drift from the server validator), the schema is the human-authored field set
// (no derived `description`), and the build is deterministic + drift-gated. Mirrors
// build-plugin.test.mjs: pure-function unit tests + a real-artifact contract.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  FIELD_SPECS,
  vocabValues,
  fieldId,
  yamlScalar,
  renderRecipeFileClass,
  renderPluginManifest,
  assembleVaultFiles,
} from "../scripts/build-vault.mjs";
import * as VOCAB from "../src/vocab.js";
import { REQUIRED_FIELDS, validateRecipeContract } from "../src/recipe-contract.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// A small synthetic vocab so the option-generation assertions are exact.
const FIXTURE_VOCAB = {
  PROTEIN_VOCAB: ["chicken", "beef"],
  CUISINE_VOCAB: ["italian", "thai"],
  SEASON_VOCAB: ["spring", "winter"],
  EQUIPMENT_VOCAB: ["blender"],
  COURSE_SUGGESTIONS: ["main", "side"],
};

// --- schema: human-authored fields only ----------------------------------

test("the vault schema is exactly the human-authored contract field set", () => {
  // The vault must offer a control for every authored field and ONLY those — i.e. the
  // recipe-contract REQUIRED_FIELDS (which already excludes the Worker-derived
  // `description`). Same set, order-independent.
  const schema = FIELD_SPECS.map((f) => f.name).sort();
  assert.deepEqual(schema, [...REQUIRED_FIELDS].sort());
});

test("no derived field (`description`) appears in the schema", () => {
  assert.ok(!FIELD_SPECS.some((f) => f.name === "description"));
  assert.doesNotMatch(renderRecipeFileClass(VOCAB), /name: description/);
});

// --- options ARE the vocabulary ------------------------------------------

test("vocabValues maps each controlled field to its vocabulary; course to the open set", () => {
  assert.equal(vocabValues("protein", FIXTURE_VOCAB), FIXTURE_VOCAB.PROTEIN_VOCAB);
  assert.equal(vocabValues("cuisine", FIXTURE_VOCAB), FIXTURE_VOCAB.CUISINE_VOCAB);
  assert.equal(vocabValues("season", FIXTURE_VOCAB), FIXTURE_VOCAB.SEASON_VOCAB);
  assert.equal(vocabValues("equipment", FIXTURE_VOCAB), FIXTURE_VOCAB.EQUIPMENT_VOCAB);
  assert.equal(vocabValues("course", FIXTURE_VOCAB), FIXTURE_VOCAB.COURSE_SUGGESTIONS);
  assert.equal(vocabValues("tags", FIXTURE_VOCAB), null); // free-form
});

test("renderRecipeFileClass emits a constrained ValuesList from the fixture vocab", () => {
  const out = renderRecipeFileClass(FIXTURE_VOCAB);
  // protein is a Select bound to PROTEIN_VOCAB, in order, 1-indexed.
  assert.match(out, /- name: protein\n {4}type: Select/);
  assert.match(out, /valuesList:\n {8}"1": chicken\n {8}"2": beef/);
  // cuisine + season + requires_equipment likewise constrained.
  assert.match(out, /- name: cuisine\n {4}type: Select/);
  assert.match(out, /"1": italian\n {8}"2": thai/);
  assert.match(out, /- name: requires_equipment\n {4}type: Multi/);
  assert.match(out, /"1": blender/);
  // course is an open Multi seeded with the suggestions.
  assert.match(out, /- name: course\n {4}type: Multi/);
  assert.match(out, /"1": main\n {8}"2": side/);
  // a free-form field carries no options list.
  assert.match(out, /- name: tags\n {4}type: Multi\n {4}options: \{\}/);
});

test("an off-vocabulary value is not present in the generated options", () => {
  const out = renderRecipeFileClass(FIXTURE_VOCAB);
  assert.doesNotMatch(out, /poltry/); // the spec's canonical off-vocab example
});

// --- drift teeth ----------------------------------------------------------

test("a vocab change changes the generated fileClass (so --check would fail on stale)", () => {
  const before = renderRecipeFileClass(FIXTURE_VOCAB);
  const after = renderRecipeFileClass({ ...FIXTURE_VOCAB, PROTEIN_VOCAB: ["chicken", "beef", "goat"] });
  assert.notEqual(before, after);
  assert.doesNotMatch(before, /goat/);
  assert.match(after, /"3": goat/);
});

// --- determinism + ids ----------------------------------------------------

test("renderRecipeFileClass is deterministic", () => {
  assert.equal(renderRecipeFileClass(FIXTURE_VOCAB), renderRecipeFileClass(FIXTURE_VOCAB));
});

test("fieldId is deterministic and unique across the schema", () => {
  assert.equal(fieldId("protein"), fieldId("protein"));
  const ids = FIELD_SPECS.map((f) => fieldId(f.name));
  assert.equal(new Set(ids).size, ids.length, "field ids must be unique");
});

test("yamlScalar leaves safe tokens bare and quotes risky ones", () => {
  assert.equal(yamlScalar("chicken"), "chicken");
  assert.equal(yamlScalar("pressure-cooker"), "pressure-cooker"); // kebab is safe
  assert.equal(yamlScalar(""), '""'); // empty must quote
  assert.equal(yamlScalar("1"), '"1"'); // leading digit must quote (stays a string)
  assert.equal(yamlScalar('a"b'), '"a\\"b"'); // embedded quote escaped
});

// --- assembly -------------------------------------------------------------

const PINS = {
  plugins: [
    { id: "metadata-menu", manifest: { id: "metadata-menu", version: "0.8.12" }, assets: {} },
    { id: "templater-obsidian", manifest: { id: "templater-obsidian", version: "2.23.0" }, assets: {} },
  ],
};

test("assembleVaultFiles places the fileClass and a manifest.json per pinned plugin", () => {
  const templateFiles = new Map([[".obsidian/app.json", Buffer.from("{}\n")]]);
  const files = assembleVaultFiles({
    templateFiles,
    fileClassContent: renderRecipeFileClass(FIXTURE_VOCAB),
    pins: PINS,
  });
  assert.ok(files.has("fileClasses/recipe.md"));
  assert.ok(files.has(".obsidian/app.json"));
  assert.ok(files.has(".obsidian/plugins/metadata-menu/manifest.json"));
  assert.ok(files.has(".obsidian/plugins/templater-obsidian/manifest.json"));
  // config-only assembly carries NO binaries.
  assert.ok(!files.has(".obsidian/plugins/metadata-menu/main.js"));
  const mm = JSON.parse(files.get(".obsidian/plugins/metadata-menu/manifest.json").toString());
  assert.equal(mm.version, "0.8.12");
});

test("assembleVaultFiles vendors plugin asset buffers when provided", () => {
  const pluginAssets = new Map([["metadata-menu", new Map([["main.js", Buffer.from("PLUGIN")]])]]);
  const files = assembleVaultFiles({
    templateFiles: new Map(),
    fileClassContent: "x",
    pins: PINS,
    pluginAssets,
  });
  assert.equal(files.get(".obsidian/plugins/metadata-menu/main.js").toString(), "PLUGIN");
});

test("renderPluginManifest serializes the pinned manifest with a trailing newline", () => {
  const out = renderPluginManifest({ manifest: { id: "x", version: "1.0.0" } });
  assert.equal(out, '{\n  "id": "x",\n  "version": "1.0.0"\n}\n');
});

// --- real-artifact contract ----------------------------------------------

test("the committed vault/fileClasses/recipe.md is current with src/vocab.js", async () => {
  const committed = await readFile(path.join(REPO_ROOT, "vault", "fileClasses", "recipe.md"), "utf8");
  assert.equal(committed, renderRecipeFileClass(VOCAB), "run `aubr build:vault` and commit vault/");
});

test("the real vault constrains every controlled vocabulary, by construction", async () => {
  const out = renderRecipeFileClass(VOCAB);
  for (const v of VOCAB.PROTEIN_VOCAB) assert.ok(out.includes(`: ${v}`), `protein ${v} missing`);
  for (const v of VOCAB.CUISINE_VOCAB) assert.ok(out.includes(`: ${v}`), `cuisine ${v} missing`);
  for (const v of VOCAB.SEASON_VOCAB) assert.ok(out.includes(`: ${v}`), `season ${v} missing`);
  for (const v of VOCAB.EQUIPMENT_VOCAB) assert.ok(out.includes(`: ${v}`), `equipment ${v} missing`);
});

// The spec's load-bearing scenario, made executable: a recipe whose facets are filled
// from the vault's dropdowns passes the SAME validator the reconcile runs, and an
// off-vocab value (one the dropdowns never offer) is rejected — so the editing-time
// constraint and the server gate agree by construction.
test("dropdown values pass the real validator; an off-vocab value is rejected", () => {
  const fromDropdowns = {
    title: "Test Recipe",
    ingredients_key: ["chicken thighs", "soy sauce"],
    course: ["main"],
    protein: VOCAB.PROTEIN_VOCAB[0], // a real dropdown option
    cuisine: VOCAB.CUISINE_VOCAB[0],
    time_total: 30,
    source: null,
    dietary: [],
    season: [VOCAB.SEASON_VOCAB[0]],
    requires_equipment: [VOCAB.EQUIPMENT_VOCAB[0]],
    tags: [],
    pairs_with: [],
    perishable_ingredients: [],
    side_search_terms: ["a crisp green salad"], // required: course includes `main`
  };
  assert.deepEqual(validateRecipeContract(fromDropdowns), []);
  // `poltry` is not a PROTEIN_VOCAB dropdown option — the validator rejects it too.
  const offVocab = validateRecipeContract({ ...fromDropdowns, protein: "poltry" });
  assert.ok(offVocab.some((e) => /protein/.test(e)), offVocab.join("; "));
});
