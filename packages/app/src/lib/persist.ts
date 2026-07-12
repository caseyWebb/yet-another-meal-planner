// The member app's persistence boundary (member-app-offline D1/D2/D4/D9): the
// idb-keyval structured-clone persister the query cache dehydrates into, the TWO
// allowlists that define what may ever reach IndexedDB, the local identity stamp the
// offline boot falls back to, and the one purge that removes every piece of member
// data at rest.
//
// BOUNDARY DISCIPLINE (D2 — normative): a query is NOT persisted until its key prefix
// is deliberately added to PERSIST_PREFIXES, and a mutation is NOT persisted until its
// key is deliberately added to REGISTERED_MUTATION_KEYS (and given defaults in
// lib/mutations.ts). Everything else is excluded BY CONSTRUCTION — session/whoami
// state, search results, propose results and weather, profile, retrospective, vibes,
// pending proposals, and every online-only surface (order commit, substitutions,
// suggest, session, class (a) If-Match writes) stay out of the at-rest cache. Do not
// add a prefix or key casually: persisted reads live on a shared device for up to
// MAX_AGE_MS, and persisted mutations REPLAY.
import { QueryClient } from "@tanstack/react-query";
import type { Mutation, Query } from "@tanstack/react-query";
import type { PersistedClient, Persister } from "@tanstack/react-query-persist-client";
import { del, get, set } from "idb-keyval";

/** The one IndexedDB key (idb-keyval's default store) the dehydrated client lives under. */
export const IDB_CACHE_KEY = "yamp-query-cache";

/** Persisted entries expire after 14 days (plan §6: a cached week must keep working). */
export const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

/** Allowlisted queries set `gcTime` this long — a persisted entry must outlive memory
 *  gc or it silently drops from the next dehydration (D1). */
export const GC_TIME_MS = MAX_AGE_MS;

/**
 * The query-key prefixes that persist (D2's table): the grocery reads (stored rows AND
 * the derived to-buy view — one prefix covers both), pantry, plan, overlay
 * (favorites/rejects — the cookbook page, its favorites view, and the row hearts join
 * it client-side), the cookbook index, and visited recipe bodies (visited-only by
 * construction: only fetched bodies are in cache; bounded by GC_TIME_MS).
 */
export const PERSIST_PREFIXES: readonly (readonly string[])[] = [
  ["grocery"],
  ["pantry"],
  ["plan"],
  ["overlay"],
  ["cookbook", "index"],
  ["cookbook", "recipe"],
];

/**
 * The class (b) mutation registry's keys (design D4's table, one row per D8 class (b)
 * write). lib/mutations.ts registers defaults under EXACTLY these keys; the
 * dehydration predicate below refuses any mutation whose key is not here — the
 * online-only surfaces are unreplayable by construction (D5).
 */
export const REGISTERED_MUTATION_KEYS: readonly (readonly string[])[] = [
  ["grocery", "add"],
  ["grocery", "set"],
  ["grocery", "remove"],
  ["grocery", "checked"],
  ["grocery", "coverage"],
  ["grocery", "substitution"],
  ["grocery", "relist"],
  ["grocery", "pantry-verify"],
  ["grocery", "shop-commit"],
  ["pantry", "ops"],
  ["pantry", "verify"],
  ["overlay", "favorite"],
  ["plan", "ops"],
  ["log", "add"],
  ["log", "remove"],
  ["notes", "add"],
  ["notes", "edit"],
  ["notes", "remove"],
  ["vibes", "add"],
  ["vibes", "remove"],
  ["proposals", "confirm"],
];

const REGISTERED_KEY_SET = new Set(REGISTERED_MUTATION_KEYS.map((k) => JSON.stringify(k)));

function prefixMatches(queryKey: readonly unknown[], prefix: readonly string[]): boolean {
  return prefix.every((part, i) => queryKey[i] === part);
}

/** The persist allowlist predicate: successful data under an allowlisted prefix only. */
export function shouldDehydrateQuery(query: Query): boolean {
  if (query.state.status !== "success") return false;
  return PERSIST_PREFIXES.some((prefix) => prefixMatches(query.queryKey, prefix));
}

/** Paused AND registered (D4/D5): a mutation outside the class (b) registry — or one
 *  that is mid-flight rather than queued — never reaches IndexedDB. */
