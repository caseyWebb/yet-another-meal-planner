// Store CRUD tools (in-store-fulfillment capability). Reads/lists the shared store
// registry (the D1 `stores` table) and persists creates/edits/removals as row
// writes. Stores are shared corpus and UNATTRIBUTED — any MCP holder may map or edit
// one with no extra auth gate (the update_discovery_sources posture). The pure
// operation/shape logic lives in stores.ts; row I/O is corpus-db.ts. Store-identity
// validation runs at write time here (src/validate.ts), moved off the build (slice 6).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "./env.js";
import { ToolError, runTool } from "./errors.js";
import { validateStoreInput } from "./validate.js";
import {
  listStoreRows,
  readStoreRow,
  insertStore,
  upsertStore,
  deleteStore,
  type Store,
} from "./corpus-db.js";
import { toListing, assertStoreSlug, applyStoreOperations, type StoreOperation } from "./stores.js";

const storeOpShape = z.object({
  op: z.enum(["set_identity"]),
  field: z.enum(["name", "label", "chain", "address", "domain", "location_id"]).optional(),
  value: z.string().optional(),
});

/** Coerce a raw update op (flat shape) into a typed StoreOperation; null = invalid op. */
function toStoreOperation(raw: z.infer<typeof storeOpShape>): StoreOperation | null {
  switch (raw.op) {
    case "set_identity":
      if (!raw.field || raw.value == null) return null;
      return { op: "set_identity", field: raw.field, value: raw.value };
  }
}

/**
 * @param server the MCP server to register on
 * @param env    D1 — the shared `stores` table backs the registry
 */
export function registerStoreTools(server: McpServer, env: Env): void {
  server.registerTool(
    "list_stores",
    {
      description:
        "List the stores in the shared registry. Returns { stores: [{ slug, name, label, domain }] } — identity only. An empty/absent registry returns { stores: [] } — the walk still works (it degrades to a department-grouped list from general knowledge). To tell whether a store has a usable aisle map, read its layout-tagged store notes (read_store_notes), not this list.",
      inputSchema: {},
    },
    () => runTool(async () => ({ stores: (await listStoreRows(env)).map(toListing) })),
  );

  server.registerTool(
    "read_store",
    {
      description:
        "Read one store's identity by slug (name, label, chain, address, domain). Layout and observations are NOT here — they're attributed store notes; use read_store_notes for the aisle map (layout-tagged), where-it-hides hints (location), not-carried entries (stock), and freeform notes (hours, parking). Unknown slug → structured not_found.",
      inputSchema: { slug: z.string() },
    },
    ({ slug }) =>
      runTool(async () => {
        assertStoreSlug(slug);
        const store = await readStoreRow(env, slug);
        if (!store) throw new ToolError("not_found", `Unknown store: ${slug}`, { slug });
        return store;
      }),
  );

  server.registerTool(
    "add_store",
    {
      description:
        "Register a new store LOCATION in the shared registry — identity only. `slug` is a kebab-case LOCATION id (west-7th-tom-thumb, not tom-thumb). `name` is required; `label`/`chain`/`address` optional; `domain` defaults to 'grocery' (set 'home-improvement' etc. for a non-grocery store). `location_id` is an optional chain-specific external id — for Kroger stores, set it to the resolved Kroger locationId so in-store walks skip the Locations API lookup. Layout is NOT set here — map a store by recording layout-tagged store notes (add_store_note) as you walk it. Shared corpus, no extra gate. Errors with slug_exists if the slug is already registered (edit identity with update_store).",
      inputSchema: {
        slug: z.string(),
        name: z.string(),
        label: z.string().optional(),
        chain: z.string().optional(),
        address: z.string().optional(),
        domain: z.string().optional(),
        location_id: z.string().optional(),
      },
    },
    (input) =>
      runTool(async () => {
        validateStoreInput(input);
        if ((await readStoreRow(env, input.slug)) !== null) {
          throw new ToolError("slug_exists", `Store already registered: ${input.slug}`, { slug: input.slug });
        }
        const store: Store = {
          slug: input.slug,
          name: input.name.trim(),
          domain: input.domain ?? "grocery",
        };
        if (input.label) store.label = input.label;
        if (input.chain) store.chain = input.chain;
        if (input.address) store.address = input.address;
        if (input.location_id) store.location_id = input.location_id;
        await insertStore(env, store);
        return { store };
      }),
  );

  server.registerTool(
    "update_store",
    {
      description:
        "Edit a registered store's IDENTITY with operations (update_pantry-style). Ops: { op:'set_identity', field, value } where field is name|label|chain|address|domain|location_id. `location_id` is a chain-specific external id — for Kroger, set it to the resolved Kroger locationId so in-store walks bypass the Locations API. Layout is notes now — there are no aisle / item_location / doesnt_carry ops here; record those with add_store_note (tags layout/location/stock). Returns applied + conflicts (e.g. an unsettable field). Unknown slug → not_found.",
      inputSchema: { slug: z.string(), operations: z.array(storeOpShape) },
    },
    ({ slug, operations }) =>
      runTool(async () => {
        assertStoreSlug(slug);
        const store = await readStoreRow(env, slug);
        if (!store) throw new ToolError("not_found", `Unknown store: ${slug}`, { slug });
        const ops: StoreOperation[] = [];
        const conflicts: { op: string; target: string; reason: string }[] = [];
        for (const raw of operations) {
          const op = toStoreOperation(raw);
          if (op) ops.push(op);
          else conflicts.push({ op: raw.op, target: raw.field ?? "", reason: "operation is missing required fields" });
        }
        const result = applyStoreOperations(store, ops);
        const allConflicts = [...conflicts, ...result.conflicts];
        if (result.applied.length === 0) {
          return { slug, applied: result.applied, conflicts: allConflicts };
        }
        // Re-validate identity post-edit (name could have been set empty, etc.).
        validateStoreInput(result.store);
        await upsertStore(env, result.store);
        return { slug, applied: result.applied, conflicts: allConflicts };
      }),
  );

  server.registerTool(
    "remove_store",
    {
      description:
        "Remove a mapped store from the shared registry. Unknown slug → structured not_found. Attributed store notes are left untouched.",
      inputSchema: { slug: z.string() },
    },
    ({ slug }) =>
      runTool(async () => {
        assertStoreSlug(slug);
        const removed = await deleteStore(env, slug);
        if (!removed) throw new ToolError("not_found", `Unknown store: ${slug}`, { slug });
        return { slug, removed: true };
      }),
  );
}
