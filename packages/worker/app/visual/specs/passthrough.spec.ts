// Worker-path passthrough (member-app-shell): with the single-page-application fallback
// live, every Worker-owned path must still answer as a Worker surface — never the SPA
// shell. These pin the two open representatives (/health JSON, /cookbook SSR HTML); the
// run_worker_first enumeration in wrangler.jsonc is the contract they guard.
import { test, expect } from "../fixtures";

test("/health answers as the machine liveness check, not the shell", async ({ request }) => {
  const res = await request.get("/health");
  expect(res.headers()["content-type"]).toContain("application/json");
  const body = (await res.json()) as { ok: boolean; jobs: unknown[] };
  expect(typeof body.ok).toBe("boolean");
  expect(Array.isArray(body.jobs)).toBe(true);
});

test("/cookbook answers with the Worker's SSR HTML, not the shell", async ({ request }) => {
  const res = await request.get("/cookbook");
  expect(res.ok()).toBe(true);
  const html = await res.text();
  expect(html).toContain("<h1>Cookbook</h1>"); // the cookbook SSR page
  expect(html).not.toContain('<div id="root">'); // never the SPA shell
});

test("Worker routes stay Worker-rendered while service-worker-CONTROLLED", async ({ page }) => {
  // The browser-level half of the denylist gate (member-app-offline D8; the static
  // config drift test is tests/navigate-denylist.test.mjs): once the SW controls the
  // page, its navigation fallback must still let Worker-owned paths through to the
  // network, never answer them with the precached shell.
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    return true;
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

  const cookbook = await page.goto("/cookbook");
  expect(cookbook!.ok()).toBe(true);
  const html = await cookbook!.text();
  expect(html).toContain("<h1>Cookbook</h1>"); // the Worker's SSR page
  expect(html).not.toContain('<div id="root">'); // never the SPA shell

  const health = await page.goto("/health");
  expect(health!.headers()["content-type"]).toContain("application/json"); // Worker JSON, not the shell
});

test("a client-side deep link falls back to the shell", async ({ request }) => {
  // /login is no static file and no Worker route — the single-page-application fallback
  // serves index.html and the client router resolves it (the login spec drives the UI).
  const res = await request.get("/login");
  expect(res.ok()).toBe(true);
  expect(await res.text()).toContain('<div id="root">');
});

test("/api/passkey/login/options answers as a Worker route, not the shell", async ({ request }) => {
  // The passkey endpoints are new Worker-owned /api routes (webauthn-passkey-auth 5.3): the
  // run_worker_first enumeration must carry them, or the SPA fallback would swallow them.
  // This representative POST must reach the Worker and return its discoverable-options JSON
  // (unauthenticated is allowed) — never the SPA shell HTML.
  const res = await request.post("/api/passkey/login/options", { headers: { "X-App-Csrf": "1" } });
  expect(res.headers()["content-type"]).toContain("application/json");
  const body = (await res.json()) as { challenge?: string; error?: string };
  // The options blob (a challenge) or a structured rate-limit — either is the Worker answering.
  expect(typeof body.challenge === "string" || typeof body.error === "string").toBe(true);
});