export function shouldDehydrateMutation(mutation: Mutation<unknown, Error, unknown, unknown>): boolean {
  if (!mutation.state.isPaused) return false;
  return REGISTERED_KEY_SET.has(JSON.stringify(mutation.options.mutationKey ?? null));
}

/**
 * The structured-clone persister (D1): `get`/`set`/`del` of the PersistedClient object
 * under one key — no JSON-string double-serialization; IndexedDB stores the dehydrated
 * state natively. Errors are swallowed (private mode, quota, IDB unavailable): the app
 * degrades to online-only, the P2 localStorage posture.
 */
export function createIdbPersister(): Persister {
  return {
    persistClient: async (client: PersistedClient) => {
      try {
        await set(IDB_CACHE_KEY, client);
      } catch {
        // degrade to online-only
      }
    },
    restoreClient: async () => {
      try {
        return await get<PersistedClient>(IDB_CACHE_KEY);
      } catch {
        return undefined;
      }
    },
    removeClient: async () => {
      try {
        await del(IDB_CACHE_KEY);
      } catch {
        // nothing to remove that we can reach
      }
    },
  };
}

/** The app's one QueryClient — created here so the purge (and the router loader that
 *  invokes it) can reach it outside React. main.tsx provides it to the tree. */
export const queryClient = new QueryClient();

// --- the local identity stamp (D3) -------------------------------------------------

const TENANT_STAMP_KEY = "yamp:tenant";
const PROPOSE_SESSION_KEY = "yamp:propose-session";
const WALK_SESSION_KEY = "yamp:store-walk";

export interface LocalWalkSession {
  session_id: string;
  tenant_stamp: string;
  store_slug: string;
  started_at: string;
  current_group: string | null;
  state: "active" | "paused" | "pending_commit";
}

export function readLocalWalk(): LocalWalkSession | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(WALK_SESSION_KEY) ?? "null") as Partial<LocalWalkSession> | null;
    const tenant = readTenantStamp();
    return parsed && parsed.tenant_stamp === tenant && typeof parsed.session_id === "string" && typeof parsed.store_slug === "string"
      ? parsed as LocalWalkSession : null;
  } catch { return null; }
}

export function writeLocalWalk(value: LocalWalkSession): void {
  try { localStorage.setItem(WALK_SESSION_KEY, JSON.stringify(value)); } catch { /* offline navigation degrades to this tab */ }
}

export function clearLocalWalk(sessionId?: string): void {
  try { const current = readLocalWalk(); if (!sessionId || current?.session_id === sessionId) localStorage.removeItem(WALK_SESSION_KEY); } catch { /* unavailable */ }
}

/** The stamped tenant id — a boot/display hint ONLY, never an authority: every online
 *  request is authorized by the server-side session, not by this. */
export function readTenantStamp(): string | null {
  try {
    return localStorage.getItem(TENANT_STAMP_KEY);
  } catch {
    return null;
  }
}

/** Written at login and refreshed on every successful whoami (the offline boot's fallback). */
export function writeTenantStamp(tenant: string): void {
  try {
    localStorage.setItem(TENANT_STAMP_KEY, tenant);
  } catch {
    // private-mode storage failures are fine — offline boot just won't resume
  }
}

/**
 * The one purge (D9): the persisted cache (IndexedDB), the in-memory query AND
 * mutation caches (queued writes from a prior member must never replay into a new
 * session), the identity stamp, and the client-side propose session. The theme key
 * survives (device preference, not member data). Call sites: logout, login as a
 * DIFFERENT tenant than the stamp, a definitive 401 at boot — never transient/network
 * failures (an offline device keeps its own member's data; that is the feature).
 */
export async function purgeLocalMemberData(): Promise<void> {
  try {
    await del(IDB_CACHE_KEY);
  } catch {
    // IDB unavailable — nothing persisted there to purge
  }
  queryClient.clear();
  try {
    localStorage.removeItem(TENANT_STAMP_KEY);
    localStorage.removeItem(PROPOSE_SESSION_KEY);
    localStorage.removeItem(WALK_SESSION_KEY);
  } catch {
    // storage unavailable — nothing stamped to purge
  }
}
