// Session handling: the operator's own paid-source session, captured out-of-band (the
// `login` verb or a browser cookie import) and consumed read-only by the recurring daemon.
//
// The persisted form is Playwright's `storageState` JSON (cookies + origins) — the same
// shape `login` saves and `page.context().storageState()` produces — so one file serves
// both the browser tier (loaded straight into a context) and the plain-HTTP tier (its
// cookies flattened into a `Cookie` request header). Nothing here launches a browser; it
// is pure file + string work so the daemon stays browserless for HTTP sources.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** A single cookie as Playwright's storageState records it (the fields we use). */
export interface StorageStateCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
}

/** Playwright's storageState JSON (the subset we read/write; extra fields pass through). */
export interface StorageState {
  cookies: StorageStateCookie[];
  origins: unknown[];
}

/** Absolute path to a source's persisted session file on the volume. */
export function sessionPath(configDir: string, sourceId: string): string {
  return join(configDir, "sessions", `${sourceId}.json`);
}

/** Load a source's storageState, or null when no session has been captured yet. */
export function loadSession(configDir: string, sourceId: string): StorageState | null {
  const path = sessionPath(configDir, sourceId);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<StorageState>;
    if (!Array.isArray(parsed.cookies)) return null;
    return { cookies: parsed.cookies, origins: Array.isArray(parsed.origins) ? parsed.origins : [] };
  } catch {
    // A corrupt session file is treated as "no session" — the daemon reports auth_expired
    // and the operator re-captures, rather than the machine crashing.
    return null;
  }
}

/** Persist a source's storageState to the volume (creating the sessions dir as needed). */
export function saveSession(configDir: string, sourceId: string, state: StorageState): void {
  const path = sessionPath(configDir, sourceId);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2), "utf8");
}

/**
 * Import an existing storageState JSON file (exported from the operator's own browser, or
 * captured elsewhere) into this machine's session store for a source. Validates that the
 * file is a storageState (has a cookies array) before copying it in.
 */
export function importSession(configDir: string, sourceId: string, storageStatePath: string): StorageState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(storageStatePath, "utf8"));
  } catch (err) {
    throw new Error(`session import: could not read storageState ${storageStatePath}: ${(err as Error).message}`);
  }
  const o = parsed as Partial<StorageState>;
  if (!o || !Array.isArray(o.cookies)) {
    throw new Error(`session import: ${storageStatePath} is not a Playwright storageState (missing cookies[])`);
  }
  const state: StorageState = { cookies: o.cookies, origins: Array.isArray(o.origins) ? o.origins : [] };
  saveSession(configDir, sourceId, state);
  return state;
}

/** True when `cookieDomain` (which may be a leading-dot wildcard) covers `host`. */
function domainMatches(cookieDomain: string, host: string): boolean {
  const cd = cookieDomain.replace(/^\./, "").toLowerCase();
  const h = host.toLowerCase();
  return h === cd || h.endsWith(`.${cd}`);
}

/**
 * Build a `Cookie` request header for a target URL from a storageState — the plain-HTTP
 * tier's session replay. Includes only cookies whose domain covers the URL's host and whose
 * path is a prefix of the URL's path; secure cookies are sent only over https. Returns an
 * empty string when nothing matches (the caller then just omits the header).
 */
export function cookieHeaderFor(state: StorageState, url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "";
  }
  const isHttps = u.protocol === "https:";
  const pairs: string[] = [];
  for (const c of state.cookies) {
    if (!domainMatches(c.domain, u.hostname)) continue;
    if (c.path && !u.pathname.startsWith(c.path)) continue;
    if (c.secure && !isHttps) continue;
    pairs.push(`${c.name}=${c.value}`);
  }
  return pairs.join("; ");
}

/**
 * Heuristic detection of an expired/absent session — an authenticated request bounced to a
 * login/paywall page. True when the final URL landed on a login/subscribe/account route, OR
 * the HTML carries a paywall marker AND no recipe JSON-LD is present (a real recipe page that
 * merely mentions "subscribe" in a footer should not trip this). Callers map a true result to
 * the `auth_expired` signal so the operator liveness view prompts a re-capture.
 */
export function looksLikeAuthWall(finalUrl: string, html: string): boolean {
  const lowerUrl = finalUrl.toLowerCase();
  if (/\/(login|signin|sign-in|subscribe|account|register)(\b|\/|\?|#|$)/.test(lowerUrl)) return true;

  const hasRecipeJsonLd = /application\/ld\+json/i.test(html) && /"@type"\s*:\s*(\[[^\]]*)?["']Recipe["']/i.test(html);
  if (hasRecipeJsonLd) return false;

  const paywallMarker =
    /(please\s+subscribe|subscribe\s+to\s+(read|continue|view)|paywall|create\s+a\s+free\s+account|log\s*in\s+to\s+(read|continue)|this\s+content\s+is\s+for\s+subscribers)/i;
  return paywallMarker.test(html);
}
