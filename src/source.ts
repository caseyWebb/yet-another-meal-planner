// AGPL §13 source offer (open-source-license). The Worker is AGPL-3.0-licensed, and §13 requires
// that anyone interacting with a *modified* version over a network be offered its Corresponding
// Source. `/source` is that offer: a small, open, tenant-clean page linking to the source.
//
// A self-hoster who MODIFIES the Worker MUST point this at THEIR source — set the `SOURCE_URL` var
// to their fork/source location (their Corresponding Source); unset, it names the upstream
// repository. Open and gateless like `/health` — it carries no tenant data, only the license and
// the source location.

import type { Env } from "./env.js";

/** Upstream canonical source — the default when no operator `SOURCE_URL` override is set. */
export const UPSTREAM_SOURCE_URL = "https://github.com/caseyWebb/groceries-agent";

/** Resolve the source URL to offer: the operator's `SOURCE_URL` override, else the upstream repo. */
export function sourceUrl(env: Pick<Env, "SOURCE_URL">): string {
  const override = env.SOURCE_URL?.trim();
  return override ? override : UPSTREAM_SOURCE_URL;
}

/** Minimal HTML escape for safe interpolation of the (operator-controlled) URL. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Handle a `/source` request: the AGPL §13 source offer. Returns a small HTML page naming the
 * license and linking to the Corresponding Source. **Open** (no token) and **tenant-clean** — it
 * states only the license and the source location, never any per-tenant data.
 */
export function handleSource(env: Pick<Env, "SOURCE_URL">): Response {
  const url = sourceUrl(env);
  const safe = esc(url);
  const body =
    `<!doctype html>\n` +
    `<html lang="en">\n<head>\n` +
    `<meta charset="utf-8">\n` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
    `<title>grocery-mcp — source</title>\n` +
    `</head>\n<body>\n` +
    `<h1>grocery-mcp</h1>\n` +
    `<p>This service runs <strong>grocery-mcp</strong>, free software licensed under the ` +
    `<a href="https://www.gnu.org/licenses/agpl-3.0.html">GNU Affero General Public License, version 3</a>.</p>\n` +
    `<p>In accordance with section 13 of that license, the complete corresponding source is available at:</p>\n` +
    `<p><a href="${safe}">${safe}</a></p>\n` +
    `</body>\n</html>\n`;
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
