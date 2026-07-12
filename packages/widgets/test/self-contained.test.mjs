// Build-target check (recipe-card-widget + meal-plan-widget, spec: "Self-contained,
// zero-external-request widget bundle"). Asserts each emitted widget HTML is ONE self-contained
// document — all JS + CSS inlined, and NO external resource-loading construct (external stylesheet
// link, external `<script src>`, `@font-face`, `@import url(http…)`, `url(http…)` in CSS, or a
// webfont host).
//
// This deliberately checks resource-LOADING constructs, not any "http" substring: a React/DOM
// bundle always embeds inert XML-namespace strings (http://www.w3.org/2000/svg), JSON-schema
// `$schema` ids, and error-doc URLs — those are never fetched and are not external requests.
//
// The package `test` script runs `vite build` first, so the artifacts are fresh when this runs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const widgetsDir = path.resolve(here, "../../worker/assets/widgets");

/** Every widget the Vite build emits: its output basename and the stable marker its HTML carries. */
const WIDGETS = [
  { file: "recipe-card.html", marker: "recipe-card-widget" },
  { file: "plan-propose.html", marker: "plan-propose-widget" },
  { file: "grocery-list.html", marker: "grocery-list-widget" },
];

for (const { file, marker } of WIDGETS) {
  const htmlPath = path.join(widgetsDir, file);

  test(`the ${file} widget bundle is emitted`, () => {
    assert.ok(existsSync(htmlPath), `expected built widget at ${htmlPath} (run \`vite build\` first)`);
  });

  test(`the ${file} widget bundle is self-contained (zero external resource requests)`, () => {
    const html = readFileSync(htmlPath, "utf8");

    // It is one HTML document with an inlined stylesheet and an inlined module script
    // (viteSingleFile emits `<style rel="stylesheet" …>` and a `<script>` with inline body).
    assert.match(html, /<style[\s>]/i, "expected an inlined <style> block");
    assert.match(html, /<script[\s>][^>]*>[^<]/i, "expected an inlined <script> block with a body");

    // No external stylesheet <link> (viteSingleFile inlines CSS).
    assert.doesNotMatch(html, /<link\b[^>]*\brel=["']?stylesheet/i, "found an external stylesheet <link>");
    // No external stylesheet/preload/prefetch pointing at http(s).
    assert.doesNotMatch(html, /<link\b[^>]*\bhref=["']https?:/i, "found an external <link href>");
    // No external script src (all JS inlined).
    assert.doesNotMatch(html, /<script\b[^>]*\bsrc=/i, "found an external <script src>");
    // No external image src.
    assert.doesNotMatch(html, /<img\b[^>]*\bsrc=["']https?:/i, "found an external <img src>");

    // No CSS font-face / external @import / external url() — the Geist webfont was dropped.
    assert.doesNotMatch(html, /@font-face/i, "found an @font-face rule");
    assert.doesNotMatch(html, /@import\s+url\(\s*["']?https?:/i, "found an external CSS @import url()");
    assert.doesNotMatch(html, /url\(\s*["']?https?:\/\//i, "found an external url() in CSS");

    // Never the dropped webfont hosts.
    assert.doesNotMatch(html, /fonts\.googleapis\.com|fonts\.gstatic\.com/i, "found a Google Fonts reference");

    // The stable marker the Worker's ASSETS read asserts.
    assert.ok(html.includes(marker), `expected the ${marker} marker`);
  });
}
