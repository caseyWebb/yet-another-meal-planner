// Inbound-email recipe discovery (newsletter-discovery capability). Cloudflare
// Email Routing delivers forwarded recipe newsletters for `groceries-agent@<domain>`
// to the Worker's email() handler. We authenticate the message (DKIM/SPF/DMARC
// verdicts Cloudflare reports), gate it against the SHARED allowlist
// (discovery_sources.toml — trusted senders + members), capture the email body
// for the agent to parse, and append it to the shared discoveries_inbox.toml via
// the commit engine. The LLM reads the body and extracts all recipe links itself,
// so we never attempt URL extraction here — we just store the email faithfully.
//
// MIME parsing uses postal-mime (workerd-compatible, Node-testable) — robust
// multipart/quoted-printable/base64 + nested forward wrappers, not hand-rolled.
// Pure helpers below are unit-tested; only handleInboundEmail does I/O.

import PostalMime from "postal-mime";
import type { Env } from "./env.js";
import { parseToml } from "./parse.js";
import { stringifyTomlWithHeader } from "./serialize.js";
import { commitFiles } from "./commit.js";
import { readOptional } from "./gh-read.js";
import { createGitHubClient } from "./github.js";
import { createInstallationAuth } from "./github-app.js";
import { dataCoords } from "./tenant.js";

export const INBOX_PATH = "discoveries_inbox.toml";
export const SOURCES_PATH = "discovery_sources.toml";
const BODY_MAX = 10_000;
export const INBOX_MAX_AGE_DAYS = 30;

const INBOX_HEADER =
  "# discoveries_inbox.toml — emails from forwarded newsletters for recipe discovery.\n" +
  "# Written by the Worker email() handler; read by the agent via read_discovery_inbox.\n" +
  "# Each [[entries]] is one received message; the agent parses `body` to find recipes.";

/** Minimal shape of Cloudflare's ForwardableEmailMessage we depend on. */
export interface InboundMessage {
  readonly from: string;
  readonly to: string;
  readonly headers: Headers;
  readonly raw: ReadableStream<Uint8Array>;
  /** Reject the message in-session (SMTP 550) so the sender gets a bounce with `reason`. */
  setReject(reason: string): void;
}

// --- Allowlist (discovery_sources.toml) -------------------------------------

export interface Allowlist {
  members: Set<string>;
  senders: Set<string>;
}

function normalizeAddress(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const a = raw.trim().toLowerCase();
  return a.includes("@") ? a : null;
}

function rowsOf(parsed: Record<string, unknown>, key: string): Record<string, unknown>[] {
  return Array.isArray(parsed[key]) ? (parsed[key] as Record<string, unknown>[]) : [];
}

/** Parse the shared `discovery_sources.toml` into trusted member + sender address sets. */
export function parseAllowlist(raw: string | null): Allowlist {
  const members = new Set<string>();
  const senders = new Set<string>();
  if (!raw) return { members, senders };
  let parsed: Record<string, unknown>;
  try {
    parsed = parseToml(raw, SOURCES_PATH);
  } catch {
    return { members, senders };
  }
  for (const m of rowsOf(parsed, "members")) {
    const a = normalizeAddress(m.address);
    if (a) members.add(a);
  }
  for (const s of rowsOf(parsed, "senders")) {
    const a = normalizeAddress(s.address);
    if (a) senders.add(a);
  }
  return { members, senders };
}

const SOURCES_HEADER =
  "# discovery_sources.toml — shared allowlist for inbound newsletter discovery.\n" +
  "# [[members]] = trusted friend-group addresses (anything they forward gets indexed).\n" +
  "# [[senders]] = trusted newsletter senders (auto-forwarded mail from them gets indexed).\n" +
  "# Anyone trusted with the agent MCP may widen this via update_discovery_sources.";

export interface SourceEntry {
  address: string;
  name?: string;
}

export interface SourceAdditions {
  members?: SourceEntry[];
  senders?: SourceEntry[];
}

function mergeRows(
  existing: Record<string, unknown>[],
  additions: SourceEntry[] | undefined,
): { rows: Record<string, unknown>[]; added: number } {
  const rows = [...existing];
  const have = new Set(
    existing.map((r) => normalizeAddress(r.address)).filter((a): a is string => a !== null),
  );
  let added = 0;
  for (const entry of additions ?? []) {
    const a = normalizeAddress(entry.address);
    if (!a || have.has(a)) continue;
    have.add(a);
    rows.push(entry.name ? { address: a, name: entry.name } : { address: a });
    added++;
  }
  return { rows, added };
}

