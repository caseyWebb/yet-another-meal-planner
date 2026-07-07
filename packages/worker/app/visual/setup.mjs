#!/usr/bin/env node
// webServer entrypoint for the MEMBER APP Playwright harness (app-ui-testing), the
// sibling and mirror of admin/visual/setup.mjs. Builds the admin bundle (assets/admin/)
// AND the member SPA (index.html + hashed chunks into the same merged assets/ root),
// applies the D1 migrations to the LOCAL SQLite, applies the SHARED deterministic seed
// (admin/visual/seed.mjs — one fixture set for both suites, extended with the app's
// invite mapping), then runs `wrangler dev --local` on PW_APP_PORT (default 8788, so
// the two suites can coexist). Long-running: the final `wrangler dev` is the server
// Playwright waits on. Everything is local + offline (miniflare D1/KV) — the app suite
// needs no Access bypass (nothing here touches /admin pages).

import { execFileSync } from "node:child_process";
import { d1Statements, kvEntries } from "../../admin/visual/seed.mjs";

const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: "inherit", ...opts });

const now = Date.now();

sh("node", ["scripts/build-admin.mjs"]);
// The SPA build (packages/app → ../app from this package's cwd). Unstamped: the harness
// runs the version-skew contract's local posture (both sides read "dev").
sh("npx", ["vite", "build"], { cwd: "../app" });
sh("npx", ["wrangler", "d1", "migrations", "apply", "DB", "--local"]);
sh("npx", ["wrangler", "d1", "execute", "DB", "--local", "--command", d1Statements(now).join(" ")]);
for (const [binding, key, value] of kvEntries()) {
  sh("npx", ["wrangler", "kv", "key", "put", key, value, "--binding", binding, "--local"]);
}
sh("npx", ["wrangler", "dev", "--local", "--port", process.env.PW_APP_PORT || "8788"]);
