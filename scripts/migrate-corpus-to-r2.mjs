#!/usr/bin/env node
// migrate-corpus-to-r2.mjs — one-time copy of a git corpus checkout into the R2
// `CORPUS` bucket (r2-corpus-store), plus a parity check. The authored corpus
// (recipes/*.md + guidance/**/*.md) moved from the GitHub data repo to R2; this walks a
// local checkout of that repo and `wrangler r2 object put`s each file at its repo-relative
// key, then (in --verify) reads each back and diffs it against the local file.
//
// The Worker reads/writes the corpus through this same bucket, so after this copy the
// reconcile projects the index from R2 and reads need no GitHub. Run it ONCE at cutover.
//
// Ongoing operator bulk edits use rclone instead of this script (R2 is S3-compatible):
//   rclone sync r2:grocery-corpus ./data     # pull the corpus to a local folder
//   # …edit recipes/ + guidance/ markdown with any tool (Claude Code, an editor)…
//   rclone sync ./data r2:grocery-corpus      # push it back
// (Configure an `r2` rclone remote with an R2 S3 API token; see docs/SELF_HOSTING.md.)
// Per-author Obsidian sync targets the same bucket via Remotely Save.
//
// Usage:
//   node scripts/migrate-corpus-to-r2.mjs --root /path/to/data-repo            # copy (remote)
//   node scripts/migrate-corpus-to-r2.mjs --root /path/to/data-repo --local    # copy to the dev R2
//   node scripts/migrate-corpus-to-r2.mjs --root /path/to/data-repo --check    # list, write nothing
//   node scripts/migrate-corpus-to-r2.mjs --root /path/to/data-repo --verify   # parity: R2 vs local

import { readFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const BUCKET = "grocery-corpus";
// Only the two authored trees move to R2; everything else in the data repo is config/control.
const CORPUS_DIRS = ["recipes", "guidance"];

/** Recursively collect `.md` files under `dir`, returned as repo-relative POSIX paths. */
async function listMarkdown(root, dir, acc = []) {
  let entries;
  try {
    entries = await readdir(path.join(root, dir), { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return acc; // an absent tree is fine (empty)
    throw err;
  }
  for (const e of entries) {
    if (e.name === ".git" || e.name === "node_modules") continue;
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) await listMarkdown(root, rel, acc);
    else if (e.isFile() && e.name.endsWith(".md")) acc.push(rel);
  }
  return acc;
}

/** Run a wrangler subcommand; returns { ok, stdout, stderr }. */
function wrangler(args, { local }) {
  const full = [...args, local ? "--local" : "--remote"];
  const res = spawnSync("npx", ["wrangler", ...full], { encoding: "utf8" });
  return { ok: res.status === 0, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

async function putObject(root, rel, opts) {
  const r = wrangler(["r2", "object", "put", `${BUCKET}/${rel}`, "--file", path.join(root, rel)], opts);
  if (!r.ok) throw new Error(`put ${rel} failed: ${r.stderr.trim() || r.stdout.trim()}`);
}

/** Read an object back from R2 and compare to the local file. Returns null if identical, else a reason. */
async function verifyObject(root, rel, opts) {
  const r = wrangler(["r2", "object", "get", `${BUCKET}/${rel}`, "--pipe"], opts);
  if (!r.ok) return `missing in R2 (${r.stderr.trim() || "get failed"})`;
  const local = await readFile(path.join(root, rel), "utf8");
  return r.stdout === local ? null : "content differs between R2 and git";
}

async function main() {
  const argv = process.argv.slice(2);
  const rootIdx = argv.indexOf("--root");
  const root = rootIdx !== -1 ? path.resolve(argv[rootIdx + 1]) : process.cwd();
  const opts = { local: argv.includes("--local") };
  const check = argv.includes("--check");
  const verify = argv.includes("--verify");

  const files = (await Promise.all(CORPUS_DIRS.map((d) => listMarkdown(root, d)))).flat().sort();
  console.log(`corpus: ${files.length} markdown file(s) under ${CORPUS_DIRS.join(" + ")}/ in ${root}`);

  if (check) {
    for (const f of files) console.log(`  would copy → ${BUCKET}/${f}`);
    console.log(`(--check: nothing written)`);
    return;
  }

  if (verify) {
    const mismatches = [];
    for (const f of files) {
      const reason = await verifyObject(root, f, opts);
      if (reason) mismatches.push(`${f}: ${reason}`);
    }
    if (mismatches.length) {
      for (const m of mismatches) console.error(`  PARITY FAIL ${m}`);
      console.error(`\nparity check failed: ${mismatches.length}/${files.length} object(s) differ`);
      process.exit(1);
    }
    console.log(`parity OK: all ${files.length} object(s) match R2 ↔ git`);
    return;
  }

  let copied = 0;
  for (const f of files) {
    await putObject(root, f, opts);
    copied++;
    if (copied % 25 === 0) console.log(`  …${copied}/${files.length}`);
  }
  console.log(`copied ${copied} object(s) into ${BUCKET} (${opts.local ? "local" : "remote"})`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
