// Inbound-email recipe discovery (newsletter-discovery capability). Cloudflare
// Email Routing delivers forwarded recipe newsletters for `groceries-agent@<domain>`
// to the Worker's email() handler. We authenticate the message (DKIM/SPF/DMARC
// verdicts Cloudflare reports), gate it against the SHARED allowlist
// (discovery_sources.toml — trusted senders + members), unwrap tracker-wrapped
// links to clean canonical URLs, and append candidate recipes to the shared
// discoveries_inbox.toml via the commit engine. This is the PUSH complement to RSS
// pull: it reaches bot-walled/paywalled sources (Serious Eats, NYT) the Worker
// cannot fetch — the publisher pushes the teaser to us.
//
// MIME parsing uses postal-mime (workerd-compatible, Node-testable) — robust
// multipart/quoted-printable/base64 + nested forward wrappers, not hand-rolled.
// Pure helpers below are unit-tested; only handleInboundEmail does I/O.

import PostalMime from "postal-mime";
import type { Env } from "./env.js";
import { canonicalizeUrl, extractRecipeSources, flattenInbox } from "./discovery.js";
import { parseToml } from "./parse.js";
import { stringifyTomlWithHeader } from "./serialize.js";
import { commitFiles } from "./commit.js";
import { readOptional } from "./gh-read.js";
import { createGitHubClient } from "./github.js";
import { createInstallationAuth } from "./github-app.js";
import { dataCoords } from "./tenant.js";
import { truncate } from "./text.js";

export const INBOX_PATH = "discoveries_inbox.toml";
export const SOURCES_PATH = "discovery_sources.toml";
const RECIPE_INDEX = "_indexes/recipes.json";
const MAX_CANDIDATES_PER_MESSAGE = 25;
const MAX_REDIRECT_HOPS = 5;
const TITLE_MAX = 160;

const INBOX_HEADER =
  "# discoveries_inbox.toml — recipe candidates from forwarded newsletters.\n" +
  "# Written by the Worker email() handler; read by the agent via read_discovery_inbox.\n" +
  "# Each [[entries]] is one received message; candidate `url`s are unwrapped canonical links.";

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

// --- Link extraction + tracker unwrapping ------------------------------------

const STRIP_TAGS = /<[^>]+>/g;
const ENTITY = /&(amp|lt|gt|quot|#39|nbsp);/g;
const ENTITY_MAP: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  "#39": "'",
  nbsp: " ",
};

function decodeEntities(s: string): string {
  return s.replace(ENTITY, (_m, e) => ENTITY_MAP[e] ?? _m);
}

export interface Anchor {
  url: string;
  title: string | null;
}

/**
 * Pull anchors ({ href, link text }) out of the (possibly forward-wrapped) HTML,
 * plus bare URLs from the text part. Robust to forward nesting because it simply
 * scans every `href` in whatever postal-mime yields — a quoted/nested original
 * still carries its links.
 */
