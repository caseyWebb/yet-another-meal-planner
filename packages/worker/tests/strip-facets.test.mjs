// Tests for the strip-on-agreement applier's pure core (scripts/eval-facet-agreement/strip.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { stripFrontmatterKeys } from "../scripts/eval-facet-agreement/strip.mjs";

const recipe = (fm) => `---\n${fm}\n---\n\n## Ingredients\n\n- x\n\n## Instructions\n\n1. go\n`;

test("strips an inline-array key and a scalar key, preserving the rest byte-for-byte", () => {
  const text = recipe(
    [
      'title: "Lemon Chicken"',
      "source: null",
      "time_total: 50",
      "dietary: [gluten-free]",
      "tags: [chicken, weeknight]",
      "protein: chicken",
    ].join("\n"),
  );
  const out = stripFrontmatterKeys(text, ["tags", "protein"]);
  assert.ok(out !== null);
  assert.doesNotMatch(out, /^tags:/m);
  assert.doesNotMatch(out, /^protein:/m);
  // Untouched keys + body survive unchanged.
  assert.match(out, /^title: "Lemon Chicken"$/m);
  assert.match(out, /^dietary: \[gluten-free\]$/m);
  assert.match(out, /## Ingredients/);
  assert.match(out, /## Instructions/);
});

test("strips a block-style (multi-line) array including its indented continuation", () => {
  const text = recipe(["title: X", "season:", "  - spring", "  - summer", "tags: [a]"].join("\n"));
  const out = stripFrontmatterKeys(text, ["season"]);
  assert.doesNotMatch(out, /^season:/m);
  assert.doesNotMatch(out, /- spring/);
  assert.doesNotMatch(out, /- summer/);
  // The following key is untouched.
  assert.match(out, /^tags: \[a\]$/m);
  assert.match(out, /^title: X$/m);
});

test("strips a multi-line flow array cleanly (no stray closing bracket left behind)", () => {
  const text = recipe(["title: X", "ingredients_key: [", "  chicken,", "  rice", "]", "dietary: []"].join("\n"));
  const out = stripFrontmatterKeys(text, ["ingredients_key"]);
  assert.doesNotMatch(out, /ingredients_key/);
  assert.doesNotMatch(out, /chicken/);
  assert.doesNotMatch(out, /^\]/m); // the closing bracket must not survive as a stray line
  assert.match(out, /^title: X$/m);
  assert.match(out, /^dietary: \[\]$/m);
});

test("returns null when no requested key is present (no-op)", () => {
  const text = recipe("title: X\nsource: null");
  assert.equal(stripFrontmatterKeys(text, ["protein", "tags"]), null);
});

test("returns null when there is no frontmatter fence", () => {
  assert.equal(stripFrontmatterKeys("no frontmatter here", ["tags"]), null);
});

test("does not mis-strip a key whose name only appears inside another value", () => {
  const text = recipe(['title: "Tags and protein, a study"', "tags: [real]"].join("\n"));
  const out = stripFrontmatterKeys(text, ["tags"]);
  // The title (which contains the words) survives; only the real `tags:` key is removed.
  assert.match(out, /^title: "Tags and protein, a study"$/m);
  assert.doesNotMatch(out, /^tags:/m);
});

test("strips the first key and the last key cleanly (fence structure preserved)", () => {
  const text = recipe(["ingredients_key: [a, b]", "title: X", "side_search_terms: [s]"].join("\n"));
  const out = stripFrontmatterKeys(text, ["ingredients_key", "side_search_terms"]);
  assert.match(out, /^---\ntitle: X\n---\n/);
});
