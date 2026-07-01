// stamp-readme-badge.mjs — maintain the grocery-mcp health badge in a data repo README
// (data-repo-health-badge). The deploy calls this to keep an idempotent marker block in
// the operator's README pointing at the Worker's OPEN /health.svg card. Pure, unit-tested
// helpers + a thin CLI, mirroring scripts/merge-wrangler-config.mjs.
//
// /health.svg is open and tenant-clean (no token — the card shows only job states + the
// d1 boolean), so the badge is a plain public URL. That's how a README badge must work:
// GitHub's image proxy fetches it anonymously, and there's no secret to leak into a README.
//
// CLI (two subcommands, like merge-wrangler-config.mjs):
//   node scripts/stamp-readme-badge.mjs snippet <host>           -> prints the badge markdown
//   node scripts/stamp-readme-badge.mjs stamp <readme.md> <host> -> rewrites <readme.md>, prints the snippet

import { readFileSync, writeFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const START = "<!-- health-badge:start -->";
const END = "<!-- health-badge:end -->";

/** The badge markdown for a worker host. Host is normalized (no scheme / trailing slash). */
export function badgeSnippet(workerHost) {
  const host = String(workerHost)
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
  const url = `https://${host}/health.svg`;
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
  // Replacer function (not a string) so `$&`/`$1`/`$$` in the snippet are never interpreted.
  if (re.test(readme)) return readme.replace(re, () => block);

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
  if (mode === "snippet" && rest[0]) {
    // Just the badge markdown — touches no file. Lets the deploy surface the paste-snippet
    // even when there is no README to stamp.
    process.stdout.write(badgeSnippet(rest[0]));
  } else if (mode === "stamp" && rest[0] && rest[1]) {
    const [readmePath, host] = rest;
    // Tolerate a missing README (ENOENT → empty) so a direct call never throws; the block
    // is prepended into a fresh file. (The deploy guards on existence so it won't fabricate
    // a README, but the CLI stays safe for any caller.)
    let current = "";
    try {
      current = readFileSync(readmePath, "utf8");
    } catch {
      current = "";
    }
    const snippet = badgeSnippet(host);
    writeFileSync(readmePath, stampReadmeBadge(current, snippet));
    process.stdout.write(snippet);
  } else {
    console.error("usage: stamp-readme-badge.mjs snippet <host> | stamp <readme> <host>");
    process.exit(1);
  }
}
