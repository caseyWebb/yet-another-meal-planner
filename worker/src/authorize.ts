// The OAuth authorize UI (multi-tenancy §3.2). The OAuth provider routes
// `/authorize` here; we render our own consent page that collects an
// operator-issued **invite code** (D2 — no third-party login), validate it
// against the allowlist, and complete the grant with `props: { tenantId }`. That
// prop rides every subsequent MCP request (read by the api handler in index.ts).
//
// The parsed OAuth request round-trips through the form as a base64 hidden field,
// so the POST can complete the authorization the provider started on the GET.

import type { AuthRequest } from "@cloudflare/workers-oauth-provider";
import type { Env } from "./env.js";
import { resolveInvite } from "./tenant.js";

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESC[c]);
}

function page(body: string, status: number): Response {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width, initial-scale=1">` +
      `<title>Connect — grocery-agent</title><style>` +
      `body{font-family:system-ui,sans-serif;max-width:28rem;margin:4rem auto;padding:0 1rem;color:#222}` +
      `h1{font-size:1.4rem}label{display:block;margin:1rem 0}input{font-size:1rem;padding:.5rem;width:100%;box-sizing:border-box}` +
      `button{font-size:1rem;padding:.6rem 1.2rem;background:#f4a259;border:0;border-radius:.4rem;cursor:pointer}` +
      `.err{color:#b00020}</style></head><body>${body}</body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

function renderForm(oauthReqB64: string, clientName: string, error?: string): Response {
  return page(
    `<h1>Connect to grocery-agent</h1>` +
      `<p><strong>${esc(clientName)}</strong> wants to connect. Enter your invite code to continue.</p>` +
      (error ? `<p class="err">${esc(error)}</p>` : "") +
      `<form method="post" action="/authorize">` +
      `<input type="hidden" name="oauth_req" value="${esc(oauthReqB64)}">` +
      `<label>Invite code<input name="invite_code" autocomplete="off" autofocus required></label>` +
      `<button type="submit">Authorize</button></form>`,
    error ? 400 : 200,
  );
}

/** Handle `/authorize` (GET renders the invite-code form; POST completes the grant). */
export async function handleAuthorize(request: Request, env: Env): Promise<Response> {
  if (request.method === "GET") {
    const oauthReqInfo = await env.OAUTH_PROVIDER.parseAuthRequest(request);
    const client = await env.OAUTH_PROVIDER.lookupClient(oauthReqInfo.clientId).catch(() => null);
    const name = client?.clientName ?? "An MCP client";
    return renderForm(btoa(JSON.stringify(oauthReqInfo)), name);
  }

  if (request.method === "POST") {
    const form = await request.formData();
    const code = String(form.get("invite_code") ?? "").trim();
    const b64 = String(form.get("oauth_req") ?? "");

    let oauthReqInfo: AuthRequest;
    try {
      oauthReqInfo = JSON.parse(atob(b64)) as AuthRequest;
    } catch {
      return page("<p class=\"err\">Malformed authorization request. Restart the connection.</p>", 400);
    }

    const tenantId = await resolveInvite(env.TENANT_KV, code);
    if (!tenantId) {
      return renderForm(b64, "An MCP client", "That invite code isn't valid. Check it and try again.");
    }

    const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
      request: oauthReqInfo,
      userId: tenantId,
      scope: oauthReqInfo.scope,
      metadata: { label: tenantId },
      props: { tenantId },
    });
    return Response.redirect(redirectTo, 302);
  }

  return new Response("Method not allowed", { status: 405 });
}
