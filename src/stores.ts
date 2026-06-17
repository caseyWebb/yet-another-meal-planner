// Shared store registry (in-store-fulfillment capability). One `stores/<slug>.toml`
// per specific store LOCATION, holding store IDENTITY only — name, label, chain,
// address, domain. Store content is shared and UNATTRIBUTED (like recipe content).
// The store's LAYOUT (aisle order, where non-obvious items hide, not-carried set)
// is NOT here — it lives in attributed store notes (src/notes.ts,
// users/<id>/store_notes/<slug>.toml) with layout/location/stock tags. A parser
// reading a legacy file that still carries aisles/item_locations/doesnt_carry keys
// ignores them silently (see toStore).
//
// Split like storage-guidance.ts / kitchen.ts: pure parse/serialize/apply logic
// here (unit-testable against plain objects + a fake GitHubClient); the tool
// registration + commit I/O lives in stores-tools.ts. `update_store` operations
// follow the update_pantry / update_kitchen style — an off-target op is a
// structured conflict, never a silent write. There is NO `_indexes/stores.json`:
// the set is small, so `listStores` reads the directory directly (no index).

import { parse as parseTomlRaw, stringify as stringifyTomlRaw } from "smol-toml";
import { GitHubError, type GitHubClient } from "./github.js";
import { readFile } from "./gh-read.js";
import { ToolError } from "./errors.js";

export const STORES_DIR = "stores";

// kebab-case location slug; anchored so it also rejects path traversal.
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Objective store IDENTITY (shared, unattributed). Layout — aisle order, where
 * non-obvious items hide, not-carried entries — is NOT structured here; it lives
 * in attributed store notes (`users/<id>/store_notes/<slug>.toml`, tags
 * layout/location/stock). The registry is just identity + `domain`.
 */
export interface Store {
  slug: string;
  name: string;
  label?: string;
  chain?: string;
  address?: string;
  domain: string;
  /** Chain-specific external id (e.g. Kroger `locationId`). Stored so the Kroger
   *  client can bypass the Locations API on in-store walks. */
  location_id?: string;
}

/** Repo-relative path to a store file (shared corpus root). */
export function storePath(slug: string): string {
  return `${STORES_DIR}/${slug}.toml`;
}

