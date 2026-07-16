// The ops-form update_grocery_list tool (grocery-list capability, narrow-mcp-surface): the
// dispatch layer over the already-unit-tested addGroceryRow/updateGroceryRow/removeGroceryRow
// operations (grocery.test.ts covers those directly). This file covers what's new at the TOOL
// layer — per-op applied/conflicts reporting so one bad op never sinks a multi-op call, the
// status-guard surfacing as a conflict (not a throw), the one-window add_to_grocery_list /
// remove_from_grocery_list dispatch aliases, and the deprecated single-patch call-form's
// shape-detected conversion (which keeps its OWN bare-`{item}`/throw-on-failure contract,
// unlike the ops-form). Spend materialization itself is exercised end to end at the shared
// `updateGroceryRow` op (session-db.ts) and grocery-send-lifecycle.test.ts; here we only
// confirm the ops-form's "update" op threads through to that same guarantee.

import { describe, it, expect } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerGroceryListTools } from "../src/grocery-tools.js";
import { withServer, invokeTool } from "./tool-harness.js";
import { sqliteEnv } from "./sqlite-d1.js";

const TENANT = "casey";

function groceryServer(env: ReturnType<typeof sqliteEnv>["env"]) {
  const server = new McpServer({ name: "grocery-tools-test", version: "0.0.0" });
  registerGroceryListTools(server, env, TENANT);
  return server;
}

describe("update_grocery_list — ops-form add/update/remove", () => {
  it("applies add, update, and remove ops in one call, each with its own applied entry", async () => {
    const h = sqliteEnv([TENANT]);
    const server = groceryServer(h.env);
    const out = await withServer(server, (c) =>
      invokeTool(c, "update_grocery_list", {
        operations: [
          { op: "add", name: "olive oil", quantity: "1" },
          { op: "add", name: "milk", quantity: "1" },
        ],
      }),
    );
    expect(out.isError).toBe(false);
    const first = out.result as { applied: Array<Record<string, unknown>>; conflicts: unknown[] };
    expect(first.conflicts).toEqual([]);
    expect(first.applied).toHaveLength(2);
    expect(first.applied[0]).toMatchObject({ op: "add", item: { name: "olive oil" } });
    expect(first.applied[0].merged).toBeUndefined();

    const second = await withServer(server, (c) =>
      invokeTool(c, "update_grocery_list", {
        operations: [
          { op: "update", name: "olive oil", quantity: "2" },
          { op: "remove", name: "milk" },
        ],
      }),
    );
    const applied = (second.result as { applied: Array<Record<string, unknown>> }).applied;
    expect(applied[0]).toMatchObject({ op: "update", item: { name: "olive oil", quantity: "2" } });
    expect(applied[1]).toMatchObject({ op: "remove", name: "milk", removed: true });
    expect(h.rows("grocery_list")).toHaveLength(1);
  });

  it("a re-added name merges into the existing row instead of duplicating (merged: true)", async () => {
    const h = sqliteEnv([TENANT]);
    const server = groceryServer(h.env);
    await withServer(server, (c) => invokeTool(c, "update_grocery_list", { operations: [{ op: "add", name: "eggs", for_recipes: ["a"] }] }));
    const out = await withServer(server, (c) =>
      invokeTool(c, "update_grocery_list", { operations: [{ op: "add", name: "eggs", for_recipes: ["b"] }] }),
    );
    const applied = (out.result as { applied: Array<Record<string, unknown>> }).applied;
    expect(applied[0]).toMatchObject({ op: "add", merged: true });
    expect(h.rows("grocery_list")).toHaveLength(1);
  });

  it("one bad op (update on an unknown name) reports a conflict without sinking the rest of the call", async () => {
    const h = sqliteEnv([TENANT]);
    const server = groceryServer(h.env);
    const out = await withServer(server, (c) =>
      invokeTool(c, "update_grocery_list", {
        operations: [
          { op: "add", name: "flour", quantity: "1" },
          { op: "update", name: "not-on-the-list", quantity: "5" },
        ],
      }),
    );
    expect(out.isError).toBe(false);
    const { applied, conflicts } = out.result as { applied: unknown[]; conflicts: Array<Record<string, unknown>> };
    expect(applied).toHaveLength(1);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ op: "update", name: "not-on-the-list", code: "not_found" });
    expect(h.rows("grocery_list")).toHaveLength(1);
  });

  it("an illegal status transition (active straight to ordered) is a per-op conflict, not a thrown error", async () => {
    const h = sqliteEnv([TENANT]);
    const server = groceryServer(h.env);
    await withServer(server, (c) => invokeTool(c, "update_grocery_list", { operations: [{ op: "add", name: "butter" }] }));
    const out = await withServer(server, (c) =>
      invokeTool(c, "update_grocery_list", { operations: [{ op: "update", name: "butter", status: "ordered" }] }),
    );
    expect(out.isError).toBe(false);
    const { applied, conflicts } = out.result as { applied: unknown[]; conflicts: Array<Record<string, unknown>> };
    expect(applied).toHaveLength(0);
    expect(conflicts[0]).toMatchObject({ op: "update", name: "butter", code: "validation_failed" });
    expect(h.rows<{ status: string }>("grocery_list")[0].status).toBe("active");
  });

  it("the legal in_cart -> ordered advance of a linked row materializes its send-snapshot line as spend (the shared op's guarantee, threaded through the ops-form)", async () => {
    const h = sqliteEnv([TENANT]);
    h.raw
      .prepare("INSERT INTO order_sends (id,tenant,store,fulfillment,created_at) VALUES ('s1',?,'kroger','kroger_online','2026-07-12T10:00:00Z')")
      .run(TENANT);
    h.raw
      .prepare(
        "INSERT INTO order_send_lines (send_id,line_key,name,quantity,unit_price,savings,provenance) VALUES ('s1','olive oil','olive oil',1,4,0,'planned')",
      )
      .run();
    h.raw
      .prepare(
        "INSERT INTO grocery_list (tenant,name,normalized_name,status,sent_in) VALUES (?,'olive oil','olive oil','in_cart','s1')",
      )
      .run(TENANT);
    const server = groceryServer(h.env);
    const out = await withServer(server, (c) =>
      invokeTool(c, "update_grocery_list", { operations: [{ op: "update", name: "olive oil", status: "ordered" }] }),
    );
    expect(out.isError).toBe(false);
    const applied = (out.result as { applied: Array<Record<string, unknown>> }).applied;
    expect(applied[0]).toMatchObject({ op: "update", item: { name: "olive oil", status: "ordered" } });
    expect(h.rows("spend_events")).toHaveLength(1);
  });

  it("a remove never writes spend, even for a linked row", async () => {
    const h = sqliteEnv([TENANT]);
    h.raw
      .prepare("INSERT INTO order_sends (id,tenant,store,fulfillment,created_at) VALUES ('s1',?,'kroger','kroger_online','2026-07-12T10:00:00Z')")
      .run(TENANT);
    h.raw
      .prepare(
        "INSERT INTO grocery_list (tenant,name,normalized_name,status,sent_in) VALUES (?,'milk','milk','in_cart','s1')",
      )
      .run(TENANT);
    const server = groceryServer(h.env);
    await withServer(server, (c) => invokeTool(c, "update_grocery_list", { operations: [{ op: "remove", name: "milk" }] }));
    expect(h.rows("spend_events")).toHaveLength(0);
  });
});

