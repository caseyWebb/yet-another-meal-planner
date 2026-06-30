#!/usr/bin/env node
// webServer entrypoint for the admin visual/smoke harness (operator-admin, Phase 8). Builds the
// islands + Tailwind/Basecoat stylesheet, applies the D1 migrations to the LOCAL SQLite, seeds a
// deterministic discovery-log fixture (so the Logs detail dialog has stable content for the
// screenshot), then runs `wrangler dev` with the Access dev-bypass. Long-running: the final
// `wrangler dev` is the server Playwright waits on. Everything is local + offline (miniflare D1).

import { execFileSync } from "node:child_process";

const sh = (cmd, args) => execFileSync(cmd, args, { stdio: "inherit" });

// Deterministic fixture: two discovery rows — one retryable (Retry/Delete buttons), one openable
// (the detail dialog). Fixed ids/timestamps so the screenshots don't drift run-to-run.
const SEED = [
  "DELETE FROM discovery_log WHERE id IN ('viz-err','viz-rej');",
  "INSERT INTO discovery_log (id,url,title,source,outcome,slug,detail,created_at,attempts,next_retry_at) VALUES",
  "('viz-err','https://example.com/recipe-a','Example Recipe A','demo-feed','error',NULL,'{\"error\":\"fetch failed after 3 tries\"}','2026-01-01T00:00:00Z',1,NULL),",
  "('viz-rej','https://example.com/recipe-b','Example Recipe B','demo-feed','rejected',NULL,'{\"reason\":\"off-diet (contains shellfish)\"}','2026-01-01T00:00:00Z',0,NULL);",
].join(" ");

sh("node", ["scripts/build-admin.mjs"]);
sh("npx", ["wrangler", "d1", "migrations", "apply", "DB", "--local"]);
sh("npx", ["wrangler", "d1", "execute", "DB", "--local", "--command", SEED]);
sh("npx", ["wrangler", "dev", "--port", "8787", "--var", "ADMIN_DEV_BYPASS:1"]);
