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
  parseResourceBlocks,
  resolveVersion,
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
  // workflow skills stay user-invocable (no flag) — only library skills are hidden.
  assert.doesNotMatch(md, /user-invocable/);
});

test('renderLibrarySkill emits a grocery-<tier> skill with a near-empty description', () => {
  const md = renderLibrarySkill('cart', parseInstructions(DOC).persona.cart);
  assert.match(md, /^---\nname: grocery-cart\ndescription: "/);
  assert.match(md, /Not invoked on its own/);
  // hidden from user slash-command discovery, still model-loadable by reference.
  assert.match(md, /\nuser-invocable: false\n/);
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

test('validateParsed rejects angle brackets in a description (claude.ai upload guard)', () => {
  const bad = DOC.replace('Plan meals.', 'Plan meals for <you>.');
  const { errors } = validateParsed(parseInstructions(bad));
  assert.ok(errors.some((e) => /angle bracket/.test(e)), errors.join('; '));
});

test('validateParsed rejects an over-1024-char description', () => {
  const bad = DOC.replace('Plan meals.', 'x'.repeat(1100));
  const { errors } = validateParsed(parseInstructions(bad));
  assert.ok(errors.some((e) => /1024/.test(e)), errors.join('; '));
});

test('parseInstructions throws without a Common flows section', () => {
  assert.throws(() => parseInstructions('# Doc\n\n<!-- persona: core -->\n\n## Tone\n\ntext\n'), /Common flows/);
});

// --- manifest / connector / determinism ---------------------------------

test('yamlQuote escapes embedded quotes and backslashes', () => {
  assert.equal(yamlQuote('say "hi"'), '"say \\"hi\\""');
  assert.equal(yamlQuote('a\\b'), '"a\\\\b"');
});

test('renderMcpConfig bakes the given worker url into the connector', () => {
  const cfg = JSON.parse(renderMcpConfig('https://example.test/mcp'));
  assert.equal(cfg.mcpServers['grocery-mcp'].type, 'http');
  assert.equal(cfg.mcpServers['grocery-mcp'].url, 'https://example.test/mcp');
});

test('renderPluginManifest: no userConfig (claude.ai ignores it); version is opt-in', () => {
  // userConfig is never emitted (claude.ai ignores it). version is threaded in by
  // main() from git; the pure renderer omits it unless asked, so throwaway/no-git
  // builds ship none.
  const bare = JSON.parse(renderPluginManifest());
  assert.equal(bare.name, 'grocery-agent');
  assert.equal(bare.userConfig, undefined);
  assert.equal(bare.version, undefined);
  const versioned = JSON.parse(renderPluginManifest({ version: '0.0.42' }));
  assert.equal(versioned.version, '0.0.42');
});

test('buildPluginFiles threads version into the manifest (monotonic claude.ai auto-update)', () => {
  const without = JSON.parse(buildPluginFiles(parseInstructions(DOC), { mcpUrl: 'https://x' }).get('.claude-plugin/plugin.json'));
  assert.equal(without.version, undefined);
  const with42 = JSON.parse(buildPluginFiles(parseInstructions(DOC), { mcpUrl: 'https://x', version: '0.0.42' }).get('.claude-plugin/plugin.json'));
  assert.equal(with42.version, '0.0.42');
});

test('resolveVersion: 0.1.<commit-count> in a git checkout, undefined otherwise', () => {
  const v = resolveVersion(); // REPO_ROOT is a git checkout
  // `0.1.` floor (not `0.0.`) so it exceeds the old hand-published 0.1.1 — see resolveVersion.
  assert.match(v, /^0\.1\.\d+$/);
  // Non-git path (a bare temp dir would fail git) → undefined; use an impossible cwd.
  assert.equal(resolveVersion('/nonexistent-path-for-build-plugin-test'), undefined);
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

// --- parseResourceBlocks -------------------------------------------------

test('parseResourceBlocks: body with no resource blocks is returned unchanged', () => {
  const body = 'Do the thing.\n\nStep 1.\nStep 2.';
  const { lean, resources } = parseResourceBlocks(body);
  assert.equal(lean, body);
  assert.equal(resources.size, 0);
});

test('parseResourceBlocks: extracts a single block and replaces with a pointer', () => {
  const body = 'Router intro.\n\n<!-- resource: references/branch-a.md -->\n# Branch A\n\nDo A.\n<!-- /resource -->\n\nEnd.';
  const { lean, resources } = parseResourceBlocks(body);
  assert.ok(resources.has('references/branch-a.md'), 'resource not extracted');
  assert.match(resources.get('references/branch-a.md'), /# Branch A/);
  assert.match(lean, /> For details, read `references\/branch-a\.md`\./);
  assert.doesNotMatch(lean, /# Branch A/);
});

test('parseResourceBlocks: extracts two blocks independently', () => {
  const body = [
    'Intro.',
    '<!-- resource: references/a.md -->',
    '# A',
    '<!-- /resource -->',
    'Middle.',
    '<!-- resource: references/b.md -->',
    '# B',
    '<!-- /resource -->',
    'End.',
  ].join('\n');
  const { lean, resources } = parseResourceBlocks(body);
  assert.equal(resources.size, 2);
  assert.ok(resources.has('references/a.md'));
  assert.ok(resources.has('references/b.md'));
  assert.doesNotMatch(lean, /# A|# B/);
});

test('parseResourceBlocks: markdown headings in block content are preserved verbatim in extracted file', () => {
  const content = '## Sub\n\n### Deep\n\ntext';
  const body = `<!-- resource: references/deep.md -->\n${content}\n<!-- /resource -->`;
  const { resources } = parseResourceBlocks(body);
  assert.match(resources.get('references/deep.md'), /## Sub/);
  assert.match(resources.get('references/deep.md'), /### Deep/);
});

test('validateParsed rejects a resource path not under references/', () => {
  const bad = DOC.replace(
    'Do the menu thing.',
    'Do the menu thing.\n\n<!-- resource: assets/foo.md -->\ncontent\n<!-- /resource -->',
  );
  const { errors } = validateParsed(parseInstructions(bad));
  assert.ok(errors.some((e) => /resource path.*must be under references/.test(e)), errors.join('; '));
});

test('buildPluginFiles emits resource files alongside SKILL.md for a flow with resource blocks', () => {
  const docWithResource = DOC.replace(
    'Do the menu thing.',
    'Do the menu thing.\n\n<!-- resource: references/detail.md -->\n# Detail\n\nFull flow here.\n<!-- /resource -->',
  );
  const files = buildPluginFiles(parseInstructions(docWithResource), { mcpUrl: 'https://x' });
  assert.ok(files.has('skills/menu-request/references/detail.md'), 'reference file not emitted');
  assert.match(files.get('skills/menu-request/references/detail.md'), /# Detail/);
  // The SKILL.md body should have the pointer, not the full content.
  assert.match(files.get('skills/menu-request/SKILL.md'), /> For details, read `references\/detail\.md`\./);
  assert.doesNotMatch(files.get('skills/menu-request/SKILL.md'), /Full flow here/);
});

test('buildPluginFiles: skills without resource blocks produce identical output (regression)', () => {
  // sale-check has no resource blocks — its SKILL.md must be the same as without the feature.
  const before = buildPluginFiles(parseInstructions(DOC), { mcpUrl: 'https://x' });
  // Adding a resource block to menu-request must not affect sale-check.
  const docWithResource = DOC.replace(
    'Do the menu thing.',
    'Do the menu thing.\n\n<!-- resource: references/detail.md -->\n# Detail\n<!-- /resource -->',
  );
  const after = buildPluginFiles(parseInstructions(docWithResource), { mcpUrl: 'https://x' });
  assert.equal(after.get('skills/sale-check/SKILL.md'), before.get('skills/sale-check/SKILL.md'));
});

// --- real-doc contract ---------------------------------------------------

test('AGENT_INSTRUCTIONS.md: workflows with expected needs + library tiers', async () => {
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
    'grocery-sale-check',
    'cooking-retrospective',
    'shop-groceries',
    'configure-grocery-profile',
    'report-grocery-agent-bug',
  ]);
  const needs = Object.fromEntries(parsed.flows.map((f) => [f.name, f.needs]));
  assert.deepEqual(needs['meal-plan'], ['cart', 'corpus']);
  assert.deepEqual(needs['grocery-sale-check'], []); // light flow: core only
  assert.deepEqual(needs['cook'], []);
  assert.deepEqual(needs['shop-groceries'], ['cart']);

  // Library tiers emitted; workflows reference, don't inline.
  const files = buildPluginFiles(parsed, { mcpUrl: 'https://x' });
  for (const tier of ['core', 'cart', 'corpus']) {
    assert.ok(files.has(`skills/grocery-${tier}/SKILL.md`), `missing grocery-${tier}`);
  }
  assert.match(files.get('skills/meal-plan/SKILL.md'), /grocery-core`, `grocery-cart` and `grocery-corpus`/);
  assert.match(files.get('skills/grocery-sale-check/SKILL.md'), /read the `grocery-core` skill before/);

  // shop-groceries has 4 reference files extracted.
  assert.ok(files.has('skills/shop-groceries/references/kroger-online.md'), 'missing kroger-online.md');
  assert.ok(files.has('skills/shop-groceries/references/kroger-instore.md'), 'missing kroger-instore.md');
  assert.ok(files.has('skills/shop-groceries/references/instore-walk.md'), 'missing instore-walk.md');
  assert.ok(files.has('skills/shop-groceries/references/map-store.md'), 'missing map-store.md');
  // SKILL.md body has pointers, not inline branch content.
  assert.match(files.get('skills/shop-groceries/SKILL.md'), /read the `grocery-core` and `grocery-cart` skills/);
  assert.doesNotMatch(files.get('skills/shop-groceries/SKILL.md'), /Stale-cart check/);
  // cart prerequisite present.
  assert.match(files.get('skills/shop-groceries/SKILL.md'), /grocery-cart/);
});
