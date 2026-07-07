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

test("a client-side deep link falls back to the shell", async ({ request }) => {
  // /login is no static file and no Worker route — the single-page-application fallback
  // serves index.html and the client router resolves it (the login spec drives the UI).
  const res = await request.get("/login");
  expect(res.ok()).toBe(true);
  expect(await res.text()).toContain('<div id="root">');
});
