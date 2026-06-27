// stamp-readme-badge.mjs — maintain the grocery-mcp health badge in a data repo README
// (data-repo-health-badge). The deploy calls this to keep an idempotent marker block in
// the operator's README pointing at the Worker's token-gated /health.svg card. Pure,
// unit-tested helpers + a thin CLI, mirroring scripts/merge-wrangler-config.mjs.
//
// The badge URL embeds HEALTH_TOKEN, which is the operator's own value living in their
// PRIVATE data repo — exposing it there is intended (data-repo-health-badge design D5).
//
// CLI (two subcommands, like merge-wrangler-config.mjs):
//   node scripts/stamp-readme-badge.mjs token <config.jsonc>             -> prints vars.HEALTH_TOKEN (or "")
//   node scripts/stamp-readme-badge.mjs stamp <readme.md> <host> <token> -> rewrites <readme.md>, prints the snippet

import { readFileSync, writeFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import JSON5 from "json5";

const START = "<!-- health-badge:start -->";
const END = "<!-- health-badge:end -->";

/** Read `vars.HEALTH_TOKEN` from a wrangler.jsonc (JSON5) string; undefined if absent/unparseable. */
export function healthTokenFromConfig(configText) {
  try {
    const cfg = JSON5.parse(configText);
    const t = cfg?.vars?.HEALTH_TOKEN;
    return typeof t === "string" && t.length > 0 ? t : undefined;
  } catch {
    return undefined;
  }
}

/** The badge markdown for a worker host + token. Host is normalized (no scheme / trailing slash); token is URL-encoded. */
export function badgeSnippet(workerHost, token) {
  const host = String(workerHost)
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
  const url = `https://${host}/health.svg?token=${encodeURIComponent(token)}`;
  return `![grocery-mcp health](${url})`;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Return `readme` with the badge marker block set to `snippet`. Idempotent: when the
 * markers exist, only the content between them is replaced (re-running with an unchanged
 * URL is a no-op); otherwise the block is inserted immediately after the first Markdown
 * heading (so a repo from an older template gains the badge), or prepended if there is none.
 */
export function stampReadmeBadge(readme, snippet) {
  const block = `${START}\n${snippet}\n${END}`;
  const re = new RegExp(`${escapeRe(START)}[\\s\\S]*?${escapeRe(END)}`);
  if (re.test(readme)) return readme.replace(re, block);

  const lines = readme.split("\n");
  const headingIdx = lines.findIndex((l) => /^#{1,6}\s/.test(l));
  if (headingIdx === -1) return `${block}\n\n${readme}`;
  lines.splice(headingIdx + 1, 0, "", block, "");
  return lines.join("\n");
}

// --- CLI ---
const isMain = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [mode, ...rest] = process.argv.slice(2);
  if (mode === "token" && rest[0]) {
    process.stdout.write(healthTokenFromConfig(readFileSync(rest[0], "utf8")) ?? "");
  } else if (mode === "stamp" && rest[0] && rest[1] && rest[2]) {
    const [readmePath, host, token] = rest;
    const snippet = badgeSnippet(host, token);
    writeFileSync(readmePath, stampReadmeBadge(readFileSync(readmePath, "utf8"), snippet));
    process.stdout.write(snippet);
  } else {
    console.error("usage: stamp-readme-badge.mjs token <config> | stamp <readme> <host> <token>");
    process.exit(1);
  }
}
