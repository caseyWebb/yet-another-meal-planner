// The SW-denylist ↔ run_worker_first drift gate (member-app-offline D8): with the
// single-page-application fallback live, `wrangler.jsonc`'s run_worker_first IS the
// routing contract — and the member SPA's service worker must mirror it in
// `navigateFallbackDenylist`, or a Worker-owned route gets answered with the SPA shell
// from the SW's precache the moment a member goes offline (or the SW wins the race
// online). This test parses BOTH configs from source and asserts every Worker-owned
// prefix is denylisted, so "add the entry in the same change" is a gate, not prose.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import JSON5 from "json5";

const here = dirname(fileURLToPath(import.meta.url));
const workerRoot = join(here, "..");

/** wrangler.jsonc's run_worker_first enumeration (JSON5 tolerates the comments). */
function workerFirstPaths() {
  const config = JSON5.parse(readFileSync(join(workerRoot, "wrangler.jsonc"), "utf8"));
  const paths = config.assets?.run_worker_first;
  assert.ok(Array.isArray(paths) && paths.length > 0, "wrangler.jsonc assets.run_worker_first missing");
  return paths;
}

/** The denylist regexes, extracted from the vite config's source text. */
function denylistRegexes() {
  const source = readFileSync(join(workerRoot, "../app/vite.config.ts"), "utf8");
  const block = source.match(/navigateFallbackDenylist:\s*\[([\s\S]*?)\]/);
  assert.ok(block, "vite.config.ts navigateFallbackDenylist not found");
  // Regex literals inside the array: /.../flags (no whitespace inside — by convention).
  const literals = block[1].match(/\/(?:\\.|[^/\n])+\/[a-z]*/g) ?? [];
  assert.ok(literals.length > 0, "no regex literals inside navigateFallbackDenylist");
  return literals.map((lit) => {
    const lastSlash = lit.lastIndexOf("/");
    return new RegExp(lit.slice(1, lastSlash), lit.slice(lastSlash + 1));
  });
}

/** Representative request paths for one run_worker_first entry. */
function representativesOf(entry) {
  if (entry.endsWith("/*")) {
    const base = entry.slice(0, -2);
    return [`${base}/anything`, `${base}/a/b`];
  }
  return [entry];
}

test("every run_worker_first prefix is covered by the SPA's navigateFallbackDenylist", () => {
  const regexes = denylistRegexes();
  for (const entry of workerFirstPaths()) {
    for (const path of representativesOf(entry)) {
      assert.ok(
        regexes.some((re) => re.test(path)),
        `run_worker_first entry ${entry} (as ${path}) is NOT matched by the SW denylist — ` +
          "add it to navigateFallbackDenylist in packages/app/vite.config.ts in the same change",
      );
    }
  }
});

test("dotted Worker paths (/health.svg-style) are covered", () => {
  // The `(\/|$|\.)` tail is what covers extensions — pin it explicitly so a
  // simplification doesn't silently drop the /health.svg class.
  const regexes = denylistRegexes();
  assert.ok(regexes.some((re) => re.test("/health.svg")));
});

test("SPA client routes are NOT denylisted (the fallback still serves the app)", () => {
  const regexes = denylistRegexes();
  for (const path of ["/", "/login", "/grocery", "/plan", "/recipe/some-slug", "/healthy-recipes"]) {
    assert.ok(
      !regexes.some((re) => re.test(path)),
      `${path} must fall back to the SPA shell but matches the denylist`,
    );
  }
});