describe("update_grocery_list — one-window dispatch aliases (mcp-tool-gating D3)", () => {
  it("add_to_grocery_list dispatches identically to an equivalent ops-form add", async () => {
    const h = sqliteEnv([TENANT]);
    const server = groceryServer(h.env);
    const out = await withServer(server, (c) => invokeTool(c, "add_to_grocery_list", { name: "bread", quantity: "1" }));
    expect(out.isError).toBe(false);
    expect(out.result).toMatchObject({ item: { name: "bread", quantity: "1" } });
    expect((out.result as { merged?: boolean }).merged).toBeFalsy();
    expect(h.rows("grocery_list")).toHaveLength(1);
  });

  it("remove_from_grocery_list dispatches identically to an equivalent ops-form remove", async () => {
    const h = sqliteEnv([TENANT]);
    const server = groceryServer(h.env);
    await withServer(server, (c) => invokeTool(c, "add_to_grocery_list", { name: "bread" }));
    const out = await withServer(server, (c) => invokeTool(c, "remove_from_grocery_list", { name: "bread" }));
    expect(out.isError).toBe(false);
    expect(out.result).toEqual({ removed: true });
    expect(h.rows("grocery_list")).toHaveLength(0);
  });

  it("remove_from_grocery_list reports removed: false for an absent name, without erroring", async () => {
    const h = sqliteEnv([TENANT]);
    const server = groceryServer(h.env);
    const out = await withServer(server, (c) => invokeTool(c, "remove_from_grocery_list", { name: "nonexistent" }));
    expect(out.isError).toBe(false);
    expect(out.result).toEqual({ removed: false });
  });

  it("the deprecated single-patch update_grocery_list(name, ...patch) form is shape-detected and converted, returning the bare { item } shape", async () => {
    const h = sqliteEnv([TENANT]);
    const server = groceryServer(h.env);
    await withServer(server, (c) => invokeTool(c, "add_to_grocery_list", { name: "cheese", quantity: "1" }));
    const out = await withServer(server, (c) => invokeTool(c, "update_grocery_list", { name: "cheese", quantity: "2" }));
    expect(out.isError).toBe(false);
    // The bare { item } shape — no operations/applied/conflicts wrapper, matching the retired
    // standalone tool's exact contract.
    expect(out.result).toEqual({ item: expect.objectContaining({ name: "cheese", quantity: "2" }) });
  });

  it("the old single-patch form THROWS on failure (a not_found), unlike the ops-form's conflicts reporting", async () => {
    const h = sqliteEnv([TENANT]);
    const server = groceryServer(h.env);
    const out = await withServer(server, (c) => invokeTool(c, "update_grocery_list", { name: "no-such-item", quantity: "2" }));
    expect(out.isError).toBe(true);
    expect(out.result).toMatchObject({ error: "not_found" });
  });
});
