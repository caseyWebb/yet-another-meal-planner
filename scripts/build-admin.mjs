#!/usr/bin/env node
// build-admin.mjs — compile the operator admin islands (src/admin/client/*.tsx) and compile the
// stylesheet (Tailwind v4 + Basecoat) into admin/dist, the static bundle the Worker serves via its ASSETS binding
// (operator-admin). The server pages are server-rendered in the Worker (Hono JSX, built by
// wrangler's esbuild); only the browser islands + the stylesheet are pre-built static assets.
//
// admin/dist/ is a BUILD ARTIFACT — NOT committed (gitignored). CI and the deploy build it
// fresh, and local `wrangler dev` needs a build first. (The esbuild bundles embed
// environment-specific module paths — the aube virtual-store location — so a committed copy
// would not be reproducible across machines, which is why we build rather than commit.)
//
// Output layout maps URL paths under /admin/ to files (ASSETS `directory` is admin/dist):
//   <out>/admin/islands/<name>.js   (esbuild bundle, browser ESM, hono/jsx/dom runtime)
//   <out>/admin/styles.css          (Tailwind-compiled from src/admin/styles.css: Basecoat + the panel's utilities)
//
// esbuild + Tailwind, both run from installed node_modules — NO network package registry needed, so any
// sandbox can rebuild it (Tailwind v4's engine is a prebuilt binary, like esbuild). A --check
// validate-only mode is kept for local "does my tree match a prior build" comparisons (it is
// NOT a CI gate — there is no committed bundle to compare against).
//
// Usage: node scripts/build-admin.mjs [--out admin/dist] [--check]

import esbuild from "esbuild";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLIENT_DIR = path.join(REPO_ROOT, "src", "admin", "client");
const STYLES_SRC = path.join(REPO_ROOT, "src", "admin", "styles.css");
const TAILWIND_BIN = path.join(REPO_ROOT, "node_modules", ".bin", "tailwindcss");

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

/** Compile the Tailwind entry (Basecoat + the panel's utilities) to a CSS string. Runs the
 *  Tailwind CLI from installed node_modules — no network — so any sandbox rebuilds it. */
function compileStyles() {
  const out = path.join(tmpdir(), `admin-styles-${process.pid}.css`);
  try {
    execFileSync(TAILWIND_BIN, ["-i", STYLES_SRC, "-o", out, "--minify"], {
      cwd: REPO_ROOT,
      stdio: ["ignore", "ignore", "inherit"],
    });
    return readFileSync(out, "utf8");
  } finally {
    rmSync(out, { force: true });
  }
}

/** The bundle as a { relativePath -> content } map (the unit of compare/write). */
async function buildFiles() {
  const files = {};
  for (const { name, file } of islandEntries()) {
    files[`admin/islands/${name}.js`] = await bundleIsland(file);
  }
  files["admin/styles.css"] = compileStyles();
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
