// Cross-device connection approval (webauthn-passkey-auth / passkey-auth). The Claude.ai
// `/authorize` page can't run a passkey ceremony in Claude's OAuth browser, so identity is
// proven on a SECOND screen: the member approves from the passkey-authenticated web app, and
// the `/authorize` page (polling) then completes the OAuth grant. This module owns the
// short-lived, single-use approval reference that ties the two screens together.
//
// The reference lives in TENANT_KV (`authz:<ref>`, auth-flow ephemeral state beside `session:*`),
// carries the parsed OAuth request so completion needs no other state, and a short verification
// CODE shown on BOTH screens so a member can't be tricked into approving a connection they didn't
// start (device-flow confused-deputy guard). The `ref` is unguessable; the `code` is a confirmation,
// not a secret.

import type { Env } from "./env.js";
import { normalizeTenantId } from "./tenant.js";

const APPROVAL_PREFIX = "authz:";
/** Window to complete the cross-device handoff — mint on `GET /authorize`, approve, poll, done. */
const APPROVAL_TTL_S = 10 * 60;
/** Verification-code alphabet: no 0/O/1/I/L ambiguity; the code is read aloud/compared by eye. */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LEN = 6;

/** What `authz:<ref>` stores. `oauth` is the base64 `AuthRequest` the provider gave us on GET.
 *  `tenant`/`member` are bound on approval; a record written before the member-identity split
 *  carries no `member` and resolves to the founding member (the legacy-defaulting rule). */
export interface ApprovalRecord {
  oauth: string;
  clientName: string;
  code: string;
  status: "pending" | "approved";
  tenant?: string;
  member?: string;
}

/** The client-facing view of a pending approval (never leaks the stored OAuth request). */
export interface ApprovalView {
  clientName: string;
  code: string;
  status: "pending" | "approved";
}

function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A short, human-comparable verification code from CSPRNG bytes (unbiased over the alphabet). */
function verificationCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LEN));
  let out = "";
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return out;
}

/**
 * Mint a pending approval for a parsed OAuth request. Returns the opaque `ref` (for the deep
 * link / poll) and the `code` (shown on the `/authorize` page so it can be matched on `/connect`).
 */
export async function mintApproval(env: Env, oauth: string, clientName: string): Promise<{ ref: string; code: string }> {
  const ref = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const code = verificationCode();
  const record: ApprovalRecord = { oauth, clientName, code, status: "pending" };
  await env.TENANT_KV.put(`${APPROVAL_PREFIX}${ref}`, JSON.stringify(record), { expirationTtl: APPROVAL_TTL_S });
  return { ref, code };
}

async function readApproval(env: Env, ref: string): Promise<ApprovalRecord | null> {
  if (!ref) return null;
  const raw = await env.TENANT_KV.get(`${APPROVAL_PREFIX}${ref}`);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ApprovalRecord;
    return typeof parsed?.oauth === "string" ? parsed : null;
  } catch {
    return null;
  }
}

/** The `/connect` screen's view of a reference: client + code to display, or null if unknown/expired. */
export async function viewApproval(env: Env, ref: string): Promise<ApprovalView | null> {
  const record = await readApproval(env, ref);
  return record ? { clientName: record.clientName, code: record.code, status: record.status } : null;
}

/**
 * Bind the approving `(tenant, member)` pair to a PENDING reference (the member approved on
 * `/connect`). Returns `not_found` for an unknown/expired ref. Approval is pending-only and
 * one-shot: once a reference is approved it can NOT be re-bound — a re-approve by the SAME
 * member is an idempotent `ok`, and any other member is told `not_found` (no re-bind of the
 * confused-deputy kind, and no oracle, even though `ref` is already a 256-bit unguessable value).
 */
export async function approveApproval(
  env: Env,
  ref: string,
  tenant: string,
  member: string,
): Promise<"ok" | "not_found"> {
  const record = await readApproval(env, ref);
  if (!record) return "not_found";
  if (record.status === "approved") {
    return record.tenant === tenant && (record.member ?? record.tenant) === member ? "ok" : "not_found";
  }
  const updated: ApprovalRecord = { ...record, status: "approved", tenant, member };
  // Re-put with the same short window; the record stays single-use (claimed = deleted on completion).
  await env.TENANT_KV.put(`${APPROVAL_PREFIX}${ref}`, JSON.stringify(updated), { expirationTtl: APPROVAL_TTL_S });
  return "ok";
}

/**
 * Claim an approved reference for OAuth completion: if approved, DELETE it (the claim) and return
 * the stored OAuth request + the bound `(tenant, member)` pair so the caller completes the grant
 * exactly once. A pre-split record with no `member` yields the founding member (legacy-defaulting).
 * Returns null for pending/unknown/expired. (KV has no CAS, so two simultaneous polls could both
 * claim; the one-user-polling flow makes that window negligible — an accepted trade-off, like
 * other KV state.)
 */
export async function claimApproved(
  env: Env,
  ref: string,
): Promise<{ oauth: string; tenant: string; member: string } | null> {
  const record = await readApproval(env, ref);
  if (!record || record.status !== "approved" || !record.tenant) return null;
  await env.TENANT_KV.delete(`${APPROVAL_PREFIX}${ref}`);
  return { oauth: record.oauth, tenant: record.tenant, member: record.member ?? normalizeTenantId(record.tenant) };
}