/**
 * Add trusted members/senders to the shared `discovery_sources.toml`, deduping by
 * address (existing entries untouched). Returns the new file text and how many of
 * each kind were actually added. Used by the `update_discovery_sources` tool.
 */
export function addSources(
  existingRaw: string | null,
  additions: SourceAdditions,
): { text: string; added: { members: number; senders: number } } {
  let parsed: Record<string, unknown> = {};
  if (existingRaw) {
    try {
      parsed = parseToml(existingRaw, SOURCES_PATH);
    } catch {
      parsed = {};
    }
  }
  const members = mergeRows(rowsOf(parsed, "members"), additions.members);
  const senders = mergeRows(rowsOf(parsed, "senders"), additions.senders);
  const next = { ...parsed, members: members.rows, senders: senders.rows };
  const text = stringifyTomlWithHeader(existingRaw ?? SOURCES_HEADER, next);
  return { text, added: { members: members.added, senders: senders.added } };
}

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
 * Truncated to BODY_MAX chars so TOML storage stays manageable.
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

/** Cutoff date (YYYY-MM-DD) for pruning inbox entries older than `maxAgeDays`. */
function cutoffDate(maxAgeDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - maxAgeDays);
  return d.toISOString().slice(0, 10);
}

/**
 * Append a received email to the inbox TOML, deduping by (from + subject +
 * received_at) to skip exact re-deliveries, and pruning entries older than
 * INBOX_MAX_AGE_DAYS before writing. Returns the new file text and whether
 * the entry was actually written (false means it was a duplicate).
 */
export function appendInboxEntry(
  existingRaw: string | null,
  entry: InboxEntry,
): { text: string; written: boolean } {
  let parsed: Record<string, unknown> = {};
  if (existingRaw) {
    try {
      parsed = parseToml(existingRaw, INBOX_PATH);
    } catch {
      parsed = {};
    }
  }
  let entries = Array.isArray(parsed.entries)
    ? (parsed.entries as Record<string, unknown>[])
    : [];

  // Skip if the same email was already indexed (same sender + subject + date).
  const key = `${entry.from}\x00${entry.subject}\x00${entry.received_at}`;
  const isDuplicate = entries.some(
    (e) => `${e.from}\x00${e.subject}\x00${e.received_at}` === key,
  );
  if (isDuplicate) return { text: existingRaw ?? "", written: false };

  // Prune entries older than INBOX_MAX_AGE_DAYS before appending.
  const cutoff = cutoffDate(INBOX_MAX_AGE_DAYS);
  entries = entries.filter((e) => {
    const d = typeof e.received_at === "string" ? e.received_at : "";
    return !d || d >= cutoff;
  });

  entries.push(entry);
  const text = stringifyTomlWithHeader(existingRaw ?? INBOX_HEADER, { ...parsed, entries });
  return { text, written: true };
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
 * The Worker email() handler. Authenticate + gate, parse the MIME, capture
 * the email body, and append it to the shared inbox in one commit. The LLM
 * reads the body later and extracts recipe links itself. Returns a structured
 * result; the caller `setReject`s on auth failure so the sender gets a bounce.
 */
export async function handleInboundEmail(message: InboundMessage, env: Env): Promise<EmailResult> {
  const auth = createInstallationAuth(
    env.GITHUB_APP_ID,
    env.GITHUB_APP_PRIVATE_KEY,
    { id: env.GITHUB_INSTALLATION_ID, owner: env.DATA_OWNER, repo: env.DATA_REPO },
  );
  const gh = createGitHubClient(dataCoords(env), auth);

  const allowlist = parseAllowlist(await readOptional(gh, SOURCES_PATH));

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

  const inboxRaw = await readOptional(gh, INBOX_PATH);
  const { text, written } = appendInboxEntry(inboxRaw, entry);
  if (!written) return { ...gate, from: fromAddress, written: false };

  await commitFiles(gh, [{ path: INBOX_PATH, content: text }], `discovery: email from ${fromAddress}`);
  return { ...gate, from: fromAddress, written: true };
}

/** Best-effort calendar date (YYYY-MM-DD) from the message `Date` header; UTC, falls back to empty. */
function isoDate(header: string | null): string {
  if (!header) return "";
  const t = Date.parse(header);
  if (Number.isNaN(t)) return "";
  return new Date(t).toISOString().slice(0, 10);
}
