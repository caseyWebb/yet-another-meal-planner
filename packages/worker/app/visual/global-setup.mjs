// Authenticated warmup gate for the app-ui suite (app-ui-suite-deterministic-auth), the
// sibling of setup.mjs. The webServer's `/health` readiness proves the Worker is listening;
// this globalSetup goes one step further and proves the AUTHENTICATED path is warm before any
// worker starts a test: it polls the whoami endpoint (`GET /api/session`) with the fabricated
// `__Host-session` cookie until it returns 200. A 200 exercises the whole cold-start chain the
// authed specs depend on — the KV session read (`session:<token>`), the tenant-allowlist
// re-check (`tenant:<id>`), and the D1 the resolved handler touches — so the FIRST real test
// never races a still-warming binding. Playwright runs plugin setup (the webServer) before
// globalSetup, so the server is already up here; the bounded poll only absorbs the last of the
// boot latency and never masks a failure (it throws after the budget).
import { SEED } from "../../admin/visual/seed.mjs";

const PORT = Number(process.env.PW_APP_PORT || 8788);
// Must match setup.mjs's APP_SESSION_TOKEN (both derive it from the same seeded member).
const APP_SESSION_TOKEN = `pw-app-session-${SEED.members.active}`;

export default async function globalSetup() {
  const url = `http://127.0.0.1:${PORT}/api/session`;
  const headers = { cookie: `__Host-session=${APP_SESSION_TOKEN}` };
  const attempts = 30;
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, { headers });
      if (res.status === 200) return; // authed read + allowlist + D1 are warm
    } catch {
      // The server is still binding — retry within the budget below.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `app-ui warmup: GET /api/session never returned 200 for the seeded member session after ${attempts} tries`,
  );
}
