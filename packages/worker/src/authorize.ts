// The OAuth `/authorize` surface (multi-tenancy §3.2, reworked by webauthn-passkey-auth).
// The provider routes `/authorize` here. Identity is proven by CROSS-DEVICE APPROVAL: the GET
// page mints a single-use approval reference and shows a deep link into the passkey-authenticated
// member web app (`/connect`) plus a verification code; the member approves there (binding their
// `(tenant, member)` pair); this page polls `/authorize/status` and, once approved, completes the
// grant with `props: { tenantId, memberId }` — `userId` stays the tenant id, the key the admin
// roster's grant scan groups by. No passkey ceremony runs in Claude's OAuth browser.
//
// During the migration GRACE window (INVITE_GRACE ≠ "off"), the page ALSO offers a legacy
// invite-code form (the pre-passkey path) so members who haven't enrolled can still connect; the
// POST handler completes the grant from an accepted invite. Once grace is off, only bootstrap
// codes are accepted there and the legacy form is hidden. A malformed request renders a clean 400
// on both GET and POST.

import { renderSVG } from "uqr";
import type { AuthRequest } from "@cloudflare/workers-oauth-provider";
import type { Env } from "./env.js";
import {
  resolveInvite,
  inviteAccepted,
  inviteGraceEnabled,
  resolveIdentity,
  directoryFromEnv,
} from "./tenant.js";
import { mintApproval, claimApproved, viewApproval } from "./connect-approval.js";

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESC[c]);
}

function page(body: string, status: number): Response {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width, initial-scale=1">` +
      `<title>Connect — yamp</title><style>` +
      `body{font-family:system-ui,sans-serif;max-width:28rem;margin:3rem auto;padding:0 1rem;color:#222}` +
      `h1{font-size:1.4rem}label{display:block;margin:1rem 0}input{font-size:1rem;padding:.5rem;width:100%;box-sizing:border-box}` +
      `button{font-size:1rem;padding:.6rem 1.2rem;background:#f4a259;border:0;border-radius:.4rem;cursor:pointer}` +
      `a.cta{display:inline-block;text-decoration:none;color:#222;background:#f4a259;padding:.6rem 1.2rem;border-radius:.4rem}` +
      `.code{font-size:1.6rem;letter-spacing:.2em;font-weight:700;font-family:ui-monospace,monospace}` +
      `.qr{width:180px;margin:.75rem 0}.qr svg{width:100%;height:auto;display:block;border-radius:.3rem}` +
      `.url{word-break:break-all;font-family:ui-monospace,monospace;font-size:.85rem;color:#555;background:#f6f6f6;padding:.5rem;border-radius:.3rem}` +
      `.muted{color:#666;font-size:.9rem}.err{color:#b00020}details{margin-top:2rem}summary{cursor:pointer}` +
      `</style></head><body>${body}</body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

/** The legacy invite-code form fragment, shown only while grace is on (POSTs back to /authorize). */
function legacyInviteForm(oauthReqB64: string, error?: string): string {
  return (
    `<details>` +
    `<summary class="muted">Have an invite code instead?</summary>` +
    (error ? `<p class="err">${esc(error)}</p>` : "") +
    `<form method="post" action="/authorize">` +
    `<input type="hidden" name="oauth_req" value="${esc(oauthReqB64)}">` +
    `<label>Invite code<input name="invite_code" autocomplete="off" required></label>` +
    `<button type="submit">Authorize with code</button></form></details>`
  );
}

/** The cross-device approval page: deep link + verification code + copyable URL + poll script. */
function renderApproval(env: Env, oauthReqB64: string, clientName: string, ref: string, code: string, origin: string): Response {
  const deepLink = `${origin}/connect?authz=${encodeURIComponent(ref)}`;
  const statusUrl = `/authorize/status?authz=${encodeURIComponent(ref)}`;
  // A scannable QR of the deep link for the cross-device (desktop → phone) path. Rendered
  // server-side to a standalone inline <svg> (uqr, zero-dep, workerd-safe) — no client JS, no
  // external request. `border` is the quiet zone; `M` error-correction survives a little occlusion.
  const qr = renderSVG(deepLink, { border: 2, ecc: "M" });
  const legacy = inviteGraceEnabled(env) ? legacyInviteForm(oauthReqB64) : "";
  return page(
    `<h1>Connect to yamp</h1>` +
      `<p><strong>${esc(clientName)}</strong> wants to connect. Approve it from your Cookbook app.</p>` +
      `<p><a class="cta" href="${esc(deepLink)}">Open Cookbook to approve</a></p>` +
      `<p class="muted">On another device? Scan this, or open the link:</p>` +
      `<div class="qr">${qr}</div>` +
      `<p class="url">${esc(deepLink)}</p>` +
      `<p class="muted">Confirm this code matches what Cookbook shows:</p>` +
      `<p class="code">${esc(code)}</p>` +
      `<p id="status" class="muted" role="status">Waiting for approval…</p>` +
      legacy +
      `<script>(function(){` +
      `var s=document.getElementById('status');` +
      `var t=setInterval(function(){` +
      `fetch(${JSON.stringify(statusUrl)},{headers:{'accept':'application/json'}}).then(function(r){return r.json()}).then(function(d){` +
      `if(d.status==='approved'&&d.redirect){clearInterval(t);s.textContent='Approved — connecting…';location.href=d.redirect}` +
      `else if(d.status==='expired'){clearInterval(t);s.textContent='This request expired. Restart the connection.'}` +
      `}).catch(function(){})` +
      `},1500)})();</script>`,
    200,
  );
}

/** Handle `/authorize` (GET renders the cross-device approval; POST is the grace-gated invite path). */
export async function handleAuthorize(request: Request, env: Env): Promise<Response> {
  const origin = new URL(request.url).origin;

  if (request.method === "GET") {
    let oauthReqInfo: AuthRequest;
    try {
      oauthReqInfo = await env.OAUTH_PROVIDER.parseAuthRequest(request);
    } catch {
      return page('<p class="err">Malformed authorization request. Restart the connection.</p>', 400);
    }
    const client = await env.OAUTH_PROVIDER.lookupClient(oauthReqInfo.clientId).catch(() => null);
    const name = client?.clientName ?? "An MCP client";
    const b64 = btoa(JSON.stringify(oauthReqInfo));
    const { ref, code } = await mintApproval(env, b64, name);
    return renderApproval(env, b64, name, ref, code, origin);
  }

  if (request.method === "POST") {
    const form = await request.formData();
    const code = String(form.get("invite_code") ?? "").trim();
    const b64 = String(form.get("oauth_req") ?? "");

    let oauthReqInfo: AuthRequest;
    try {
      oauthReqInfo = JSON.parse(atob(b64)) as AuthRequest;
    } catch {
      return page('<p class="err">Malformed authorization request. Restart the connection.</p>', 400);
    }

    const inv = await resolveInvite(env.TENANT_KV, code);
    // The shared identity resolver gates completion (allowlist re-check + member
    // liveness): a revoked member's lingering invite mapping must not mint even a dead
    // grant — parity with the `/api` login path. Same uniform failure as a bad code.
    const resolved = inv && inviteAccepted(inv, env)
      ? await resolveIdentity(env, inv.tenant, inv.member, directoryFromEnv(env))
      : null;
    if (!resolved || "error" in resolved) {
      // Uniform for unknown / expired / grace-rejected / revoked-member code — never distinguish.
      // Only re-show the legacy form while grace is on (GET hides it once grace is off; keep POST consistent).
      const body = inviteGraceEnabled(env)
        ? legacyInviteForm(b64, "That invite code isn't valid. Check it and try again.")
        : `<p class="err">That invite code isn't valid. Restart the connection.</p>`;
      return page(`<h1>Connect to yamp</h1>` + body, 400);
    }
    const tenantId = resolved.id;
    const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
      request: oauthReqInfo,
      // userId stays the TENANT id (the roster's grant:<userId>:* scan contract); the
      // member rides only in props, bound to the invite's resolved pair.
      userId: tenantId,
      scope: oauthReqInfo.scope,
      metadata: { label: tenantId },
      props: { tenantId, memberId: resolved.member },
    });
    return Response.redirect(redirectTo, 302);
  }

  return new Response("Method not allowed", { status: 405 });
}

