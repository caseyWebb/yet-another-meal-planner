#!/usr/bin/env node
// webServer entrypoint for the admin Playwright harness (admin-ui-testing). Builds the islands +
// Tailwind/Basecoat stylesheet, applies the D1 migrations to the LOCAL SQLite, applies the
// deterministic seed (seed.mjs: D1 rows + the tenant/OAuth/Kroger KV entries, timestamps
// relative to this run's clock), then runs `wrangler dev --local` with the Access dev-bypass.
// `--local` disables remote bindings, so the `AI` binding renders as "not supported" instead of
// opening a credentialed remote-proxy session (CI has no Cloudflare token — that session fails
// to start); the harness never invokes AI. Long-running: the final `wrangler dev` is the server
// Playwright waits on. Everything is local + offline (miniflare D1/KV).

import { execFileSync } from "node:child_process";
import { d1Statements, kvEntries } from "./seed.mjs";

const sh = (cmd, args) => execFileSync(cmd, args, { stdio: "inherit" });

const now = Date.now();

sh("node", ["scripts/build-admin.mjs"]);
sh("npx", ["wrangler", "d1", "migrations", "apply", "DB", "--local"]);
sh("npx", ["wrangler", "d1", "execute", "DB", "--local", "--command", d1Statements(now).join(" ")]);
for (const [binding, key, value] of kvEntries()) {
  sh("npx", ["wrangler", "kv", "key", "put", key, value, "--binding", binding, "--local"]);
}
sh("npx", ["wrangler", "dev", "--local", "--port", process.env.PW_PORT || "8787", "--var", "ADMIN_DEV_BYPASS:1"]);
