// Inbound-email recipe discovery (newsletter-discovery capability). Cloudflare
// Email Routing delivers forwarded recipe newsletters for `groceries-agent@<domain>`
// to the Worker's email() handler. We authenticate the message (DKIM/SPF/DMARC
// verdicts Cloudflare reports), gate it against the SHARED allowlist
// (the D1 `discovery_senders`/`discovery_members` allowlist), capture the email body
// for the agent to parse, and insert it into the shared D1 `discovery_candidates` table.
// The LLM reads the body and extracts all recipe links itself,
// so we never attempt URL extraction here — we just store the email faithfully.
//
// MIME parsing uses postal-mime (workerd-compatible, Node-testable) — robust
// multipart/quoted-printable/base64 + nested forward wrappers, not hand-rolled.
// Pure helpers below are unit-tested; only handleInboundEmail does I/O.

import PostalMime from "postal-mime";
import type { Env } from "./env.js";
import { readAllowlist, insertDiscoveryCandidate, type Allowlist } from "./corpus-db.js";
import { validateDiscoveryCandidate } from "./validate.js";

const BODY_MAX = 10_000;

/** Minimal shape of Cloudflare's ForwardableEmailMessage we depend on. */
export interface InboundMessage {
  readonly from: string;
  readonly to: string;
  readonly headers: Headers;
  readonly raw: ReadableStream<Uint8Array>;
  /** Reject the message in-session (SMTP 550) so the sender gets a bounce with `reason`. */
  setReject(reason: string): void;
}

// The shared inbound-newsletter allowlist (trusted members + senders) is the D1
// `discovery_members`/`discovery_senders` tables (slice 6), read via readAllowlist(env)
// in handleInboundEmail and widened by the update_discovery_sources tool. The Allowlist
// shape lives in corpus-db.ts.

// --- Authentication verdicts (Cloudflare's Authentication-Results header) -----

export interface AuthVerdicts {
  dkim: boolean;
  spf: boolean;
  dmarc: boolean;
  /** `header.d` domains of every passing DKIM signature (lowercased). */
  dkimDomains: string[];
}

/**
 * Parse the `Authentication-Results` header Cloudflare prepends, e.g.
 * `mx.cloudflare.net; dkim=pass header.d=seriouseats.com; spf=pass; dmarc=pass`.
 * Methods are `;`-separated; each passing DKIM contributes its `header.d`.
 */
export function parseAuthResults(raw: string | null | undefined): AuthVerdicts {
  const v: AuthVerdicts = { dkim: false, spf: false, dmarc: false, dkimDomains: [] };
  if (!raw) return v;
  for (const seg of raw.split(";")) {
    const s = seg.trim();
    const dkim = /^dkim=(\w+)/i.exec(s);
    if (dkim) {
      if (dkim[1].toLowerCase() === "pass") {
        v.dkim = true;
        const d = /header\.d=([^\s;]+)/i.exec(s);
        if (d) v.dkimDomains.push(d[1].toLowerCase());
      }
      continue;
    }
    const spf = /^spf=(\w+)/i.exec(s);
    if (spf) {
      v.spf = spf[1].toLowerCase() === "pass";
      continue;
    }
    const dmarc = /^dmarc=(\w+)/i.exec(s);
    if (dmarc) v.dmarc = dmarc[1].toLowerCase() === "pass";
  }
  return v;
}

/**
 * Pull the verifier's `Authentication-Results` value out of the raw message headers
 * (postal-mime's `email.headers`). Cloudflare adds its own `authentication-results`
 * line (`mx.cloudflare.net; dkim=pass header.d=…`); prefer it over any the sender
 * carried. `arc-authentication-results` is a different key and is left alone.
 */
export function authResultsHeader(
  headers: { key: string; value: string }[] | undefined | null,
): string | null {
  const all = (headers ?? []).filter((h) => h.key.toLowerCase() === "authentication-results");
  if (all.length === 0) return null;
  return (all.find((h) => /cloudflare/i.test(h.value)) ?? all[0]).value;
}

function domainOf(address: string): string {
  return address.toLowerCase().split("@")[1] ?? "";
}

/**
 * The accept gate. Two DKIM-based paths ship now:
 *   (a) `From` is an allowlisted SENDER and DKIM passes aligned to its domain
 *       (auto-forward rule; the newsletter's original signature survived), or
 *   (b) `From` is an allowlisted MEMBER and DKIM aligns to the member's domain
 *       (manual forward; re-signed by the member's provider).
 * Path (c) — SPF-aligned to a known member relay (auto-forward whose original
 * DKIM broke in the hop) — is DEFERRED: it can't be validated without a real
 * Cloudflare verdict to test against. Everything else is dropped silently.
 */
export type GateReason =
  | "sender_dkim"
  | "member_dkim"
  | "auth_unaligned"
  | "not_allowlisted";

export function gateMessage(opts: {
  from: string;
  allowlist: Allowlist;
  auth: AuthVerdicts;
}): { accepted: boolean; reason: GateReason } {
  const from = opts.from.trim().toLowerCase();
  const aligned = opts.auth.dkim && opts.auth.dkimDomains.includes(domainOf(from));
  if (aligned && opts.allowlist.senders.has(from)) return { accepted: true, reason: "sender_dkim" };
  if (aligned && opts.allowlist.members.has(from)) return { accepted: true, reason: "member_dkim" };
  // Known address but DKIM didn't align — distinct from a stranger so we can give
  // the trusted sender a detailed bounce (vs. a terse one to unknown senders).
  // TODO(relay-spf): path (c) once a live forwarded message's auth headers exist to test against.
  if (opts.allowlist.senders.has(from) || opts.allowlist.members.has(from)) {
    return { accepted: false, reason: "auth_unaligned" };
  }
  return { accepted: false, reason: "not_allowlisted" };
}

