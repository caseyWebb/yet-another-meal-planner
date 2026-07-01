// A drop-in for the retired `handleAdmin(request, env)` entry point: drives the Hono admin
// app the same way the Worker does (`app.fetch`). Lets the area tests exercise the real
// `/admin*` surface with their existing `handleAdmin(new Request(...), env)` call shape.
// The Hono app SSRs pages and serves the JSON API + the Access gate, so these are end-to-end.

import app from "../src/admin/app.js";
import type { Env } from "../src/env.js";

export function handleAdmin(request: Request, env: Env): Promise<Response> {
  return Promise.resolve(app.fetch(request, env));
}
