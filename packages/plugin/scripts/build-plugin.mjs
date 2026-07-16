#!/usr/bin/env node
// build-plugin.mjs — generate the installable yamp Claude plugin from
// AGENT_INSTRUCTIONS.md (the single canonical source).
//
// Shared persona ships as LIBRARY SKILLS loaded by reference (deduped across a
// session), not inlined into every workflow. The dominant usage is sequential
// chains (meal-plan → cook → cooked → feedback), where inlining would re-load the
// shared content on every link; a referenced library skill loads once. The persona
// ships a single `core` block today (loaded by every workflow); depth blocks remain
// supported for any flow that declares `needs:` against them:
//   persona-tier markers → yamp-core (plus yamp-<tier> per declared depth tier)
// Each `### ` flow under `## Common flows` carries a marker:
//   <!-- skill: <name>
//   needs: cart, corpus          (optional; omit for core-only flows)
//   description: <trigger text> -->
// The build emits the library skills and prefixes each workflow with a prerequisite
// line — "if you haven't already this session, read yamp-core (and any needed
// depth)" — that loads the shared skills once. The hedge leans on the model to skip
// a reload (Claude Code dedups; claude.ai behavior is the gating check).
//
// The connector URL is BAKED into .mcp.json (claude.ai does not honor a plugin
// userConfig variable, so each operator's bundle carries their own Worker URL). The
// URL is operator-specific and is NOT hardcoded in committed tooling — it comes from
// --mcp-url, else $YAMP_MCP_URL (the gitignored mise.local.toml sets it). The
// marketplace bundle is NOT committed in this code repo: the operator's deploy builds
// it with their URL and publishes it into their (public) data repo, which serves as
// their plugin marketplace (see .github/workflows/data-deploy.yml). Run this locally
// only for a throwaway/inspection build.
//
// Output mirrors the Claude plugin layout (.claude-plugin/plugin.json, skills/,
// .mcp.json). Deterministic (document-order flows, stable JSON) so an unchanged
// source produces byte-identical output. Skills are GENERATED — never hand-edit
// the bundle; edit AGENT_INSTRUCTIONS.md and rebuild.
//
// Usage:
//   node scripts/build-plugin.mjs                         # throwaway build → dist/yamp-plugin/ (placeholder URL ok)
//   node scripts/build-plugin.mjs --check                 # parse + validate only, no write
//   node scripts/build-plugin.mjs --out DIR               # write to DIR (the deploy passes the data repo's plugin/yamp)
//   node scripts/build-plugin.mjs --mcp-url https://...   # connector URL (overrides $YAMP_MCP_URL)
//   node scripts/build-plugin.mjs --version 0.1.<n>       # manifest version (the deploy passes the data repo's commit count)
//   node scripts/build-plugin.mjs --src PATH              # source doc (default AGENT_INSTRUCTIONS.md)

import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const PLUGIN_NAME = 'yamp';
// The manifest carries an explicit `version`: `0.2.<N>` where N is the DATA repo's
// commit count, computed at deploy time and passed via --version (resolveVersion is
// the local fallback for throwaway builds). claude.ai gates its auto-update on the
// `version` STRING changing (verified 2026-06-11: a versionless install sat ~17h / 8
// commits stale, never picking up new skills), so the version must be strictly greater
// on each publish. Deriving it from the data repo's commit count makes it monotonic
// per operator BY CONSTRUCTION — every publish is a commit, so the count only grows —
// which is exactly what claude.ai needs to re-pull. The version is passed in (not
// baked into the pure builder), so the file map stays deterministic.
export const PLUGIN_DESCRIPTION =
  'Personal meal planner — meal planning, pantry, recipes, and Kroger cart. Bundles the workflow skills and the yamp connector.';
