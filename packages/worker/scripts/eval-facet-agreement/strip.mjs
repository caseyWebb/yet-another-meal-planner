// Strip-on-agreement applier (derive-recipe-facets, task 9.2). Consumes the agreement
// eval's --plan (scripts/eval-facet-agreement/run.mjs) and removes the agreed-on facet keys
// from each recipe's frontmatter IN PLACE, so the descriptive facets leave R2 and become
// cron-derived. Tier A keys are stripped unconditionally; Tier B keys are stripped only where
// the classifier AGREED (the plan's `stripB`) — a disagreement (`keepB`) is left as an
// authored override.
//
// SAFE BY DEFAULT: prints what it would change and writes NOTHING unless `--apply` is given.
// R2 has no version history, so snapshot first (`cp -r ./corpus ./corpus.backup`, or an
// `rclone copy`) — see the playbook.
//
//   node scripts/eval-facet-agreement/strip.mjs --plan strip-plan.json --dir ./corpus/recipes          # dry run
//   node scripts/eval-facet-agreement/strip.mjs --plan strip-plan.json --dir ./corpus/recipes --apply   # write
//   then: rclone sync ./corpus r2:grocery-corpus
//
// The classify pass + projection then derive + materialize the stripped facets on the next
// cron tick (a stripped recipe falls back to "not yet derived" → empty until then, which the
// projection tolerates).

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : null;
};
const PLAN = arg("--plan");
const DIR = arg("--dir") || process.env.CORPUS_DIR;
const APPLY = process.argv.includes("--apply");

/**
 * Remove the given top-level frontmatter keys from a recipe's raw markdown, byte-preserving
 * everything else (the key line plus any indented block-continuation lines). Returns the new
 * text, or `null` when nothing changed or there is no frontmatter fence. Pure — exported for
 * tests.
 */
export function stripFrontmatterKeys(text, keys) {
  const m = /^(---\r?\n)([\s\S]*?)(\r?\n---\r?\n?)([\s\S]*)$/.exec(text);
  if (!m) return null;
  const [, open, fm, close, body] = m;
  const drop = new Set(keys);
  const delta = (s) => (s.match(/[[{]/g) || []).length - (s.match(/[\]}]/g) || []).length;
  const out = [];
  let skipping = false; // indented-block continuation of a dropped key
  let flow = 0; // unbalanced [ / { inside a dropped key's MULTI-LINE flow value
  for (const line of fm.split(/\r?\n/)) {
    if (flow > 0) {
      // Still inside a dropped key's multi-line flow array/map — skip until the brackets balance.
      flow += delta(line);
      continue;
    }
    const keyMatch = /^([A-Za-z_][\w-]*):/.exec(line);
    if (keyMatch) {
      if (drop.has(keyMatch[1])) {
        const d = delta(line);
        if (d > 0) flow = d; // value opens a flow collection not closed on this line
        else skipping = true; // scalar or single-line value; skip any indented continuation
        continue;
      }
      skipping = false;
      out.push(line);
    } else if (skipping && (/^\s/.test(line) || line.trim() === "")) {
      // An indented / blank continuation line of a dropped block — skip it too.
      continue;
    } else {
      skipping = false;
      out.push(line);
    }
  }
  const newFm = out.join("\n");
  return newFm === fm ? null : open + newFm + close + body;
}

async function main() {
  if (!PLAN || !DIR) {
    console.error("usage: --plan <plan.json> --dir <recipes-dir> [--apply]");
    process.exit(1);
  }
  const plan = JSON.parse(await readFile(PLAN, "utf8"));
  let changed = 0;
  let keptOverrides = 0;
  for (const p of plan) {
    const keys = [...(p.stripA || []), ...(p.stripB || [])];
    keptOverrides += (p.keepB || []).length;
    if (!keys.length) continue;
    const path = join(DIR, `${p.slug}.md`);
    let text;
    try {
      text = await readFile(path, "utf8");
    } catch {
      console.warn(`  ! missing ${path}`);
      continue;
    }
    const next = stripFrontmatterKeys(text, keys);
    if (!next) continue;
    changed++;
    if (APPLY) await writeFile(path, next);
    else
      console.log(
        `  ${p.slug}: strip ${keys.join(", ")}${p.keepB?.length ? `  (keep override: ${p.keepB.join(", ")})` : ""}`,
      );
  }
  console.log(
    `\n${APPLY ? "Stripped" : "Would strip"} ${changed} recipe(s); ${keptOverrides} Tier-B override(s) preserved.` +
      (APPLY ? "  Now: rclone sync ./corpus r2:grocery-corpus" : "  Re-run with --apply to write."),
  );
}

// Only run the CLI when invoked directly (not when imported by the test).
if (process.argv[1] && process.argv[1].endsWith("strip.mjs")) {
  main().catch((e) => {
    console.error(e.stack || String(e));
    process.exit(1);
  });
}
