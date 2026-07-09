// WebAuthn passkey ceremonies (webauthn-passkey-auth / passkey-auth). The crypto core:
// registration + authentication option builders and response verification, plus the
// single-use challenge lifecycle. Verification is delegated to `@simplewebauthn/server`
// (v13) — confirmed pure-WebCrypto on `workerd` (spike, design D7): it handles the
// CBOR/COSE decode and the ES256 (-7) / RS256 (-257) `subtle.verify` internally, so no
// Node builtins and no hand-rolled crypto here.
//
// Discoverable (usernameless) credentials: registration sets `residentKey: "required"`
// with the tenant id as the WebAuthn user handle, so authentication runs with an empty
// `allowCredentials` and the member is resolved from the asserted credential id (looked up
// in `webauthn_credentials`). The signature counter is stored by the caller but NEVER
// enforced (design D4) — we do not reject on counter regression.

import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
} from "@simplewebauthn/server";
import { isoBase64URL, isoUint8Array } from "@simplewebauthn/server/helpers";
import type { Env } from "./env.js";
import { getCredentialById, type StoredCredential } from "./webauthn-db.js";

const RP_NAME = "Cookbook";
const CHAL_PREFIX = "webauthn:chal:";
/** WebAuthn challenges are one-shot and short-lived — a ceremony must finish within this window. */
const CHALLENGE_TTL_S = 5 * 60;
/** ES256 (-7) then RS256 (-257) — the two algorithms `subtle.verify` covers on workerd. */
const SUPPORTED_ALGORITHM_IDS = [-7, -257];

/** A challenge's purpose, so a registration challenge can't be replayed into an authentication. */
type ChallengePurpose = "reg" | "auth";

/**
 * The relying party for a request. RP ID is the request host EXACTLY (design: exact-host, not
 * the registrable domain) — the operator sets their final domain before any enrollment
 * (docs/SELF_HOSTING.md), so a credential is bound to that one host. `origin` is the full
 * scheme+host the browser reports, checked by the verifiers.
 */
export function rpFromRequest(request: Request): { rpID: string; origin: string } {
  const url = new URL(request.url);
  return { rpID: url.hostname, origin: url.origin };
}

/** Store a one-shot challenge (single-use, short TTL) in TENANT_KV — auth-flow ephemeral state,
 *  beside `session:*` (the challenge string itself is the key; nothing tenant-private is stored). */
async function putChallenge(env: Env, challenge: string, purpose: ChallengePurpose): Promise<void> {
  await env.TENANT_KV.put(`${CHAL_PREFIX}${challenge}`, purpose, { expirationTtl: CHALLENGE_TTL_S });
}

/**
 * Consume a challenge: read-and-delete (single-use). Returns true only when the challenge was one
 * we issued for `purpose`. Deletes on any hit so a failed ceremony can't retry the same challenge.
 * Never throws — a KV hiccup resolves to false (the verify then fails closed).
 */
async function consumeChallenge(env: Env, challenge: string, purpose: ChallengePurpose): Promise<boolean> {
  try {
    const key = `${CHAL_PREFIX}${challenge}`;
    const stored = await env.TENANT_KV.get(key);
    if (stored === null) return false;
    await env.TENANT_KV.delete(key);
    return stored === purpose;
  } catch {
    return false;
  }
}

// === Registration ============================================================

/** The stored fields a verified registration yields (binary as base64url) — ready for insert. */
export interface VerifiedCredential {
  credentialId: string;
  publicKey: string;
  signCount: number;
  transports: string[];
}

/**
 * Build registration options for an authenticated `tenant` and stash the challenge. Discoverable
 * (`residentKey: "required"`), no attestation, user handle = tenant id. `existing` are the tenant's
 * current credentials, excluded so the authenticator won't double-register the same device.
 */
export async function beginRegistration(
  env: Env,
  request: Request,
  tenant: string,
  existing: StoredCredential[],
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const { rpID } = rpFromRequest(request);
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID,
    userID: isoUint8Array.fromUTF8String(tenant),
    userName: tenant,
    userDisplayName: tenant,
    attestationType: "none",
    excludeCredentials: existing.map((c) => ({ id: c.credentialId, transports: c.transports as never })),
    authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
    supportedAlgorithmIDs: SUPPORTED_ALGORITHM_IDS,
  });
  await putChallenge(env, options.challenge, "reg");
  return options;
}

/**
 * Verify a registration response against the issued (single-use) challenge and the request's RP.
 * Returns the stored credential fields on success, or null on any verification failure (the caller
 * maps null to a uniform error). The challenge is consumed regardless of outcome.
 */
export async function finishRegistration(
  env: Env,
  request: Request,
  response: RegistrationResponseJSON,
): Promise<VerifiedCredential | null> {
  const { rpID, origin } = rpFromRequest(request);
  try {
    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: (c) => consumeChallenge(env, c, "reg"),
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
    });
    if (!verification.verified || !verification.registrationInfo) return null;
    const cred = verification.registrationInfo.credential;
    return {
      credentialId: cred.id,
      publicKey: isoBase64URL.fromBuffer(cred.publicKey),
      signCount: cred.counter,
      transports: cred.transports ?? [],
    };
  } catch {
    return null;
  }
}

// === Authentication ==========================================================

/** Build usernameless authentication options (empty `allowCredentials`) and stash the challenge. */
export async function beginAuthentication(
  env: Env,
  request: Request,
): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const { rpID } = rpFromRequest(request);
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "preferred",
    allowCredentials: [],
  });
  await putChallenge(env, options.challenge, "auth");
  return options;
}

/** A verified assertion: which stored credential signed, and its post-assertion counter. */
export interface VerifiedAssertion {
  credential: StoredCredential;
  newSignCount: number;
}

/**
 * Verify an authentication assertion: resolve the credential by the asserted id, verify the
 * signature against its stored public key and the issued (single-use) challenge, and return the
 * credential + new counter. Returns null on any failure (unknown credential, bad signature, stale
 * challenge) so the caller emits ONE uniform `unauthorized` (no oracle). The counter is returned
 * for storage but is never enforced here.
 */
export async function finishAuthentication(
  env: Env,
  request: Request,
  response: AuthenticationResponseJSON,
): Promise<VerifiedAssertion | null> {
  const { rpID, origin } = rpFromRequest(request);
  const credential = await getCredentialById(env, response.id);
  if (!credential) {
    // Still consume the challenge if present so it can't be reused against a real credential.
    await consumeChallenge(env, deriveChallenge(response), "auth");
    return null;
  }
  try {
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: (c) => consumeChallenge(env, c, "auth"),
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: credential.credentialId,
        publicKey: isoBase64URL.toBuffer(credential.publicKey),
        counter: credential.signCount,
        transports: credential.transports as never,
      },
      requireUserVerification: false,
    });
    if (!verification.verified) return null;
    return { credential, newSignCount: verification.authenticationInfo.newCounter };
  } catch {
    return null;
  }
}

/** Best-effort extract of the challenge an assertion echoes (base64url clientDataJSON → `.challenge`). */
function deriveChallenge(response: AuthenticationResponseJSON): string {
  try {
    const json = new TextDecoder().decode(isoBase64URL.toBuffer(response.response.clientDataJSON));
    const parsed = JSON.parse(json) as { challenge?: unknown };
    return typeof parsed.challenge === "string" ? parsed.challenge : "";
  } catch {
    return "";
  }
}
