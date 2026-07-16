#!/usr/bin/env node
// webServer entrypoint for the MEMBER APP Playwright harness (app-ui-testing), the
// sibling and mirror of admin/visual/setup.mjs. Builds the admin SPA (Vite → assets/admin/)
// AND the member SPA (index.html + hashed chunks into the same merged assets/ root),
// applies the D1 migrations to the LOCAL SQLite, applies the SHARED deterministic seed
// (admin/visual/seed.mjs — one fixture set for both suites, extended with the app's
// invite mapping), then runs `wrangler dev --local` on PW_APP_PORT (default 8788, so
// the two suites can coexist). Long-running: the final `wrangler dev` is the server
// Playwright waits on. Everything is local + offline (miniflare D1/KV) — the app suite
// needs no Access bypass (nothing here touches /admin pages).

import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SEED, d1Statements, kvEntries, saasD1Statements } from "../../admin/visual/seed.mjs";

const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: "inherit", ...opts });

const now = Date.now();

sh("npx", ["vite", "build"], { cwd: "../admin-app" });
// The SPA build (packages/app → ../app from this package's cwd). BOTH sides are stamped
// with one non-"dev" harness id (member-app-offline D11): baseline specs see no skew
// (ids equal), the update spec can fabricate a differing header, and the persister's
// buster is exercised with a real value.
const HARNESS_BUILD = "pw-harness";
sh("npx", ["vite", "build"], { cwd: "../app", env: { ...process.env, VITE_APP_BUILD: HARNESS_BUILD } });
sh("npx", ["wrangler", "d1", "migrations", "apply", "DB", "--local"]);
sh("npx", ["wrangler", "d1", "execute", "DB", "--local", "--command", d1Statements(now).join(" ")]);
for (const [binding, key, value] of kvEntries()) {
  sh("npx", ["wrangler", "kv", "key", "put", key, value, "--binding", binding, "--local"]);
}

// Deterministic member session for the app-ui suite (app-ui-suite-deterministic-auth):
// mint the session SERVER-SIDE and hand it to Playwright as storageState, so the `authed`
// project's specs start pre-authenticated and issue ZERO login HTTP — no per-test UI login,
// no pressure on `POST /api/session`'s 10/min/IP limiter. The record mirrors exactly what
// `createSession` writes (src/session.ts): `session:<token>` in TENANT_KV holds the member's
// tenant, read back by `requireSession`. `tenant:<active>` is already seeded by kvEntries
// above, so the allowlist re-check `resolveTenant` runs resolves. Written to the SAME local
// `.wrangler/state` the running `wrangler dev` below reads (identical `kv key put --local`).
const SESSION_TTL_S = 90 * 24 * 60 * 60; // ~90d — mirrors session.ts SESSION_TTL_S
const APP_SESSION_TOKEN = `pw-app-session-${SEED.members.active}`;
const SPEND_SESSION_TOKEN = `pw-app-session-${SEED.app.spend.fixtureTenant}`;
for (const [token, tenant] of [
  [APP_SESSION_TOKEN, SEED.members.active],
  [SPEND_SESSION_TOKEN, SEED.app.spend.fixtureTenant],
]) {
  sh("npx", [
    "wrangler",
    "kv",
    "key",
    "put",
    `session:${token}`,
    JSON.stringify({ tenant, created_at: now, refreshed_at: now }),
    "--binding",
    "TENANT_KV",
    "--local",
  ]);
}
// The Playwright storageState the `authed` project loads: the `__Host-session` cookie
// carrying the token above, with the EXACT attributes `setSessionCookie` sets (src/session.ts:
// Path=/, Secure, HttpOnly, SameSite=Lax). Chromium treats 127.0.0.1 as a trustworthy origin,
// so the __Host- cookie rides under `wrangler dev`. Gitignored + regenerated every run — never
// committed and never published as a CI artifact.
const authDir = join("app", "visual", ".auth");
mkdirSync(authDir, { recursive: true });
writeFileSync(
  join(authDir, `${SEED.members.active}.json`),
  JSON.stringify({
    cookies: [
      {
        name: "__Host-session",
        value: APP_SESSION_TOKEN,
        domain: "127.0.0.1",
        path: "/",
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
        expires: Math.floor(now / 1000) + SESSION_TTL_S,
      },
    ],
    origins: [],
  }),
);
// The recipe BODY lives in the R2 corpus (readRecipeDetail reads recipes/<slug>.md) —
// put the seeded recipe's markdown into the local bucket so the detail page renders.
// App-suite-only: the admin suite keeps its empty-corpus posture (D1-only "orphaned").
const recipeMd = `---
title: ${SEED.recipe.title}
source: ${SEED.recipe.source}
protein: fish
cuisine: japanese
time_total: 35
dietary: []
requires_equipment: []
pairs_with: []
---

## Ingredients

- 4 salmon fillets
- 3 tbsp white miso
- 2 cups jasmine rice

## Instructions

1. **Whisk the glaze:** Whisk the miso glaze.
2. **Broil:** Broil the salmon for 8 minutes until lacquered.
3. **Serve:** Serve over rice.
`;
const tmp = mkdtempSync(join(tmpdir(), "app-seed-"));
const mdPath = join(tmp, "recipe.md");
writeFileSync(mdPath, recipeMd);
sh("npx", ["wrangler", "r2", "object", "put", `yamp-corpus/recipes/${SEED.recipe.slug}.md`, "--file", mdPath, "--local"]);
// The lens fixture slugs (SEED.app.lens) need readable BODIES on the SAAS server —
// the note-tier composer specs open their DETAIL pages there (readRecipeDetail reads
// recipes/<slug>.md; without a body the page 404s regardless of the D1 lens). Only the
// saas persist dir gets them (seeded further down): no default-server spec opens these
// slugs' detail pages, and each `wrangler r2 object put` is a full CLI boot — four
// puts on one server keep setup inside the webServer readiness budget.
const lensSlugs = [...SEED.app.lens.curated, SEED.app.lens.outOfLens];
const lensMdPath = (slug) => {
  const p = join(tmp, `${slug}.md`);
  writeFileSync(
    p,
    recipeMd.replace(`title: ${SEED.recipe.title}`, `title: ${slug}`).replace(`source: ${SEED.recipe.source}`, `source: https://example.com/${slug}`),
  );
  return p;
};

