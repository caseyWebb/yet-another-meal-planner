// Store CRUD tools (in-store-fulfillment capability). Reads/lists the shared
// stores/ registry and persists creates/edits/removals via the atomic commit
// engine. Stores are shared corpus and UNATTRIBUTED — any MCP holder may map or
// edit one with no extra auth gate (the update_discovery_sources posture). The
// pure parse/serialize/apply logic lives in stores.ts; this file is the I/O shell
// (gh reads + commits), mirroring grocery-tools.ts / write-tools.ts.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { GitHubClient, TreeChange } from "./github.js";
import { readOptional } from "./gh-read.js";
import { ToolError, runTool } from "./errors.js";
import { commitFiles } from "./commit.js";
import {
  listStores,
  readStore,
  storePath,
  serializeStore,
  applyStoreOperations,
  type Store,
  type StoreOperation,
} from "./stores.js";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

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
 * @param server   the MCP server to register on
 * @param sharedGh the root data-repo client (stores are shared corpus)
 */
export function registerStoreTools(server: McpServer, sharedGh: GitHubClient): void {
  server.registerTool(
    "list_stores",
    {
      description:
        "List the stores in the shared registry. Returns { stores: [{ slug, name, label, domain }] } — identity only. Reads the shared stores/ directory directly (no index). An empty/absent registry returns { stores: [] } — the walk still works (it degrades to a department-grouped list from general knowledge). To tell whether a store has a usable aisle map, read its layout-tagged store notes (read_store_notes), not this list.",
      inputSchema: {},
    },
    () => runTool(() => listStores(sharedGh)),
  );

  server.registerTool(
    "read_store",
    {
      description:
        "Read one store's identity by slug (name, label, chain, address, domain). Layout and observations are NOT here — they're attributed store notes; use read_store_notes for the aisle map (layout-tagged), where-it-hides hints (location), not-carried entries (stock), and freeform notes (hours, parking). Unknown slug → structured not_found.",
      inputSchema: { slug: z.string() },
    },
    ({ slug }) => runTool(() => readStore(sharedGh, slug)),
  );

  server.registerTool(
    "add_store",
    {
      description:
        "Register a new store LOCATION in the shared registry (stores/<slug>.toml) — identity only. `slug` is a kebab-case LOCATION id (west-7th-tom-thumb, not tom-thumb). `name` is required; `label`/`chain`/`address` optional; `domain` defaults to 'grocery' (set 'home-improvement' etc. for a non-grocery store). `location_id` is an optional chain-specific external id — for Kroger stores, set it to the resolved Kroger locationId so in-store walks skip the Locations API lookup. Layout is NOT set here — map a store by recording layout-tagged store notes (add_store_note) as you walk it. Shared corpus, no extra gate. Errors with slug_exists if the slug is already registered (edit identity with update_store).",
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
        if (!SLUG_RE.test(input.slug)) {
          throw new ToolError("validation_failed", `Invalid store slug: ${input.slug}`, {
            slug: input.slug,
          });
        }
        if (!input.name.trim()) {
          throw new ToolError("validation_failed", "store name must not be empty", { slug: input.slug });
        }
        const path = storePath(input.slug);
        if ((await readOptional(sharedGh, path)) !== null) {
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
        const { commit_sha } = await commitFiles(
          sharedGh,
          [{ path, content: serializeStore(store) }],
          `add store: ${store.slug}`,
        );
        return { store, commit_sha };
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
        const store = await readStore(sharedGh, slug); // throws not_found if absent
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
        const { commit_sha } = await commitFiles(
          sharedGh,
          [{ path: storePath(slug), content: serializeStore(result.store) }],
          `update store: ${slug}`,
        );
        return { slug, applied: result.applied, conflicts: allConflicts, commit_sha };
      }),
  );

  server.registerTool(
    "remove_store",
    {
      description:
        "Remove a mapped store from the shared registry (deletes stores/<slug>.toml). Unknown slug → structured not_found. Attributed store notes in members' subtrees are left untouched.",
      inputSchema: { slug: z.string() },
    },
    ({ slug }) =>
      runTool(async () => {
        if (!SLUG_RE.test(slug) || (await readOptional(sharedGh, storePath(slug))) === null) {
          throw new ToolError("not_found", `Unknown store: ${slug}`, { slug });
        }
        const change: TreeChange = { path: storePath(slug), delete: true };
        const { commit_sha } = await commitFiles(sharedGh, [change], `remove store: ${slug}`);
        return { slug, removed: true, commit_sha };
      }),
  );
}
