#!/usr/bin/env node
// build-plugin.mjs — generate the installable grocery-agent Claude plugin from
// AGENT_INSTRUCTIONS.md (the single canonical source).
//
// Shared persona ships as LIBRARY SKILLS loaded by reference (deduped across a
// session), not inlined into every workflow. The dominant usage is sequential
// chains (meal-plan → cook → cooked → feedback), where inlining would re-load the
// shared content on every link; a referenced library skill loads once. The persona
// splits into a `core` block (loaded by every workflow) plus depth blocks the heavy
// flows opt into, so a light flow (e.g. grocery-sale-check) carries nothing extra:
//   persona-tier markers → grocery-core, grocery-cart, grocery-corpus library skills
// Each `### ` flow under `## Common flows` carries a marker:
//   <!-- skill: <name>
//   needs: cart, corpus          (optional; omit for core-only flows)
//   description: <trigger text> -->
// The build emits the library skills and prefixes each workflow with a prerequisite
// line — "if you haven't already this session, read grocery-core (and any needed
// depth)" — that loads the shared skills once. The hedge leans on the model to skip
// a reload (Claude Code dedups; claude.ai behavior is the gating check).
//
// The connector URL is BAKED into .mcp.json (claude.ai does not honor a plugin
// userConfig variable, so each operator rebuilds with their own Worker URL). The
// URL is operator-specific and is NOT hardcoded in committed tooling — it comes
// from --mcp-url, else $GROCERY_MCP_URL (the gitignored mise.local.toml sets it
// on the machine). `aubr build:plugin` regenerates the committed marketplace
// bundle and REFUSES to write the placeholder there (that would break installs).
//
// Output mirrors the Claude plugin layout (.claude-plugin/plugin.json, skills/,
// .mcp.json). Deterministic (document-order flows, stable JSON) so an unchanged
// source produces byte-identical output. Skills are GENERATED — never hand-edit
// the bundle; edit AGENT_INSTRUCTIONS.md and rebuild.
//
// Usage:
//   aubr build:plugin                                     # regenerate plugin/grocery-agent/ (URL from $GROCERY_MCP_URL)
//   node scripts/build-plugin.mjs                         # throwaway build → dist/grocery-agent-plugin/ (placeholder URL ok)
//   node scripts/build-plugin.mjs --check                 # parse + validate only, no write
//   node scripts/build-plugin.mjs --out DIR               # write to DIR
//   node scripts/build-plugin.mjs --mcp-url https://...   # connector URL (overrides $GROCERY_MCP_URL)
//   node scripts/build-plugin.mjs --src PATH              # source doc (default AGENT_INSTRUCTIONS.md)

import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const PLUGIN_NAME = 'grocery-agent';
// The manifest carries an explicit `version` (see resolveVersion): `0.0.<N>` where
// N is the repo's commit count. We originally omitted it on the theory that a
// git-hosted marketplace falls back to the commit SHA so every push auto-propagates
// — true for the Claude Code CLI, but claude.ai (where this plugin actually runs)
// did NOT re-pull a versionless plugin across many commits (verified 2026-06-11: an
// install sat ~17h / 8 commits stale, never picking up new skills). claude.ai gates
// its auto-update on the `version` STRING changing, so a versionless plugin reads as
// "never updated." A monotonic commit-count version makes every rebuild strictly
// newer, which is what claude.ai needs to re-pull. It's computed from git at build
// time (not baked into the pure builder), so the file map stays deterministic.
export const PLUGIN_DESCRIPTION =
  'Personal grocery agent — meal planning, pantry, recipes, and Kroger cart. Bundles the workflow skills and the grocery-mcp connector.';