// Deterministic operator config (connect-modal): the connect modal's specs assert
// TEMPLATED copy — in production MARKETPLACE_REPO is stamped by the deploy and
// OPERATOR_NAME falls back to OWNER_TENANT_ID; here both are fixture values.
const devVars = [
  "--var",
  `APP_BUILD:${HARNESS_BUILD}`,
  "--var",
  "MARKETPLACE_REPO:caseyWebb/yet-another-meal-planner-deployment",
  "--var",
  `OPERATOR_NAME:${SEED.members.active}`,
];

// --- the SaaS deployment variant (deployment-profiles-and-visibility-lens) ----------
// The deployment profile is a D1 SINGLETON (operator_config.deployment_profile), so one
// server can only ever be one profile — the SaaS cold-start / curated / lens specs run
// against a SECOND `wrangler dev` over a DEDICATED persist dir seeded with the identical
// fixture set plus the saas overlay (saasD1Statements). The default state stays
// self-hosted, so every existing spec is untouched; the `saas` Playwright project points
// its baseURL at this port (cookies are host-scoped, not port-scoped, so the authed
// storageState works on both). Spawned in the background — Playwright tears down this
// setup's whole process tree, taking the sibling server with it; global-setup warms both.
const SAAS_PORT = process.env.PW_APP_SAAS_PORT || "8789";
const SAAS_STATE = ".wrangler/state-app-saas";
sh("npx", ["wrangler", "d1", "migrations", "apply", "DB", "--local", "--persist-to", SAAS_STATE]);
sh("npx", [
  "wrangler",
  "d1",
  "execute",
  "DB",
  "--local",
  "--persist-to",
  SAAS_STATE,
  "--command",
  [...d1Statements(now), ...saasD1Statements()].join(" "),
]);
for (const [binding, key, value] of kvEntries()) {
  sh("npx", ["wrangler", "kv", "key", "put", key, value, "--binding", binding, "--local", "--persist-to", SAAS_STATE]);
}
// The R2 corpus bodies this server's specs open: the shared seeded recipe plus the
// lens fixture slugs (their detail pages are only visited in the saas specs).
for (const slug of [SEED.recipe.slug, ...lensSlugs]) {
  const file = slug === SEED.recipe.slug ? mdPath : lensMdPath(slug);
  sh("npx", ["wrangler", "r2", "object", "put", `yamp-corpus/recipes/${slug}.md`, "--file", file, "--local", "--persist-to", SAAS_STATE]);
}
// The same server-side member sessions as the default state, so the shared storageState
// cookie authenticates against this variant too.
for (const [token, tenant] of [
  [APP_SESSION_TOKEN, SEED.members.active],
  [SPEND_SESSION_TOKEN, SEED.app.spend.fixtureTenant],
]) {
  sh("npx", [
    "wrangler",
    "kv",
    "key",
    "put",
    `session:${token}`,
    JSON.stringify({ tenant, created_at: now, refreshed_at: now }),
    "--binding",
    "TENANT_KV",
    "--local",
    "--persist-to",
    SAAS_STATE,
  ]);
}
// DISTINCT inspector ports: `wrangler dev` binds a debug inspector on 9229 by default,
// so two instances in one container race for it — whichever boots second dies with
// "Address already in use (127.0.0.1:9229)" (a nondeterministic boot failure). Pin both.
spawn(
  "npx",
  ["wrangler", "dev", "--local", "--port", SAAS_PORT, "--inspector-port", "9330", "--persist-to", SAAS_STATE, ...devVars],
  {
    stdio: "inherit",
  },
);

sh("npx", ["wrangler", "dev", "--local", "--port", process.env.PW_APP_PORT || "8788", "--inspector-port", "9329", ...devVars]);
