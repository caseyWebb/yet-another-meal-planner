// The writable shared-corpus admin surface (operator-admin). The `/admin/api/corpus/<table>`
// namespace lets the operator LIST / ADD / REMOVE rows of the five group-wide shared-corpus
// lookup tables — ingredient aliases, flyer broad-scan terms, discovery feeds, and the
// discovery newsletter-sender / member allowlist. It is the curation surface the read-only
// SSR Data explorer deliberately can't provide.
//
// Removal is OPERATOR-ONLY: no MCP delete tool exposes it, so the agent adds (via its
// existing add tools) and only the operator prunes. Adds match the existing write semantics
// (aliases upsert by variant; the others insert-or-ignore). Every read/write goes through
// `corpus-db.ts` (→ `src/db.ts`), so a D1 failure surfaces as a structured `storage_error`
// and a bad input as `validation_failed` — this module never throws raw.
//
// It rides the same Cloudflare Access gate as the rest of `/admin*` (it has no auth code of
// its own); when Access is unconfigured the admin app's gate 404s the whole surface, this included.

import type { Env } from "./env.js";
import { ToolError } from "./errors.js";
import {
  readFlyerTerms,
  addFlyerTerms,
  deleteFlyerTerm,
  readFeeds,
  addFeedRows,
  deleteFeed,
  readAllowlist,
  addSourceRows,
  deleteSender,
  deleteMember,
} from "./corpus-db.js";

/** The editable shared-corpus tables, by their URL slug. (Ingredient aliases moved to the
 *  Normalization area's Aliases tab — organic-ingredient-normalization.) */
export const CORPUS_TABLES = ["flyer-terms", "feeds", "senders", "members"] as const;
export type CorpusTable = (typeof CORPUS_TABLES)[number];

export function isCorpusTable(slug: string): slug is CorpusTable {
  return (CORPUS_TABLES as readonly string[]).includes(slug);
}

/** A read returns the table's rows plus the server-fixed column order (the editor mirrors it). */
export interface CorpusTablePage {
  table: CorpusTable;
  columns: string[];
  rows: Record<string, unknown>[];
}

/** List a corpus table's rows (group-wide; the column order is the server's). */
export async function listCorpusTable(env: Env, table: CorpusTable): Promise<CorpusTablePage> {
  switch (table) {
    case "flyer-terms": {
      const rows = (await readFlyerTerms(env)).map((term) => ({ term }));
      return { table, columns: ["term"], rows };
    }
    case "feeds": {
      const rows = (await readFeeds(env)).map((f) => ({ url: f.url, name: f.name, weight: f.weight, tags: f.tags }));
      return { table, columns: ["url", "name", "weight", "tags"], rows };
    }
    case "senders": {
      const { senders } = await readAllowlist(env);
      return { table, columns: ["address"], rows: [...senders].sort().map((address) => ({ address })) };
    }
    case "members": {
      const { members } = await readAllowlist(env);
      return { table, columns: ["address"], rows: [...members].sort().map((address) => ({ address })) };
    }
  }
}

/** A required non-empty string field, or a `validation_failed` ToolError. */
function requireString(body: Record<string, unknown>, field: string): string {
  const raw = body[field];
  if (typeof raw !== "string" || !raw.trim()) {
    throw new ToolError("validation_failed", `A non-empty ${field} is required`, { field });
  }
  return raw.trim();
}

/**
 * A required email address, rejected up front when it lacks an `@`. Without this the
 * downstream `addSourceRows` silently drops a malformed address (returning `{ added: 0 }`,
 * a 200 the editor renders as a dedup no-op) — so the operator gets no signal. Mirrors the
 * normalization `addSourceRows` applies before storage.
 */
function requireAddress(body: Record<string, unknown>): string {
  const address = requireString(body, "address");
  if (!address.includes("@")) {
    throw new ToolError("validation_failed", "A valid email address is required", { field: "address" });
  }
  return address;
}

/**
 * Add one row to a corpus table from a validated request body. Validation rejects (writing
 * nothing) before any helper runs. Returns `{ added }` — the count actually written (0 when
 * the row was a dedup no-op). The editor refetches the list afterward, so this is advisory.
 */
export async function addCorpusRow(env: Env, table: CorpusTable, body: Record<string, unknown>): Promise<{ added: number }> {
  switch (table) {
    case "flyer-terms": {
      const term = requireString(body, "term");
      return { added: await addFlyerTerms(env, [term]) };
    }
    case "feeds": {
      const url = requireString(body, "url");
      if (body.weight != null && (typeof body.weight !== "number" || body.weight < 0)) {
        throw new ToolError("validation_failed", "weight must be a non-negative number", { field: "weight" });
      }
      const weight = typeof body.weight === "number" ? body.weight : 1;
      const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : undefined;
      if (body.tags != null && (!Array.isArray(body.tags) || body.tags.some((t) => typeof t !== "string"))) {
        throw new ToolError("validation_failed", "tags must be an array of strings", { field: "tags" });
      }
      const tags = Array.isArray(body.tags) ? (body.tags as string[]) : undefined;
      return { added: await addFeedRows(env, [{ url, name, weight, tags }]) };
    }
    case "senders": {
      const address = requireAddress(body);
      const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : undefined;
      const { senders } = await addSourceRows(env, { senders: [{ address, name }] });
      return { added: senders };
    }
    case "members": {
      const address = requireAddress(body);
      const { members } = await addSourceRows(env, { members: [{ address }] });
      return { added: members };
    }
  }
}

/**
 * Remove one row by its primary key. Idempotent curation: removing an absent key succeeds
 * with `{ removed: false }` rather than 404ing. Address tables normalize the key in the
 * delete helper so it always targets the row an add produced.
 */
export async function deleteCorpusRow(env: Env, table: CorpusTable, key: string): Promise<{ removed: boolean }> {
  switch (table) {
    case "flyer-terms":
      return { removed: await deleteFlyerTerm(env, key) };
    case "feeds":
      return { removed: await deleteFeed(env, key) };
    case "senders":
      return { removed: await deleteSender(env, key) };
    case "members":
      return { removed: await deleteMember(env, key) };
  }
}
