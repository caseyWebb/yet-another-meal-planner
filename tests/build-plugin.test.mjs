// Tests for scripts/build-plugin.mjs — persona-tier parsing, reference-loading
// (library skills + prerequisite loader lines), validation, determinism,
// userConfig, plus the real-doc contract (AGENT_INSTRUCTIONS.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseInstructions,
  validateParsed,
  renderLibrarySkill,
  renderWorkflowSkill,
  loaderLine,
  renderMcpConfig,
  renderPluginManifest,
  buildPluginFiles,
  yamlQuote,
  DEPTH_TIERS,
} from '../scripts/build-plugin.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Synthetic doc: core + two depth tiers + Common flows (one heavy flow with
// needs, one core-only flow).
const DOC = `# AGENT_INSTRUCTIONS.md — Test

<!-- persona: core -->

You are the agent. Be direct.

## Tone

Friendly.

<!-- persona: cart -->

## Cart rules

Capture vs flush.

<!-- persona: corpus -->

## Corpus rules

Shared recipes.

## Common flows

### Menu request

<!-- skill: menu-request
needs: cart, corpus
description: Plan meals. Use for "make me a menu" and "let's do groceries". -->

Triggered on: "make me a menu".

Do the menu thing.

### Sale check

<!-- skill: sale-check
description: Check sales. -->

Check the flyer.
`;

// --- parsing -------------------------------------------------------------