// Depth tiers a flow may opt into via `needs:`. `core` is implicit (always loaded).
// `discovery` carries the shared recipe triage/import mechanics, loaded by the flows
// that import a recipe (import-recipe, meal-plan) so they reference one
// source instead of restating the parse→classify→create detail inline.
export const DEPTH_TIERS = ['cart', 'corpus', 'discovery'];
// Persona tiers ship as library skills named yamp-<tier>, loaded by reference.
export const librarySkillName = (tier) => `yamp-${tier}`;
// Near-empty on purpose: a library skill loaded only by a workflow's prerequisite
// line, not self-triggered by relevance.
const LIBRARY_DESCRIPTION =
  'Internal shared rules for yamp, loaded by reference from the workflow skills (via their prerequisite line). Not invoked on its own.';
const MCP_URL_PLACEHOLDER = 'https://yamp.example.workers.dev';
// The hosted cookbook (browse) URL is NOT baked here — the Worker resolves it at
// runtime as `<origin>/cookbook` (the `recipe_site_url` tool). The onboarding flow
// calls that tool instead of carrying a build-time URL.
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
      } else if (path.normalize(rpath) !== rpath || rpath.split('/').includes('..')) {
        // The prefix/suffix checks pass for "references/../../../tmp/pwned.md"; a `..`
        // segment escapes the flow's skills/<name>/ tree once path.join resolves it.
        errors.push(`flow "${f.name}" resource path "${rpath}" must not contain ".." segments`);
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

// The prerequisite line prepended to every workflow skill: load yamp-core plus
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
// --mcp-url; the deploy does this and publishes the bundle to the operator's data repo.
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
  return `${JSON.stringify({ mcpServers: { 'yamp': { type: 'http', url: mcpUrl } } }, null, 2)}\n`;
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

// Local fallback plugin version from git: `0.2.<commit-count>` of `cwd`. The deploy
// passes the DATA repo's commit count via --version (the published, monotonic-per-
// operator value — see the note by PLUGIN_NAME); this fallback is used only when
// --version is absent (local/throwaway builds, where the version does not matter).
// The `0.2.` prefix is a deliberate GENERATION marker over the OLD code-repo marketplace,
// which published the same plugin name up to `0.1.126`. claude.ai gates auto-update on
// strictly-greater per plugin name, so the data-repo era uses `0.2.x` to sit above that
// whole `0.1.x` line for every operator — a data-repo commit count (large for an
// established repo, tiny for a fresh one) can't be relied on to clear 0.1.126 on its own.
// `0.2.<count>` then keeps each republish strictly newer. Returns undefined outside a git
// checkout (ships no version).
export function resolveVersion(cwd = REPO_ROOT) {
  try {
    const count = execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
    return /^\d+$/.test(count) ? `0.2.${count}` : undefined;
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
  const out = path.resolve(argVal('--out', path.join(REPO_ROOT, 'dist', 'yamp-plugin')));
  // The connector URL is operator-specific and lives on the machine, not in
  // committed tooling: --mcp-url wins, else $YAMP_MCP_URL (set in the gitignored
  // mise.local.toml), else the placeholder. See CONTRIBUTING.md "Building the plugin".
  const mcpUrl = argVal('--mcp-url', process.env.YAMP_MCP_URL ?? MCP_URL_PLACEHOLDER);
  // The version is supplied by the deploy (--version = the data repo's commit count,
  // monotonic per operator); resolveVersion() is the local fallback for throwaway builds.
  const version = argVal('--version', undefined) ?? resolveVersion();

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

  // A throwaway/local build may use the placeholder; the deploy always passes a real
  // --mcp-url, so the published bundle carries a working connector. isHttpUrl gates the
  // warning (and stays exported for tests).
  if (mcpUrl === MCP_URL_PLACEHOLDER || !isHttpUrl(mcpUrl)) {
    console.warn(
      `build-plugin: WARNING — no real connector URL (set YAMP_MCP_URL or pass --mcp-url); .mcp.json uses "${mcpUrl}", so the connector will NOT resolve. Fine for a throwaway/inspection build.`,
    );
  }

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