// Depth tiers a flow may opt into via `needs:`. `core` is implicit (always loaded).
// `discovery` carries the shared recipe triage/import mechanics, loaded by the flows
// that import a recipe (import-recipe, semantic-meal-plan) so they reference one
// source instead of restating the parse→classify→create detail inline.
export const DEPTH_TIERS = ['cart', 'corpus', 'discovery'];
// Persona tiers ship as library skills named grocery-<tier>, loaded by reference.
export const librarySkillName = (tier) => `grocery-${tier}`;
// Near-empty on purpose: a library skill loaded only by a workflow's prerequisite
// line, not self-triggered by relevance.
const LIBRARY_DESCRIPTION =
  'Internal shared rules for the grocery agent, loaded by reference from the workflow skills (via their prerequisite line). Not invoked on its own.';
const MCP_URL_PLACEHOLDER = 'https://grocery-mcp.example.workers.dev';
// The hosted recipe-site (browse) URL is NOT baked here — the Worker resolves it at
// runtime from the data repo's GitHub Pages config (the `recipe_site_url` tool),
// which honors a custom domain and detects whether Pages is enabled. The onboarding
// flow calls that tool instead of carrying a build-time URL.
const COMMON_FLOWS_HEADING = 'common flows';

// Regex for <!-- resource: references/<file>.md -->...<content>...<!-- /resource --> blocks.
// Multiline content is captured; the path is validated in validateParsed.
const RESOURCE_RE = /<!--\s*resource:\s*([^\s>]+)\s*-->([\s\S]*?)<!--\s*\/resource\s*-->/g;

// --- pure helpers --------------------------------------------------------

// Minimal YAML double-quoted scalar — robust for descriptions that carry colons
// and quoted example phrases ("save this recipe: <URL>") which would break an
// unquoted inline scalar.
export function yamlQuote(s) {
  return `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Extract `<!-- resource: <relpath> -->...<content>...<!-- /resource -->` blocks from
 * a flow body. Returns the body with each block replaced by a pointer line, plus a
 * Map of relpath → extracted content for the build to emit as separate files.
 * Blocks with no resource markers are returned unchanged (resources is empty).
 */
export function parseResourceBlocks(body) {
  const resources = new Map();
  let lean = body;
  // Collect all blocks first so we can replace them in a single pass.
  const matches = [];
  let m;
  RESOURCE_RE.lastIndex = 0;
  while ((m = RESOURCE_RE.exec(body)) !== null) {
    matches.push({ full: m[0], path: m[1].trim(), content: m[2].trim() });
  }
  for (const { full, path, content } of matches) {
    resources.set(path, content + '\n');
    lean = lean.replace(full, `> For details, read \`${path}\`.`);
  }
  return { lean: lean.trim(), resources };
}

// Split the persona region (everything before `## Common flows`) into tier blocks
// keyed by `<!-- persona: <tier> -->` markers. Content before the first marker
// (the title + build-note comment) is dropped — it's not skill content.
export function parsePersona(region) {
  const re = /<!--\s*persona:\s*([a-z]+)\s*-->/g;
  const markers = [];
  let m;
  while ((m = re.exec(region)) !== null) markers.push({ tier: m[1], contentStart: re.lastIndex, markerStart: m.index });
  const persona = {};
  for (let i = 0; i < markers.length; i++) {
    const end = i + 1 < markers.length ? markers[i + 1].markerStart : region.length;
    const content = region.slice(markers[i].contentStart, end).trim();
    const tier = markers[i].tier;
    persona[tier] = persona[tier] ? `${persona[tier]}\n\n${content}` : content;
  }
  return persona;
}

// Parse one flow marker comment's inner text into { name, needs, description }.
function parseFlowMarker(inner) {
  const name = (inner.match(/skill:\s*([a-z0-9-]+)/) || [])[1];
  const needsRaw = (inner.match(/needs:\s*([^\n]*)/) || [])[1] || '';
  const needs = needsRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  // description runs from `description:` to the end of the marker (so it must be last).
  const description = ((inner.match(/description:\s*([\s\S]*)$/) || [])[1] || '').replace(/\s+/g, ' ').trim();
  return { name, needs, description };
}