/**
 * `/authorize/status?authz=<ref>` — the cross-device poll. Pending → `{status:"pending"}`; unknown
 * or expired → `{status:"expired"}`; approved → claim the reference (single completion), complete
 * the OAuth grant with the bound `(tenant, member)` pair, and return `{status:"approved", redirect}`.
 */
export async function handleAuthorizeStatus(request: Request, env: Env): Promise<Response> {
  const ref = new URL(request.url).searchParams.get("authz") ?? "";
  const json = (body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

  const claimed = await claimApproved(env, ref);
  if (!claimed) {
    // Distinguish only pending (ref still live) from expired/unknown — no tenant data either way.
    const view = await viewApproval(env, ref);
    return json({ status: view ? "pending" : "expired" });
  }

  let oauthReqInfo: AuthRequest;
  try {
    oauthReqInfo = JSON.parse(atob(claimed.oauth)) as AuthRequest;
  } catch {
    return json({ status: "expired" });
  }
  // The shared identity resolver gates completion here too: an approval bound to a
  // member who was revoked (or moved households) between approving and this claim must
  // not mint a grant. Uniform `expired` — no oracle for why.
  const resolved = await resolveIdentity(env, claimed.tenant, claimed.member, directoryFromEnv(env));
  if ("error" in resolved) return json({ status: "expired" });
  const tenantId = resolved.id;
  const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
    request: oauthReqInfo,
    // userId stays the TENANT id (the roster's grant:<userId>:* scan contract); the
    // approving member rides only in props.
    userId: tenantId,
    scope: oauthReqInfo.scope,
    metadata: { label: tenantId },
    props: { tenantId, memberId: resolved.member },
  });
  return json({ status: "approved", redirect: redirectTo });
}
