#!/usr/bin/env node
// build-admin.mjs — compile the operator admin SPA (admin/src/Main.elm) into the
// committed static bundle the Worker serves via its ASSETS binding (operator-admin).
//
// Output layout maps URL paths under /admin/ to files, so the bundle lands under an
// `admin/` subdir of the output root (the ASSETS `directory` is the root):
//   <out>/admin/elm.js      (elm make --optimize)
//   <out>/admin/index.html  (copied from admin/index.html)
//
// Mirrors build-plugin.mjs: ESM, hand-rolled, deterministic, with a
// --check validate-only mode (the CI drift gate) that fails if the committed bundle is
// stale — so admin/dist/ is treated like plugin/ (generated, never hand-edited).
//
// Elm needs its package registry (package.elm-lang.org) reachable at build time. Set
// ELM to override the compiler binary; it defaults to `npx --yes elm@<ELM_VERSION>`.
//
// Usage:
//   node scripts/build-admin.mjs [--out admin/dist] [--check]

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";

const ELM_VERSION = "0.19.1-6";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ADMIN_DIR = path.join(REPO_ROOT, "admin");

function parseArgs(argv) {
  const args = { out: path.join("admin", "dist"), check: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--check") args.check = true;
    else if (argv[i] === "--out") args.out = argv[++i];
  }
  return args;
}

function elmInvocation() {
  if (process.env.ELM) return { cmd: process.env.ELM, base: [] };
  return { cmd: "npx", base: ["--yes", `elm@${ELM_VERSION}`] };
}

/** Compile Main.elm to an optimized JS string. Throws on a compile or registry error. */
function compileElm() {
  const tmp = path.join(os.tmpdir(), `admin-elm-${process.pid}.js`);
  const { cmd, base } = elmInvocation();
  try {
    execFileSync(cmd, [...base, "make", path.join("src", "Main.elm"), "--optimize", "--output", tmp], {
      cwd: ADMIN_DIR,
      stdio: ["ignore", "inherit", "inherit"],
    });
    return readFileSync(tmp, "utf8");
  } finally {
    if (existsSync(tmp)) rmSync(tmp);
  }
}

/** The bundle as a { relativePath -> content } map (the unit of compare/write). */
function buildFiles() {
  return {
    "admin/elm.js": compileElm(),
    "admin/index.html": readFileSync(path.join(ADMIN_DIR, "index.html"), "utf8"),
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const outRoot = path.resolve(REPO_ROOT, args.out);
  const files = buildFiles();

  if (args.check) {
    let stale = false;
    for (const [rel, content] of Object.entries(files)) {
      const p = path.join(outRoot, rel);
      const current = existsSync(p) ? readFileSync(p, "utf8") : null;
      if (current !== content) {
        console.error(`stale: ${path.relative(REPO_ROOT, p)}`);
        stale = true;
      }
    }
    if (stale) {
      console.error("admin bundle is out of date — run `aubr build:admin` and commit admin/dist/.");
      process.exit(1);
    }
    console.log("admin bundle up to date.");
    return;
  }

  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(outRoot, rel);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, content);
    console.log(`wrote ${path.relative(REPO_ROOT, p)}`);
  }
}

main();