export function extractAnchors(html?: string | null, text?: string | null): Anchor[] {
  const out: Anchor[] = [];
  if (html) {
    const re = /<a\s[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    for (const m of html.matchAll(re)) {
      const url = decodeEntities(m[1].trim());
      if (!/^https?:\/\//i.test(url)) continue;
      const title = decodeEntities(m[2].replace(STRIP_TAGS, " ")).replace(/\s+/g, " ").trim();
      out.push({ url, title: title || null });
    }
  }
  if (text) {
    for (const m of text.matchAll(/https?:\/\/[^\s<>"')\]]+/gi)) {
      out.push({ url: m[0], title: null });
    }
  }
  return out;
}

const TRACKER_PARAM_KEYS = ["url", "u", "redirect", "target", "link", "destination", "d"];
const CHROME_HOST_RE =
  /(list-manage|mailchimp|sendgrid|mcusercontent|facebook|twitter|x\.com|instagram|pinterest|youtube|youtu\.be|tiktok|linkedin|threads\.net)/i;
const CHROME_PATH_RE = /(unsubscribe|preferences|privacy|\/terms|email-preferences|manage-subscription|webview)/i;

/**
 * Decode a tracker-wrapped link to its destination WITHOUT a network call when
 * the destination is carried in a query param (the common Mailchimp/SendGrid
 * shape, e.g. `?url=https%3A%2F%2F…`). Returns `followNeeded` when it's an opaque
 * redirector that must be followed (orchestrator does that, reading only headers).
 */
export function decodeTrackerUrl(raw: string): { url: string; followNeeded: boolean } {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { url: raw, followNeeded: false };
  }
  for (const key of TRACKER_PARAM_KEYS) {
    const v = u.searchParams.get(key);
    if (!v) continue;
    const decoded = decodeURIComponent(v);
    if (/^https?:\/\//i.test(decoded)) return { url: decoded, followNeeded: false };
  }
  return { url: raw, followNeeded: CHROME_HOST_RE.test(u.host) || /\/(c|click|ss|link|redir)\//i.test(u.pathname) };
}

/** A canonical URL that plausibly points at recipe content (drops social/unsubscribe chrome). */
export function isLikelyContentLink(canonical: string): boolean {
  let u: URL;
  try {
    u = new URL(canonical);
  } catch {
    return false;
  }
  if (CHROME_HOST_RE.test(u.host)) return false;
  if (CHROME_PATH_RE.test(u.pathname)) return false;
  return true;
}

// --- Inbox assembly ----------------------------------------------------------

export interface InboxEntry {
  from: string;
  subject: string;
  received_at: string;
  candidates: { title: string; summary: string | null; url: string }[];
}

/**
 * Append one received message's deduped candidates to the inbox TOML, dropping
 * any candidate whose canonical URL is already in `seen` (corpus `source:` URLs ∪
 * existing inbox URLs) or repeated within the entry. Returns the new file text and
 * the count written; `written: 0` (nothing new) means the caller skips the commit.
 */
export function appendInboxEntry(
  existingRaw: string | null,
  entry: InboxEntry,
  seen: Set<string>,
): { text: string; written: number } {
  const local = new Set(seen);
  const candidates = entry.candidates.filter((c) => {
    if (local.has(c.url)) return false;
    local.add(c.url);
    return true;
  });
  if (candidates.length === 0) return { text: existingRaw ?? "", written: 0 };

  let parsed: Record<string, unknown> = {};
  if (existingRaw) {
    try {
      parsed = parseToml(existingRaw, INBOX_PATH);
    } catch {
      parsed = {};
    }
  }
  const entries = Array.isArray(parsed.entries) ? (parsed.entries as unknown[]) : [];
  entries.push({ ...entry, candidates });
  const text = stringifyTomlWithHeader(existingRaw ?? INBOX_HEADER, { ...parsed, entries });
  return { text, written: candidates.length };
}

// --- Orchestrator ------------------------------------------------------------

/** Follow an opaque redirector, reading ONLY headers — never download the (walled) body. */
async function followRedirect(url: string): Promise<string> {
  let current = url;
  for (let i = 0; i < MAX_REDIRECT_HOPS; i++) {
    let res: Response;
    try {
      res = await fetch(current, { method: "GET", redirect: "manual" });
    } catch {
      return current;
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return current;
      try {
        current = new URL(loc, current).toString();
      } catch {
        return current;
      }
      continue;
    }
    return res.url || current;
  }
  return current;
}

export interface EmailResult {
  accepted: boolean;
  reason: GateReason;
  /** Content links extracted from the body (before corpus/inbox dedup). */
  found: number;
  /** New candidates actually written to the inbox (0 ⇒ none new, e.g. all duplicates). */
  written: number;
}

/**
 * Map a processing result to a human SMTP-reject reason, or `null` when the
 * message should be accepted silently. The handler `setReject`s with this so the
 * sender gets an inline bounce explaining the failure (debuggable forwarding).
 * Accepted-with-duplicates is a SUCCESS (nothing new, but not a failure) — only a
 * genuine failure rejects, so forwarding a newsletter of known recipes won't bounce.
 */
export function rejectReasonFor(result: EmailResult): string | null {
  if (result.accepted) {
    if (result.found === 0) {
      return "Message accepted, but no recipe links were found in it to index.";
    }
    return null; // links found (written ≥ 0): success, even if all were duplicates
  }
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
 * The Worker email() handler. Authenticate + gate, parse the MIME, unwrap links,
 * extract recipe candidates, and append them to the shared inbox in one commit.
 * Returns a structured result; the caller `setReject`s a failure (see
 * `rejectReasonFor`) so the sender gets a bounce instead of a silent drop.
 */
export async function handleInboundEmail(message: InboundMessage, env: Env): Promise<EmailResult> {
  const auth = createInstallationAuth(
    env.GITHUB_APP_ID,
    env.GITHUB_APP_PRIVATE_KEY,
    env.GITHUB_INSTALLATION_ID,
  );
  const gh = createGitHubClient(dataCoords(env), auth);

  const allowlist = parseAllowlist(await readOptional(gh, SOURCES_PATH));
  const verdicts = parseAuthResults(message.headers.get("authentication-results"));

  const email = await PostalMime.parse(message.raw);
  const fromAddress = (email.from?.address ?? message.from ?? "").toLowerCase();

  const gate = gateMessage({ from: fromAddress, allowlist, auth: verdicts });
  // TEMP DIAGNOSTIC (remove after smoke test): surface the gate decision + the raw
  // Cloudflare Authentication-Results so we can see exactly why a message is gated.
  console.log(
    "[email] gate " +
      JSON.stringify({
        from: fromAddress,
        authRaw: message.headers.get("authentication-results"),
        verdicts,
        members: [...allowlist.members],
        senders: [...allowlist.senders],
        gate,
      }),
  );
  if (!gate.accepted) return { ...gate, found: 0, written: 0 };

  // Resolve each anchor to its clean canonical destination, then keep content links.
  const anchors = extractAnchors(email.html, email.text);
  const resolved: { title: string | null; url: string }[] = [];
  const seenLocal = new Set<string>();
  for (const a of anchors) {
    if (resolved.length >= MAX_CANDIDATES_PER_MESSAGE) break;
    const decoded = decodeTrackerUrl(a.url);
    const destination = decoded.followNeeded ? await followRedirect(decoded.url) : decoded.url;
    const canonical = canonicalizeUrl(destination);
    if (seenLocal.has(canonical) || !isLikelyContentLink(canonical)) continue;
    seenLocal.add(canonical);
    resolved.push({ title: a.title, url: canonical });
  }
  console.log(
    "[email] extracted " +
      JSON.stringify({ anchors: anchors.length, found: resolved.length, urls: resolved.map((r) => r.url) }),
  );
  if (resolved.length === 0) return { ...gate, found: 0, written: 0 };

  const [indexRaw, inboxRaw] = await Promise.all([
    readOptional(gh, RECIPE_INDEX),
    readOptional(gh, INBOX_PATH),
  ]);
  const seen = new Set<string>([...extractRecipeSources(indexRaw), ...flattenInbox(inboxRaw).map((c) => c.url)]);

  const entry: InboxEntry = {
    from: fromAddress,
    subject: email.subject ?? "",
    received_at: isoDate(message.headers.get("date")),
    candidates: resolved.map((r) => ({
      title: r.title ? truncate(r.title, TITLE_MAX) : r.url,
      summary: null,
      url: r.url,
    })),
  };

  const { text, written } = appendInboxEntry(inboxRaw, entry, seen);
  console.log("[email] write " + JSON.stringify({ found: resolved.length, written }));
  if (written === 0) return { ...gate, found: resolved.length, written: 0 };

  await commitFiles(gh, [{ path: INBOX_PATH, content: text }], `discovery: ${written} candidate(s) from ${fromAddress}`);
  return { ...gate, found: resolved.length, written };
}

/** Best-effort calendar date (YYYY-MM-DD) from the message `Date` header; UTC, falls back to empty. */
function isoDate(header: string | null): string {
  if (!header) return "";
  const t = Date.parse(header);
  if (Number.isNaN(t)) return "";
  return new Date(t).toISOString().slice(0, 10);
}