// --- Email body extraction ---------------------------------------------------

/**
 * Convert newsletter HTML to readable plain text, expanding anchor tags to
 * "TEXT (URL)" form so the LLM can see both the link text and the destination URL.
 */
function htmlToReadable(html: string): string {
  return html
    // Expand anchors: "TEXT (URL)" — preserves URLs for LLM extraction.
    .replace(
      /<a\s[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
      (_, url: string, inner: string) => {
        const text = inner.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        return /^https?:\/\//i.test(url) ? `${text} (${url})` : text;
      },
    )
    // Block-level elements → newlines.
    .replace(/<\/(?:p|div|li|h[1-6]|tr|td|blockquote)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    // Strip remaining tags.
    .replace(/<[^>]+>/g, "")
    // Decode common entities.
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    // Normalize whitespace.
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Extract the best plain-text body from an email for LLM parsing. Prefers the
 * text/plain part; falls back to converting the HTML part to readable text.
 * Truncated to BODY_MAX chars so storage stays manageable.
 */
export function extractEmailBody(html?: string | null, text?: string | null): string {
  const body = text?.trim() || (html ? htmlToReadable(html) : "");
  return body.slice(0, BODY_MAX);
}

// --- Inbox assembly ----------------------------------------------------------

export interface InboxEntry {
  from: string;
  subject: string;
  received_at: string;
  body: string;
}

/**
 * Synthetic dedup url for a received message — one message has no single canonical
 * url, so dedup is by (from, subject, received_at) carried into the candidate's
 * UNIQUE(url) column, replacing the in-memory "already seen?" scan over the file.
 */
export function inboxCandidateUrl(entry: InboxEntry): string {
  return `inbox:${entry.from} ${entry.subject} ${entry.received_at}`;
}

// --- Orchestrator ------------------------------------------------------------

export interface EmailResult {
  accepted: boolean;
  reason: GateReason;
  /** The message `From` address (lowercased), for observability. */
  from: string;
  /** Whether the email body was written to the inbox (false = rejected or duplicate). */
  written: boolean;
}

/**
 * Map a processing result to a human SMTP-reject reason, or `null` when the
 * message should be accepted silently. Only auth failures produce bounces —
 * content-level issues (empty body, duplicate email) are silent successes so
 * the sender is not flooded with bounces for newsletters.
 */
export function rejectReasonFor(result: EmailResult): string | null {
  if (result.accepted) return null;
  switch (result.reason) {
    case "auth_unaligned":
      return (
        "Your address is on the allowlist, but the message failed DKIM alignment, " +
        "so it could not be trusted. Auto-forward rules often break the original " +
        "DKIM signature; that relay fallback is not enabled yet."
      );
    case "not_allowlisted":
      return "Sender is not an allowlisted discovery source.";
    default:
      return "Message could not be processed.";
  }
}

/**
 * The Worker email() handler. Authenticate + gate against the D1 allowlist, parse the
 * MIME, capture the email body, and insert it as a D1 `discovery_candidates` row
 * (deduped by the UNIQUE url column + write-time validated). The LLM reads the body
 * later and extracts recipe links itself. Returns a structured result; the caller
 * `setReject`s on auth failure so the sender gets a bounce.
 */
export async function handleInboundEmail(message: InboundMessage, env: Env): Promise<EmailResult> {
  const allowlist: Allowlist = await readAllowlist(env);

  const email = await PostalMime.parse(message.raw);
  const fromAddress = (email.from?.address ?? message.from ?? "").toLowerCase();
  // Cloudflare's DKIM/SPF/DMARC verdict lives in the RAW message headers (which
  // postal-mime parses into `email.headers`), NOT the live `message.headers` object
  // — the latter is a stripped subset (date/from/subject/…) with no auth results.
  const verdicts = parseAuthResults(authResultsHeader(email.headers));

  const gate = gateMessage({ from: fromAddress, allowlist, auth: verdicts });
  if (!gate.accepted) return { ...gate, from: fromAddress, written: false };

  const body = extractEmailBody(email.html, email.text);
  const entry: InboxEntry = {
    from: fromAddress,
    subject: email.subject ?? "",
    received_at: isoDate(message.headers.get("date")),
    body,
  };

  const url = inboxCandidateUrl(entry);
  validateDiscoveryCandidate({ url }); // write-time candidate validation
  const written = await insertDiscoveryCandidate(env, {
    url,
    from: entry.from,
    subject: entry.subject,
    body: entry.body,
    received_at: entry.received_at,
  });
  return { ...gate, from: fromAddress, written };
}

/** Best-effort calendar date (YYYY-MM-DD) from the message `Date` header; UTC, falls back to empty. */
function isoDate(header: string | null): string {
  if (!header) return "";
  const t = Date.parse(header);
  if (Number.isNaN(t)) return "";
  return new Date(t).toISOString().slice(0, 10);
}