test('parseInstructions splits persona into tiers and reads flow needs', () => {
  const { persona, flows } = parseInstructions(DOC);
  assert.match(persona.core, /You are the agent/);
  assert.match(persona.core, /## Tone/);
  assert.match(persona.cart, /Capture vs flush/);
  assert.match(persona.corpus, /Shared recipes/);
  assert.doesNotMatch(persona.core, /AGENT_INSTRUCTIONS\.md/); // title dropped

  assert.deepEqual(flows.map((f) => f.name), ['menu-request', 'sale-check']);
  assert.deepEqual(flows[0].needs, ['cart', 'corpus']);
  assert.deepEqual(flows[1].needs, []);
});

test('flow marker: name + needs + multi-line description; body drops heading + marker', () => {
  const menu = parseInstructions(DOC).flows[0];
  assert.equal(menu.heading, 'Menu request');
  assert.equal(menu.description, 'Plan meals. Use for "make me a menu" and "let\'s do groceries".');
  assert.match(menu.body, /^Triggered on: "make me a menu"\./);
  assert.doesNotMatch(menu.body, /skill: menu-request/);
  assert.doesNotMatch(menu.body, /^### /m);
});

// --- reference-loading ---------------------------------------------------

test('loaderLine references grocery-core only for a core-only flow', () => {
  const line = loaderLine([]);
  assert.match(line, /read the `grocery-core` skill/);
  assert.match(line, /if you haven't already this session/i);
  assert.doesNotMatch(line, /grocery-cart|grocery-corpus/);
});

test('loaderLine lists core + needed depth', () => {
  const line = loaderLine(['cart', 'corpus']);
  assert.match(line, /`grocery-core`, `grocery-cart` and `grocery-corpus` skills/);
});

test('renderWorkflowSkill prepends the loader and does NOT inline tier content', () => {
  const { flows } = parseInstructions(DOC);
  const md = renderWorkflowSkill(flows[0]);
  assert.match(md, /^---\nname: menu-request\ndescription: "/);
  assert.match(md, /> \*\*Prerequisite\*\* — if you haven't already this session, read the `grocery-core`, `grocery-cart` and `grocery-corpus` skills/);
  assert.match(md, /\n# Menu request\n/);
  assert.match(md, /Do the menu thing/);
  // tier content lives in the library skills, not inlined here.
  assert.doesNotMatch(md, /Capture vs flush/);
  assert.doesNotMatch(md, /Shared recipes/);
});

test('renderLibrarySkill emits a grocery-<tier> skill with a near-empty description', () => {
  const md = renderLibrarySkill('cart', parseInstructions(DOC).persona.cart);
  assert.match(md, /^---\nname: grocery-cart\ndescription: "/);
  assert.match(md, /Not invoked on its own/);
  assert.match(md, /Capture vs flush/);
});

// --- validation ----------------------------------------------------------

test('validateParsed accepts a well-formed doc', () => {
  assert.deepEqual(validateParsed(parseInstructions(DOC)).errors, []);
});

test('validateParsed flags a missing core block', () => {
  const noCore = DOC.replace('<!-- persona: core -->', '<!-- persona: cart -->');
  const { errors } = validateParsed(parseInstructions(noCore));
  assert.ok(errors.some((e) => /core` block is missing/.test(e)), errors.join('; '));
});

test('validateParsed flags an unknown depth in needs', () => {
  const bad = DOC.replace('needs: cart, corpus', 'needs: cart, bogus');
  const { errors } = validateParsed(parseInstructions(bad));
  assert.ok(errors.some((e) => /unknown depth "bogus"/.test(e)), errors.join('; '));
});

test('validateParsed flags a needed depth whose block is absent', () => {
  const bad = DOC.replace('<!-- persona: corpus -->', '<!-- persona: ignored -->');
  const { errors } = validateParsed(parseInstructions(bad));
  assert.ok(errors.some((e) => /needs depth "corpus" but the persona block is missing/.test(e)), errors.join('; '));
});

test('validateParsed flags a flow missing its marker', () => {
  const bad = DOC.replace(/<!-- skill: sale-check\ndescription: Check sales\. -->\n\n/, '');
  const { errors } = validateParsed(parseInstructions(bad));
  assert.ok(errors.some((e) => /missing its <!-- skill/.test(e)), errors.join('; '));
});

test('validateParsed flags duplicate skill names', () => {
  const dup = DOC.replace('skill: sale-check', 'skill: menu-request');
  const { errors } = validateParsed(parseInstructions(dup));
  assert.ok(errors.some((e) => /duplicate skill name "menu-request"/.test(e)), errors.join('; '));
});

test('parseInstructions throws without a Common flows section', () => {
  assert.throws(() => parseInstructions('# Doc\n\n<!-- persona: core -->\n\n## Tone\n\ntext\n'), /Common flows/);
});

// --- manifest / connector / determinism ---------------------------------

test('yamlQuote escapes embedded quotes and backslashes', () => {
  assert.equal(yamlQuote('say "hi"'), '"say \\"hi\\""');
  assert.equal(yamlQuote('a\\b'), '"a\\\\b"');
});

test('renderMcpConfig points the connector at the userConfig variable (operator-agnostic)', () => {
  const cfg = JSON.parse(renderMcpConfig());
  assert.equal(cfg.mcpServers['grocery-mcp'].type, 'http');
  assert.equal(cfg.mcpServers['grocery-mcp'].url, '${user_config.worker_url}');
});

test('renderPluginManifest declares worker_url userConfig with the given default', () => {
  const m = JSON.parse(renderPluginManifest({ defaultWorkerUrl: 'https://example.test/mcp' }));
  assert.equal(m.userConfig.worker_url.type, 'string');
  assert.equal(m.userConfig.worker_url.default, 'https://example.test/mcp');
  assert.ok(m.userConfig.worker_url.title && m.userConfig.worker_url.description);
});

test('buildPluginFiles emits library tiers + workflow skills + manifest + connector', () => {
  const files = buildPluginFiles(parseInstructions(DOC), { mcpUrl: 'https://example.test' });
  assert.deepEqual(
    [...files.keys()].sort(),
    [
      '.claude-plugin/plugin.json',
      '.mcp.json',
      'skills/grocery-core/SKILL.md',
      'skills/grocery-cart/SKILL.md',
      'skills/grocery-corpus/SKILL.md',
      'skills/menu-request/SKILL.md',
      'skills/sale-check/SKILL.md',
    ].sort(),
  );
});

test('buildPluginFiles is deterministic', () => {
  const a = buildPluginFiles(parseInstructions(DOC), { mcpUrl: 'https://x' });
  const b = buildPluginFiles(parseInstructions(DOC), { mcpUrl: 'https://x' });
  assert.deepEqual([...a.entries()], [...b.entries()]);
});

test('DEPTH_TIERS are cart and corpus', () => {
  assert.deepEqual(DEPTH_TIERS, ['cart', 'corpus']);
});

// --- real-doc contract ---------------------------------------------------

test('AGENT_INSTRUCTIONS.md: 13 workflows with expected needs + library tiers', async () => {
  const md = await readFile(path.join(REPO_ROOT, 'AGENT_INSTRUCTIONS.md'), 'utf8');
  const parsed = parseInstructions(md);
  assert.deepEqual(validateParsed(parsed).errors, []);
  assert.deepEqual(parsed.flows.map((f) => f.name), [
    'meal-plan',
    'update-pantry',
    'cook',
    'cooked',
    'add-recipe-feedback',
    'add-recipe-note',
    'add-ready-to-eat-feedback',
    'import-recipe',
    'inventory-hypothetical',
    'grocery-sale-check',
    'cooking-retrospective',
    'place-grocery-order',
    'configure-grocery-profile',
    'report-grocery-agent-bug',
  ]);
  const needs = Object.fromEntries(parsed.flows.map((f) => [f.name, f.needs]));
  assert.deepEqual(needs['meal-plan'], ['cart', 'corpus']);
  assert.deepEqual(needs['grocery-sale-check'], []); // light flow: core only
  assert.deepEqual(needs['cook'], []);
  assert.deepEqual(needs['place-grocery-order'], ['cart']);

  // Library tiers emitted; workflows reference, don't inline.
  const files = buildPluginFiles(parsed, { mcpUrl: 'https://x' });
  for (const tier of ['core', 'cart', 'corpus']) {
    assert.ok(files.has(`skills/grocery-${tier}/SKILL.md`), `missing grocery-${tier}`);
  }
  assert.match(files.get('skills/meal-plan/SKILL.md'), /grocery-core`, `grocery-cart` and `grocery-corpus`/);
  assert.match(files.get('skills/grocery-sale-check/SKILL.md'), /read the `grocery-core` skill before/);
});