/** Strip the `.md`/`.toml` extension from a store file name; null for non-store entries. */
export function slugFromStoreFile(name: string): string | null {
  if (!name.endsWith(".toml")) return null;
  return name.slice(0, -5);
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/**
 * Normalize a parsed `stores/<slug>.toml` object into the Store identity shape.
 * Legacy `aisles` / `item_locations` / `doesnt_carry` keys (written before layout
 * moved to notes) are silently ignored — read what we still use, never error.
 */
export function toStore(parsed: Record<string, unknown>): Store {
  const store: Store = {
    slug: asString(parsed.slug) ?? "",
    name: asString(parsed.name) ?? "",
    domain: asString(parsed.domain) ?? "grocery",
  };
  const label = asString(parsed.label);
  const chain = asString(parsed.chain);
  const address = asString(parsed.address);
  const location_id = asString(parsed.location_id);
  if (label) store.label = label;
  if (chain) store.chain = chain;
  if (address) store.address = address;
  if (location_id) store.location_id = location_id;
  return store;
}

/** Serialize a Store back to `stores/<slug>.toml` (identity only, doc header). */
export function serializeStore(store: Store): string {
  const header =
    `# stores/${store.slug}.toml — objective store identity (shared, unattributed).\n` +
    "# Layout lives in attributed store notes (store_notes/<slug>.toml, tags layout/location/stock).\n\n";
  const data: Record<string, unknown> = { slug: store.slug, name: store.name };
  if (store.label) data.label = store.label;
  if (store.chain) data.chain = store.chain;
  if (store.address) data.address = store.address;
  data.domain = store.domain;
  if (store.location_id) data.location_id = store.location_id;
  return header + stringifyTomlRaw(data) + "\n";
}

/** The compact view `list_stores` returns — identity only. Whether a store has a
 * usable map is a notes concern (read_store_notes), not part of the registry. */
export interface StoreListing {
  slug: string;
  name: string;
  label?: string;
  domain: string;
}

export function toListing(store: Store): StoreListing {
  const l: StoreListing = {
    slug: store.slug,
    name: store.name,
    domain: store.domain,
  };
  if (store.label) l.label = store.label;
  return l;
}

// --- gh-driven read/list (testable against a fake GitHubClient) -------------

/**
 * List the registered stores (identity only). Returns `{ stores: [] }` when the
 * `stores/` tree does not exist yet (an absent registry is not an error — the walk
 * degrades to a department list). No index is read. Whether a store has a usable
 * layout is a notes concern — read_store_notes, not the registry.
 */
export async function listStores(gh: GitHubClient): Promise<{ stores: StoreListing[] }> {
  let dir;
  try {
    dir = await gh.listDir(STORES_DIR);
  } catch (e) {
    if (e instanceof GitHubError) {
      if (e.status === 404) return { stores: [] };
      throw new ToolError("upstream_unavailable", e.message);
    }
    throw e;
  }
  const slugs = dir
    .filter((e) => e.type === "file")
    .map((e) => slugFromStoreFile(e.name))
    .filter((s): s is string => s !== null);
  const stores = await Promise.all(
    slugs.map(async (slug) => {
      const text = await readFile(gh, storePath(slug), "not_found", `Unknown store: ${slug}`);
      return toListing(toStore(parseTomlRaw(text) as Record<string, unknown>));
    }),
  );
  stores.sort((a, b) => a.slug.localeCompare(b.slug));
  return { stores };
}

/** Read one store's objective content. Unknown (or malformed) slug → structured not_found. */
export async function readStore(gh: GitHubClient, slug: string): Promise<Store> {
  if (!SLUG_RE.test(slug)) {
    throw new ToolError("not_found", `Unknown store: ${slug}`, { slug });
  }
  const text = await readFile(gh, storePath(slug), "not_found", `Unknown store: ${slug}`);
  return toStore(parseTomlRaw(text) as Record<string, unknown>);
}

// --- pure operations (update_store, update_pantry-style) --------------------

export type StoreOperation =
  // Identity edits (set a top-level field). Layout is notes now — no aisle/
  // item_location/doesnt_carry ops here; those moved to add_store_note.
  { op: "set_identity"; field: "name" | "label" | "chain" | "address" | "domain" | "location_id"; value: string };

export interface StoreApplied {
  op: StoreOperation["op"];
  target: string;
}

export interface StoreConflict {
  op: StoreOperation["op"];
  target: string;
  reason: string;
}

export interface StoreApplyResult {
  store: Store;
  applied: StoreApplied[];
  conflicts: StoreConflict[];
}

const IDENTITY_FIELDS = ["name", "label", "chain", "address", "domain", "location_id"] as const;

/**
 * Apply identity update operations in order. An off-target op (an unsettable field,
 * or an empty name) is a structured conflict, never a silent write — the
 * update_pantry / update_kitchen posture.
 */
export function applyStoreOperations(store: Store, operations: StoreOperation[]): StoreApplyResult {
  const next: Store = { ...store };
  const applied: StoreApplied[] = [];
  const conflicts: StoreConflict[] = [];

  for (const op of operations) {
    if (op.op === "set_identity") {
      if (!IDENTITY_FIELDS.includes(op.field)) {
        conflicts.push({ op: op.op, target: op.field, reason: "not a settable identity field" });
        continue;
      }
      if (op.field === "name" && !op.value.trim()) {
        conflicts.push({ op: op.op, target: op.field, reason: "name must not be empty" });
        continue;
      }
      next[op.field] = op.value;
      applied.push({ op: op.op, target: op.field });
    }
  }

  return { store: next, applied, conflicts };
}
