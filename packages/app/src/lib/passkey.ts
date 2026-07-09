// The browser-side WebAuthn ceremonies + their server round-trips (webauthn-passkey-auth,
// member side): usernameless passkey login, self-service enrollment, and the reads/write
// behind the cross-device `/connect` approval. Every POST rides `appFetch` (which sets the
// `X-App-Csrf` header the Worker's CSRF guard requires); the option/verify blobs go through
// the raw wrapper rather than the typed `hc` client, whose deep inference over the WebAuthn
// JSON is awkward. A ceremony throw — the user dismissing the sheet, no credential present,
// an unsupported browser — surfaces as `cancelled`, never a crash: passkey sign-in and
// enrollment are both optional paths a member can decline.
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/browser";
import { apiError, appFetch } from "./api";

/** A passkey login attempt: the member picked a credential and the Worker minted a session,
 *  the ceremony was declined/unavailable, or the exchange failed (uniform copy, no oracle). */
export type LoginOutcome =
  | { status: "ok"; tenant: { id: string } }
  | { status: "cancelled" }
  | { status: "failed"; message: string };

/** An enrollment attempt: stored, declined/unavailable, or failed. Enrollment is never
 *  fatal — the member keeps their session and can enroll later. */
export type EnrollOutcome = { status: "ok" } | { status: "cancelled" } | { status: "failed"; message: string };

/** The uniform passkey copy: like the invite path, an auth failure never hints WHY (unknown
 *  credential, delisted member, no passkey all read identically). */
const LOGIN_FAILED = "That didn't work. Try again, or use an invite code below.";
const NETWORK = "Couldn't reach the server. Try again.";
const RATE_LIMITED = "Too many attempts — wait a minute and try again.";

function loginMessage(error: string, fallback: string): string {
  if (error === "rate_limited") return RATE_LIMITED;
  if (error === "network") return NETWORK;
  return fallback || LOGIN_FAILED;
}

/**
 * Usernameless passkey sign-in: fetch discoverable authentication options, run the browser
 * ceremony (empty `allowCredentials` → the account picker resolves the member), and verify
 * the assertion — the Worker re-checks the allowlist and mints the SAME session the invite
 * path does. The caller runs the stamp/purge/navigate side effects on `ok`.
 */
export async function passkeyLogin(): Promise<LoginOutcome> {
  const optRes = await appFetch("/api/passkey/login/options", { method: "POST" }).catch(() => null);
  if (!optRes) return { status: "failed", message: NETWORK };
  if (!optRes.ok) {
    const err = await apiError(optRes);
    return { status: "failed", message: loginMessage(err.error, err.message) };
  }
  const optionsJSON = (await optRes.json()) as PublicKeyCredentialRequestOptionsJSON;

  let assertion: AuthenticationResponseJSON;
  try {
    assertion = await startAuthentication({ optionsJSON });
  } catch {
    // NotAllowedError (dismissed / timed out), no credential, or an unsupported browser —
    // all a neutral non-event; the member falls back to the invite field.
    return { status: "cancelled" };
  }

  const verRes = await appFetch("/api/passkey/login/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ response: assertion }),
  }).catch(() => null);
  if (!verRes) return { status: "failed", message: NETWORK };
  if (!verRes.ok) {
    const err = await apiError(verRes);
    return { status: "failed", message: loginMessage(err.error, err.message) };
  }
  const { tenant } = (await verRes.json()) as { tenant: { id: string } };
  return { status: "ok", tenant };
}

/**
 * Enroll a passkey against the CURRENT authenticated session (register/options →
 * `startRegistration` → register/verify). The first enrollment consumes the tenant's
 * bootstrap invite code server-side. `label` (optional) names the device in the operator's
 * credential list.
 */
export async function enrollPasskey(label?: string): Promise<EnrollOutcome> {
  const optRes = await appFetch("/api/passkey/register/options", { method: "POST" }).catch(() => null);
  if (!optRes) return { status: "failed", message: NETWORK };
  if (!optRes.ok) {
    const err = await apiError(optRes);
    return { status: "failed", message: loginMessage(err.error, err.message) };
  }
  const optionsJSON = (await optRes.json()) as PublicKeyCredentialCreationOptionsJSON;

  let response: RegistrationResponseJSON;
  try {
    response = await startRegistration({ optionsJSON });
  } catch {
    return { status: "cancelled" };
  }

  const verRes = await appFetch("/api/passkey/register/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ response, ...(label ? { label } : {}) }),
  }).catch(() => null);
  if (!verRes) return { status: "failed", message: NETWORK };
  if (!verRes.ok) {
    const err = await apiError(verRes);
    return { status: "failed", message: loginMessage(err.error, err.message) };
  }
  return { status: "ok" };
}

/** A pending cross-device approval as the `/connect` screen shows it. */
export interface PendingApproval {
  clientName: string;
  code: string;
  status: "pending" | "approved";
}

/** The outcome of reading `?authz=<ref>`: found (render it), gone (expired/unknown → 404),
 *  or a transport failure the screen reports as retryable. */
export type PendingOutcome =
  | { status: "ok"; approval: PendingApproval }
  | { status: "not_found" }
  | { status: "failed"; message: string };

/** Look up a pending approval reference (session-gated). */
export async function fetchPendingApproval(ref: string): Promise<PendingOutcome> {
  const res = await appFetch(`/api/connect/pending?authz=${encodeURIComponent(ref)}`).catch(() => null);
  if (!res) return { status: "failed", message: NETWORK };
  if (res.status === 404) return { status: "not_found" };
  if (!res.ok) {
    const err = await apiError(res);
    return { status: "failed", message: err.message || "Something went wrong. Try again." };
  }
  const body = (await res.json()) as { client_name: string; code: string; status: "pending" | "approved" };
  return { status: "ok", approval: { clientName: body.client_name, code: body.code, status: body.status } };
}

/** The outcome of approving a reference. */
export type ApproveOutcome = { status: "ok" } | { status: "not_found" } | { status: "failed"; message: string };

/** Bind the signed-in member to a pending approval reference (session-gated, rate-limited). */
export async function approveConnection(ref: string): Promise<ApproveOutcome> {
  const res = await appFetch("/api/connect/approve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ authz: ref }),
  }).catch(() => null);
  if (!res) return { status: "failed", message: NETWORK };
  if (res.status === 404) return { status: "not_found" };
  if (!res.ok) {
    const err = await apiError(res);
    return { status: "failed", message: err.error === "rate_limited" ? RATE_LIMITED : err.message || "Something went wrong. Try again." };
  }
  return { status: "ok" };
}
