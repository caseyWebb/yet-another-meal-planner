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

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SEED, d1Statements, kvEntries } from "../../admin/visual/seed.mjs";

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
sh("npx", [
  "wrangler",
  "kv",
  "key",
  "put",
  `session:${APP_SESSION_TOKEN}`,
  JSON.stringify({ tenant: SEED.members.active, created_at: now, refreshed_at: now }),
  "--binding",
  "TENANT_KV",
  "--local",
]);
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

sh("npx", [
  "wrangler",
  "dev",
  "--local",
  "--port",
  process.env.PW_APP_PORT || "8788",
  "--var",
  `APP_BUILD:${HARNESS_BUILD}`,
  // Deterministic operator config (connect-modal): the connect modal's specs assert
  // TEMPLATED copy — in production MARKETPLACE_REPO is stamped by the deploy and
  // OPERATOR_NAME falls back to OWNER_TENANT_ID; here both are fixture values.
  "--var",
  "MARKETPLACE_REPO:caseyWebb/yet-another-meal-planner-deployment",
  "--var",
  `OPERATOR_NAME:${SEED.members.active}`,
]);
