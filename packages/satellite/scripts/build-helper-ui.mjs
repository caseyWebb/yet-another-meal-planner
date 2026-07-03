#!/usr/bin/env node
// build-helper-ui.mjs — build the localhost Order Helper UI into src/helper/public/, the static
// bundle the helper server (src/helper/server.ts) serves at `GET /` and `GET /assets/*`.
//
// Unlike the Worker admin islands (a gitignored build artifact — their esbuild bundles embed the
// aube virtual-store path), THIS bundle embeds no environment-specific paths: the API is same-origin
// relative and React is vendored, so the output is reproducible across machines and is COMMITTED.
// That keeps `grocery-satellite order` working offline from a clean checkout with no build step
// (the satellite Docker image runs the source via tsx and serves the committed public/ directly).
//
// The bundle is fully self-contained and offline: NO CDN, NO in-browser Babel. React 18.3.1
// production UMD is vendored under src/helper/ui/vendor/react/ and concatenated ahead of the
// esbuild-bundled app (classic JSX transform → React.createElement against the global React). The
// stylesheet concatenates the vendored Basecoat design-system CSS (with the external Google-Fonts
// @import stripped — the system stack is the intended fallback) + the order-helper theme.
//
// Output layout (served: `/` → index.html, `/assets/*` → assets/*):
//   src/helper/public/index.html
//   src/helper/public/assets/app.js    (react + react-dom + app, IIFE, minified)
//   src/helper/public/assets/app.css
//
// Usage: node scripts/build-helper-ui.mjs [--check]
//   --check  build in memory and fail (exit 1) if the committed public/ is stale — a drift gate.

import esbuild from "esbuild";
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const UI_DIR = path.join(PKG_ROOT, "src", "helper", "ui");
const OUT_DIR = path.join(PKG_ROOT, "src", "helper", "public");
const APP_ENTRY = path.join(UI_DIR, "app.jsx");
const VENDOR = path.join(UI_DIR, "vendor", "react");

// The Basecoat design-system CSS + the order-helper theme, concatenated in import order.
const CSS_PARTS = [
  path.join(UI_DIR, "css", "ds", "colors.css"),
  path.join(UI_DIR, "css", "ds", "typography.css"),
  path.join(UI_DIR, "css", "ds", "radius.css"),
  path.join(UI_DIR, "css", "ds", "base.css"),
  path.join(UI_DIR, "css", "ds", "basecoat.css"),
  path.join(UI_DIR, "css", "order-helper.css"),
];

/** Bundle the app to one minified IIFE string. React/ReactDOM stay global (the vendored UMD). */
async function bundleApp() {
  const result = await esbuild.build({
    entryPoints: [APP_ENTRY],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2019",
    jsx: "transform",
    jsxFactory: "React.createElement",
    jsxFragment: "React.Fragment",
    minify: true,
    legalComments: "none",
    write: false,
  });
  return result.outputFiles[0].text;
}

/** The app.js: vendored React production UMD, then React-DOM, then the bundled app. */
async function buildAppJs() {
  const react = readFileSync(path.join(VENDOR, "react.production.min.js"), "utf8");
  const reactDom = readFileSync(path.join(VENDOR, "react-dom.production.min.js"), "utf8");
  const app = await bundleApp();
  return [
    "/* Order Helper — self-contained bundle. React 18.3.1 (production UMD, vendored) + the app.",
    "   Built by scripts/build-helper-ui.mjs from src/helper/ui/ — do not hand-edit. */",
    react,
    reactDom,
    app,
  ].join("\n");
}

/** The app.css: concatenated Basecoat DS + order-helper theme (all vendored, offline). */
function buildAppCss() {
  return CSS_PARTS.map((p) => readFileSync(p, "utf8")).join("\n");
}

const INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <title>Order Helper</title>
    <link rel="icon" href="data:," />
    <link rel="stylesheet" href="/assets/app.css" />
    <script>
      /* Apply the saved / OS-preferred theme before paint to avoid a flash. */
      (function () {
        try {
          var t = localStorage.getItem("oh:theme");
          if (t !== "light" && t !== "dark") {
            t = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
          }
          if (t === "dark") document.documentElement.classList.add("dark");
        } catch (e) {}
      })();
    </script>
  </head>
  <body>
    <div id="oh-root"></div>
    <script src="/assets/app.js"></script>
  </body>
</html>
`;

/** The full committed output as a { relativePath -> content } map. */
async function buildFiles() {
  return {
    "index.html": INDEX_HTML,
    "assets/app.js": await buildAppJs(),
    "assets/app.css": buildAppCss(),
  };
}

async function main() {
  const check = process.argv.slice(2).includes("--check");
  const files = await buildFiles();

  if (check) {
    let stale = false;
    for (const [rel, content] of Object.entries(files)) {
      const p = path.join(OUT_DIR, rel);
      const current = existsSync(p) ? readFileSync(p, "utf8") : null;
      if (current !== content) {
        console.error(`stale: ${path.relative(PKG_ROOT, p)}`);
        stale = true;
      }
    }
    if (stale) {
      console.error("helper UI bundle is out of date — run `npm run build:helper-ui` and commit src/helper/public/.");
      process.exit(1);
    }
    console.log("helper UI bundle up to date.");
    return;
  }

  // Rebuild assets/ clean so a renamed/removed asset never lingers.
  const assetsDir = path.join(OUT_DIR, "assets");
  if (existsSync(assetsDir)) rmSync(assetsDir, { recursive: true, force: true });
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(OUT_DIR, rel);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, content);
    console.log(`wrote ${path.relative(PKG_ROOT, p)} (${content.length} bytes)`);
  }
}

await main();
