// Store registration tool (in-store-fulfillment capability). Persists a new store
// identity as a row in the shared D1 `stores` table. Stores are shared corpus and
// UNATTRIBUTED — any MCP holder may register one with no extra auth gate. Listing,
// identity reads, identity edits, and removal are member/admin web surfaces over the
// same shared operations (stores.ts / corpus-db.ts) — there are no list_stores /
// read_store / update_store / remove_store MCP tools; only the mid-walk, hands-busy
// capture pair (add_store here, add_store_note in notes-tools.ts) stays MCP. Store-
// identity validation runs at write time (src/validate.ts), moved off the build (slice 6).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "./env.js";
import { ToolError, runTool } from "./errors.js";
import { validateStoreInput } from "./validate.js";
import { readStoreRow, insertStore, type Store } from "./corpus-db.js";

/**
 * @param server the MCP server to register on
 * @param env    D1 — the shared `stores` table backs the registry
 */
export function registerStoreTools(server: McpServer, env: Env): void {
  server.registerTool(
    "add_store",
    {
      description:
        "Register a new store LOCATION in the shared registry — identity only. `slug` is a kebab-case LOCATION id (west-7th-tom-thumb, not tom-thumb). `name` is required; `label`/`chain`/`address` optional; `domain` defaults to 'grocery' (set 'home-improvement' etc. for a non-grocery store). `location_id` is an optional chain-specific external id — for Kroger stores, set it to the resolved Kroger locationId so in-store walks skip the Locations API lookup. Layout is NOT set here — map a store by recording layout-tagged store notes (add_store_note) as you walk it. Shared corpus, no extra gate. Errors with slug_exists if the slug is already registered (identity edits are a member/admin web surface now).",
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

  // list_stores / read_store / update_store / remove_store leave the MCP surface
  // (in-store-fulfillment): the member/admin web surfaces read/edit/remove stores over
  // the same shared operations (stores.ts's applyStoreOperations, corpus-db.ts's row
  // I/O) — unchanged, just no longer MCP-registered.
}