// Parse the source doc into { persona, flows }. Persona = the tier blocks before
// `## Common flows`; flows = the `###` children of that section.
export function parseInstructions(md) {
  const lines = md.split('\n');
  const l2 = [];
  lines.forEach((line, i) => {
    if (/^## /.test(line)) l2.push(i);
  });
  if (l2.length === 0) throw new Error('no `## ` sections found — is this the instructions doc?');

  let flowsStart = -1;
  let flowsEnd = lines.length;
  for (let k = 0; k < l2.length; k++) {
    if (lines[l2[k]].replace(/^##\s+/, '').trim().toLowerCase() === COMMON_FLOWS_HEADING) {
      flowsStart = l2[k];
      flowsEnd = k + 1 < l2.length ? l2[k + 1] : lines.length;
      break;
    }
  }
  if (flowsStart === -1) throw new Error('no `## Common flows` section found');

  const persona = parsePersona(lines.slice(0, flowsStart).join('\n'));

  const inner = lines.slice(flowsStart + 1, flowsEnd);
  const l3 = [];
  inner.forEach((line, i) => {
    if (/^### /.test(line)) l3.push(i);
  });
  const flows = [];
  for (let k = 0; k < l3.length; k++) {
    const start = l3[k];
    const end = k + 1 < l3.length ? l3[k + 1] : inner.length;
    const block = inner.slice(start, end).join('\n');
    const heading = inner[start].replace(/^###\s+/, '').trim();
    const marker = block.match(/<!--([\s\S]*?)-->/);
    if (!marker) {
      flows.push({ heading, error: 'missing-marker' });
      continue;
    }
    const { name, needs, description } = parseFlowMarker(marker[1]);
    const body = block
      .replace(/^###\s+.*\r?\n?/, '') // drop the ### heading line
      .replace(/<!--[\s\S]*?-->\s*/, '') // drop the marker comment
      .trim();
    flows.push({ name, needs, description, heading, body });
  }

  return { persona, flows };
}

// Structural validation: core present, ≥1 flow, every flow well-formed, names
// unique + slug-shaped, every `needs` names a real, non-empty depth block.
// Returns { errors: [] } — empty means apply-ready.
export function validateParsed(parsed) {
  const errors = [];
  const persona = parsed.persona ?? {};
  if (!persona.core || !persona.core.trim()) errors.push('persona `core` block is missing or empty');
  if (!parsed.flows || parsed.flows.length === 0) errors.push('no flow skills found under `## Common flows`');
  const seen = new Set();
  for (const f of parsed.flows ?? []) {
    if (f.error === 'missing-marker') {
      errors.push(`flow "${f.heading}" is missing its <!-- skill: … --> marker`);
      continue;
    }
    if (!/^[a-z0-9-]+$/.test(f.name || '')) errors.push(`flow "${f.heading}" has an invalid skill name "${f.name}"`);
    if (!f.description) errors.push(`flow "${f.name}" has an empty description`);
    // claude.ai's plugin-upload validator rejects skill descriptions containing
    // angle brackets (read as HTML/XML) or longer than 1024 chars. Guard at build
    // time so a bundle can't ship that fails to upload (claude-code#63081/#56376).
    if (f.description && /[<>]/.test(f.description))
      errors.push(`flow "${f.name}" description contains angle brackets (< or >), which claude.ai's plugin-upload validator rejects — rephrase without them`);
    if (f.description && f.description.length > 1024)
      errors.push(`flow "${f.name}" description is ${f.description.length} chars; claude.ai caps skill descriptions at 1024`);
    if (!f.body) errors.push(`flow "${f.name}" has an empty body`);
    // Validate any <!-- resource: --> paths: must be under references/ and end in .md.
    let rm;
    RESOURCE_RE.lastIndex = 0;
    while (f.body && (rm = RESOURCE_RE.exec(f.body)) !== null) {
      const rpath = rm[1].trim();
      if (!rpath.startsWith('references/') || !rpath.endsWith('.md')) {
        errors.push(`flow "${f.name}" resource path "${rpath}" must be under references/ and end in .md`);
      }
    }
    if (seen.has(f.name)) errors.push(`duplicate skill name "${f.name}"`);
    seen.add(f.name);
    for (const need of f.needs ?? []) {
      if (!DEPTH_TIERS.includes(need)) errors.push(`flow "${f.name}" needs unknown depth "${need}"`);
      else if (!persona[need] || !persona[need].trim()) errors.push(`flow "${f.name}" needs depth "${need}" but the persona block is missing`);
    }
  }
  return { errors };
}

// A library skill = one persona tier's content, loaded by reference. `user-invocable:
// false` hides it from the user's slash-command discovery while keeping it
// model-loadable by a workflow's prerequisite line (the only way it's ever loaded).
export function renderLibrarySkill(tier, content) {
  const fm = `---\nname: ${librarySkillName(tier)}\ndescription: ${yamlQuote(LIBRARY_DESCRIPTION)}\nuser-invocable: false\n---\n`;
  return `${fm}\n${content.trim()}\n`;
}

// The prerequisite line prepended to every workflow skill: load grocery-core plus
// any depth this flow needs, once per session. "If you haven't already" leans on
// the model to skip a reload when the library skill is already in context.
export function loaderLine(needs = []) {
  const tiers = ['core', ...DEPTH_TIERS.filter((t) => needs.includes(t))];
  const refs = tiers.map((t) => `\`${librarySkillName(t)}\``);
  const list = refs.length === 1 ? refs[0] : `${refs.slice(0, -1).join(', ')} and ${refs[refs.length - 1]}`;
  return `> **Prerequisite** — if you haven't already this session, read the ${list} skill${refs.length > 1 ? 's' : ''} before continuing.`;
}

// A workflow skill = its trigger frontmatter + the prerequisite loader line + the
// flow heading and body. Shared rules live in the referenced library skills.
export function renderWorkflowSkill(flow) {
  const fm = `---\nname: ${flow.name}\ndescription: ${yamlQuote(flow.description)}\n---\n`;
  return `${fm}\n${loaderLine(flow.needs)}\n\n# ${flow.heading}\n\n${flow.body}\n`;
}

export function renderPluginManifest({ name = PLUGIN_NAME, description = PLUGIN_DESCRIPTION, version } = {}) {
  // `version` is threaded in by main() from git (see the note by PLUGIN_NAME and
  // resolveVersion); omitted when absent so the pure builder stays version-agnostic
  // (and throwaway/no-git builds simply ship no version).
  const manifest = { $schema: 'https://json.schemastore.org/claude-code-plugin-manifest.json', name, description };
  if (version) manifest.version = version;
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

// The connector URL is BAKED into .mcp.json. We tried a plugin `userConfig` value
// (${user_config.worker_url}) so one bundle could serve every operator, but
// claude.ai does NOT substitute userConfig (verified 2026-06-11) — the variable
// reached the connector literally. So each operator bakes their own Worker URL via
// --mcp-url and a fork/rebuild; self-hosters do the same.
// A connector URL is valid for the committed bundle only if it parses as http(s).
// The placeholder and CI sentinels (e.g. `__ci__`) are NOT URLs and must never reach
// installers. Exported so the guard's rule is unit-tested, not just exercised via main().
export function isHttpUrl(u) {
  try {
    return ['http:', 'https:'].includes(new URL(u).protocol);
  } catch {
    return false;
  }
}

export function renderMcpConfig(mcpUrl) {
  return `${JSON.stringify({ mcpServers: { 'grocery-mcp': { type: 'http', url: mcpUrl } } }, null, 2)}\n`;
}

// Assemble the in-memory file map (relative path → contents). Pure: no disk I/O,
// so tests assert on the structure directly.
export function buildPluginFiles(parsed, { mcpUrl = MCP_URL_PLACEHOLDER, version } = {}) {
  const files = new Map();
  files.set('.claude-plugin/plugin.json', renderPluginManifest({ version }));
  files.set('.mcp.json', renderMcpConfig(mcpUrl));
  // Library skills: core + each depth tier present in the source.
  files.set(`skills/${librarySkillName('core')}/SKILL.md`, renderLibrarySkill('core', parsed.persona.core));
  for (const tier of DEPTH_TIERS) {
    if (parsed.persona[tier]) {
      files.set(`skills/${librarySkillName(tier)}/SKILL.md`, renderLibrarySkill(tier, parsed.persona[tier]));
    }
  }
  for (const flow of parsed.flows) {
    const { lean, resources } = parseResourceBlocks(flow.body);
    const leanFlow = resources.size > 0 ? { ...flow, body: lean } : flow;
    files.set(`skills/${flow.name}/SKILL.md`, renderWorkflowSkill(leanFlow));
    for (const [relpath, content] of resources) {
      files.set(`skills/${flow.name}/${relpath}`, content);
    }
  }
  return files;
}

// --- CLI -----------------------------------------------------------------

// Monotonic plugin version from git: `0.1.<commit-count>`. The count grows as
// commits land — what claude.ai's auto-update compares (see the note by PLUGIN_NAME).
// The `0.1.` prefix is a deliberate FLOOR, not cosmetic: this plugin once hand-published
// `0.1.1` (then dropped the field), and claude.ai gates on strictly-greater, so it
// remembered `0.1.1` as the high-water mark. A `0.0.<count>` scheme is *below* `0.1.1`
// in semver (minor 0 < 1) and would never auto-update past it. `0.1.<count>` (count
// ≥ 150 ≫ 1) dominates the old `0.1.1`. Returns undefined outside a git checkout
// (throwaway/dist builds), which ship no version.
//
// CAVEAT: the commit count is NOT globally monotonic under a squash-merge workflow —
// squashing a feature branch collapses its many WIP commits into one, so the linear
// count on `main` can SHRINK below a version stamped earlier from a branch that had
// more commits in its ancestry. A naive rebuild then regresses the version, and
// claude.ai (strictly-greater gate) strands installed members on the old skills. So
// the count is floored above the already-published bundle version (floorVersion) in
// main() before it's stamped.
export function resolveVersion(cwd = REPO_ROOT) {
  try {
    const count = execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
    return /^\d+$/.test(count) ? `0.1.${count}` : undefined;
  } catch {
    return undefined;
  }
}

// Floor the git-derived version above the version already baked into the committed
// bundle, so a rebuild can never regress below what's been published (see the
// squash-merge caveat on resolveVersion). Given computed `0.1.<n>` and committed
// `0.1.<m>`, returns `0.1.<max(n, m+1)>` — strictly greater than the published
// version on a tie or a regression, unchanged when already ahead. Returns `computed`
// untouched when there's no git version, no committed reference, or either is not a
// recognized `0.1.<patch>` string (a hand-published version off this scheme is left
// for a human to reconcile rather than silently overwritten).
export function floorVersion(computed, committed) {
  if (!computed) return computed;
  const c = /^0\.1\.(\d+)$/.exec(computed);
  const p = committed && /^0\.1\.(\d+)$/.exec(committed);
  if (!c || !p) return computed;
  return `0.1.${Math.max(Number(c[1]), Number(p[1]) + 1)}`;
}

// Read the plugin version already COMMITTED at HEAD — the published high-water mark
// floorVersion lifts above. Read from git, NOT the working tree: a prior local rebuild
// may have dirtied the working-copy bundle with a regressed version (a shallow checkout
// undercounts even worse), so the durable reference is what's in the last commit.
// Returns undefined outside a git checkout, or when the committed bundle has no version.
function publishedVersion(cwd = REPO_ROOT) {
  try {
    const rel = `plugin/${PLUGIN_NAME}/.claude-plugin/plugin.json`;
    const v = JSON.parse(execFileSync('git', ['show', `HEAD:${rel}`], { cwd, encoding: 'utf8' })).version;
    return typeof v === 'string' ? v : undefined;
  } catch {
    return undefined;
  }
}

async function main() {
  const checkOnly = process.argv.includes('--check');
  const argVal = (flag, fallback) => {
    const i = process.argv.indexOf(flag);
    return i !== -1 ? process.argv[i + 1] : fallback;
  };
  const src = path.resolve(argVal('--src', path.join(REPO_ROOT, 'AGENT_INSTRUCTIONS.md')));
  const out = path.resolve(argVal('--out', path.join(REPO_ROOT, 'dist', 'grocery-agent-plugin')));
  // The connector URL is operator-specific and lives on the machine, not in
  // committed tooling: --mcp-url wins, else $GROCERY_MCP_URL (set in the gitignored
  // mise.local.toml), else the placeholder. See CONTRIBUTING.md "Building the plugin".
  const mcpUrl = argVal('--mcp-url', process.env.GROCERY_MCP_URL ?? MCP_URL_PLACEHOLDER);
  // The committed marketplace bundle (.claude-plugin/marketplace.json → ./plugin/<name>)
  // is what installers actually get; writing the placeholder there silently breaks
  // every install's connector. Refuse it — the footgun guard.
  const committedBundle = path.join(REPO_ROOT, 'plugin', PLUGIN_NAME);

  const md = await readFile(src, 'utf8');
  const parsed = parseInstructions(md);
  const { errors } = validateParsed(parsed);
  if (errors.length) {
    console.error(`build-plugin: ${errors.length} error(s):`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  const flowSummary = parsed.flows.map((f) => (f.needs.length ? `${f.name}(${f.needs.join('+')})` : f.name)).join(', ');
  if (checkOnly) {
    console.log(`validation passed: ${parsed.flows.length} workflow skill(s) + library tiers [${flowSummary}] (--check, no write)`);
    return;
  }

  const writingCommittedBundle = path.resolve(out) === path.resolve(committedBundle);
  // What installers actually get must carry a REAL connector URL. The placeholder
  // is the obvious footgun, but any non-URL sentinel is just as broken — the CI
  // drift-check builds with `--mcp-url __ci__` (to a throwaway --out), and that
  // value silently leaked into the committed bundle once because the old guard only
  // matched the example placeholder. So the rule for the committed bundle is now
  // positive: the URL must parse as http(s). Throwaway/dist builds still allow the
  // placeholder (with a warning) so `node scripts/build-plugin.mjs` and the CI check
  // keep working.
  if (writingCommittedBundle && (mcpUrl === MCP_URL_PLACEHOLDER || !isHttpUrl(mcpUrl))) {
    console.error(
      `build-plugin: REFUSING to write a non-connector URL ("${mcpUrl}") into the committed marketplace bundle (${path.relative(REPO_ROOT, committedBundle)}) — that would break every install. Set GROCERY_MCP_URL (mise.local.toml) or pass --mcp-url https://<your-worker-host>/mcp.`,
    );
    process.exit(1);
  }
  if (mcpUrl === MCP_URL_PLACEHOLDER) {
    console.warn(
      `build-plugin: WARNING — no connector URL (set GROCERY_MCP_URL or pass --mcp-url); .mcp.json uses the placeholder ${MCP_URL_PLACEHOLDER}, so the connector will NOT resolve. Fine for a throwaway/dist build.`,
    );
  }

  // Floor the git-count version above the already-published bundle so a squash-merge
  // that shrank the commit count can't regress it (see floorVersion / resolveVersion).
  const version = floorVersion(resolveVersion(), publishedVersion());
  const files = buildPluginFiles(parsed, { mcpUrl, version });
  await rm(out, { recursive: true, force: true });
  for (const [rel, contents] of files) {
    const dest = path.join(out, rel);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, contents);
  }
  console.log(
    `built ${PLUGIN_NAME} plugin v${version ?? '(none)'} → ${out}  (${parsed.flows.length} skills: ${flowSummary})`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.stack || String(err));
    process.exit(1);
  });
}
