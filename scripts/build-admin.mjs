#!/usr/bin/env node
// build-admin.mjs — compile the operator admin islands (src/admin/client/*.tsx) and copy the
// stylesheet into the committed static bundle the Worker serves via its ASSETS binding
// (operator-admin). The server pages are server-rendered in the Worker (Hono JSX, built by
// wrangler's esbuild); only the browser islands + the stylesheet are pre-built static assets.
//
// Output layout maps URL paths under /admin/ to files (ASSETS `directory` is admin/dist):
//   <out>/admin/islands/<name>.js   (esbuild bundle, browser ESM, hono/jsx/dom runtime)
//   <out>/admin/styles.css          (copied from src/admin/styles.css)
//
// esbuild only — NO network package registry needed, so any sandbox can rebuild it (the whole
// point of leaving Elm: package.elm-lang.org is gone). Hand-rolled + deterministic, mirroring
// build-plugin.mjs, with a --check validate-only mode (the CI drift gate). The Elm bundle
// (admin/dist/admin/{elm.js,index.html}) stays committed and is served by default until the
// cutover flip (Phase 5) removes it; this script no longer builds Elm.
//
// Usage: node scripts/build-admin.mjs [--out admin/dist] [--check]

import esbuild from "esbuild";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLIENT_DIR = path.join(REPO_ROOT, "src", "admin", "client");
const STYLES_SRC = path.join(REPO_ROOT, "src", "admin", "styles.css");

function parseArgs(argv) {
  const args = { out: path.join("admin", "dist"), check: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--check") args.check = true;
    else if (argv[i] === "--out") args.out = argv[++i];
  }
  return args;
}

/** Island entrypoints: every `*.tsx` directly under src/admin/client (one bundle each). */
function islandEntries() {
  return readdirSync(CLIENT_DIR)
    .filter((f) => f.endsWith(".tsx"))
    .sort()
    .map((f) => ({ name: f.replace(/\.tsx$/, ""), file: path.join(CLIENT_DIR, f) }));
}

/** Bundle one island to an ESM string (deterministic; no minify for a stable drift diff). */
async function bundleIsland(file) {
  const result = await esbuild.build({
    entryPoints: [file],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    jsx: "automatic",
    jsxImportSource: "hono/jsx/dom",
    minify: false,
    write: false,
  });
  return result.outputFiles[0].text;
}

/** The bundle as a { relativePath -> content } map (the unit of compare/write). */
async function buildFiles() {
  const files = {};
  for (const { name, file } of islandEntries()) {
    files[`admin/islands/${name}.js`] = await bundleIsland(file);
  }
  files["admin/styles.css"] = readFileSync(STYLES_SRC, "utf8");
  return files;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outRoot = path.resolve(REPO_ROOT, args.out);
  const files = await buildFiles();

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

await main();
