// The shared conditional-request helper (member-api): every JSON GET on the `/api`
// surface goes through `jsonWithEtag` instead of implementing ETag handling ad hoc.
// Weak ETag (`W/"<sha-256-hex>"`) over the serialized body via `crypto.subtle`; a
// matching `If-None-Match` costs an empty-body 304. P0 applies it to the whoami read
// as the living demonstrator; P1's read areas adopt it per the two-writer contract.
// A later per-endpoint cheaper hash input (a row's `updated_at`) can replace the body
// hash without changing this contract.

import type { Context, TypedResponse } from "hono";
import { ToolError } from "../errors.js";

/** A weak ETag from a SHA-256 over `body` (the serialized JSON). */
async function weakEtag(body: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `W/"${hex}"`;
}

/**
 * Respond with `value` as JSON + a weak `ETag`, honoring `If-None-Match` with an
 * empty-body 304. The return is typed as the 200 shape so `hc` clients infer `value`'s
 * type end-to-end (the 304 arm carries no body by construction — a conditional client
 * keeps its cached copy).
 *
 * `Cache-Control: private, no-cache` makes the browser's store-then-revalidate
 * deterministic (member-app-offline D6): the validator is kept (store) but every reuse
 * revalidates at the server first — 304s stay cheap, per-tenant bodies never land in a
 * shared cache, and a class (a) read is always validated-fresh before its If-Match
 * write. Both arms carry it (HTTP folds 304 headers into the stored response).
 */
export async function jsonWithEtag<T>(c: Context, value: T): Promise<Response & TypedResponse<T>> {
  const body = JSON.stringify(value);
  const etag = await weakEtag(body);
  const cacheControl = "private, no-cache";
  const inm = c.req.header("If-None-Match");
  if (inm && inm.split(",").some((v) => v.trim() === etag)) {
    return new Response(null, {
      status: 304,
      headers: { ETag: etag, "Cache-Control": cacheControl },
    }) as Response & TypedResponse<T>;
  }
  const res = c.body(body, 200, {
    "content-type": "application/json",
    ETag: etag,
    "Cache-Control": cacheControl,
  });
  return res as Response & TypedResponse<T>;
}

/**
 * The class (a) write precondition (member-app-core D8): recompute the CURRENT
 * representation's weak ETag — `current` must be exactly the value the companion GET
 * serves through `jsonWithEtag` — and require a matching `If-Match`. A missing or
 * stale precondition throws a structured `conflict` whose `precondition` context marks
 * it for the shared error table's **412** arm (nothing is stored; the SPA refetches,
 * rebases, re-presents). Class (b) routes never call this.
 */
export async function requireIfMatch(c: Context, current: unknown): Promise<void> {
  const supplied = c.req.header("If-Match");
  if (!supplied) {
    throw new ToolError("conflict", "this write requires an If-Match precondition (read the document first)", {
      precondition: "missing",
    });
  }
  const etag = await weakEtag(JSON.stringify(current));
  if (!supplied.split(",").some((v) => v.trim() === etag)) {
    throw new ToolError("conflict", "the document changed since it was read — refetch, rebase, and retry", {
      precondition: "failed",
    });
  }
}
