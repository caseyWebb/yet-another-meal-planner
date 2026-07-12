import type { GroceryListData } from "@yamp/contract";
import { describe, expect, it } from "vitest";
import {
  createGroceryBridgeAdapter,
  type GroceryBridge,
  grocerySnapshotFromBridge,
  resolveGroceryCapabilities,
  resolveHydratedGroceryCapabilities,
} from "./grocery-bridge";

const data: GroceryListData = {
  contract_version: 1,
  snapshot_version: "v",
  as_of: "2026-07-12",
  lines: [],
  to_buy: [],
  pantry_covered: [],
  in_cart_groups: [],
  underived: [],
  location: null,
  flyer_as_of: null,
  counts: { to_buy: 0, checked: 0, in_carts: 0, recipes: 0 },
};
function bridge(result: Record<string, unknown> = { structuredContent: { snapshot: data, outcome: "checked milk" } }) {
  const calls: unknown[] = [];
  const contexts: unknown[] = [];
  const messages: unknown[] = [];
  const value: GroceryBridge = {
    async callServerTool(p) {
      calls.push(p);
      return result;
    },
    async updateModelContext(p) {
      contexts.push(p);
    },
    async sendMessage(p) {
      messages.push(p);
    },
  };
  return { value, calls, contexts, messages };
}

describe("Grocery MCP bridge", () => {
  it("gates versions, hydration, and the capability ladder", () => {
    expect(
      resolveGroceryCapabilities({
        contractVersion: 2,
        serverTools: true,
        updateModelContext: true,
        message: true,
        hydrated: true,
      }).mode,
    ).toBe("readonly");
    expect(
      resolveGroceryCapabilities({
        contractVersion: 1,
        serverTools: true,
        updateModelContext: true,
        message: true,
        hydrated: false,
      }).mode,
    ).toBe("readonly");
    expect(
      resolveGroceryCapabilities({
        contractVersion: 1,
        serverTools: true,
        updateModelContext: true,
        message: true,
        hydrated: true,
      }).mode,
    ).toBe("interactive");
    expect(
      resolveGroceryCapabilities({
        contractVersion: 1,
        serverTools: false,
        updateModelContext: false,
        message: true,
        hydrated: true,
      }).mode,
    ).toBe("delegate");
  });

  it("degrades a v1 spawning payload when the hydrated current snapshot is unknown v2", () => {
    expect(
      resolveHydratedGroceryCapabilities({
        currentContractVersion: 2,
        serverTools: true,
        updateModelContext: true,
        message: true,
        hydrated: true,
      }),
    ).toEqual({ mode: "readonly", contractSupported: false });
  });

  it("a check calls its tool and mirrors full context without a message", async () => {
    const b = bridge();
    const adapter = createGroceryBridgeAdapter(b.value, { mode: "interactive", contractSupported: true });
    await adapter.mutate({
      kind: "checked",
      key: "milk",
      checked: true,
      expected_row_version: 1,
      snapshot_version: "v",
    });
    expect(b.calls).toHaveLength(1);
    expect(b.contexts).toHaveLength(1);
    expect(b.messages).toHaveLength(0);
    expect((b.contexts[0] as { structuredContent: object }).structuredContent).toMatchObject({
      snapshot_version: "v",
      action_summary: "checked",
    });
  });

  it.each([
    [{ kind: "add", name: "milk" } as const, "added", "added milk"],
    [{ kind: "remove", key: "milk" } as const, "removed", "removed milk"],
  ])("maps %s to its own model-context outcome", async (action, kind, message) => {
    const b = bridge({ structuredContent: { snapshot: data, outcome: message } });
    const adapter = createGroceryBridgeAdapter(b.value, { mode: "interactive", contractSupported: true });
    await adapter.mutate(action);
    expect(b.contexts[0]).toMatchObject({ structuredContent: { outcome: { kind, message } } });
  });

  it("mark placed mirrors then sends exactly one completion message", async () => {
    const b = bridge({ structuredContent: { snapshot: data, outcome: "already placed; no rows advanced" } });
    const adapter = createGroceryBridgeAdapter(b.value, { mode: "interactive", contractSupported: true });
    await adapter.mutate({
      kind: "mark_placed",
      send_id: "s1",
      expected_line_keys: ["milk"],
      snapshot_version: "v",
    });
    expect(b.contexts).toHaveLength(1);
    expect(b.messages).toHaveLength(1);
    expect(b.contexts[0]).toMatchObject({
      structuredContent: { outcome: { kind: "placed", message: "already placed; no rows advanced" } },
    });
    expect(b.messages[0]).toMatchObject({
      content: [{ text: "Grocery send s1: already placed; no rows advanced." }],
    });
  });

  it("isError and malformed results never publish success", async () => {
    const b = bridge({ isError: true, content: [{ type: "text", text: "conflict" }] });
    const adapter = createGroceryBridgeAdapter(b.value, { mode: "interactive", contractSupported: true });
    await expect(adapter.mutate({ kind: "add", name: "milk" })).rejects.toThrow();
    expect(b.contexts).toHaveLength(0);
    expect(b.messages).toHaveLength(0);
    expect(grocerySnapshotFromBridge({ structuredContent: { contract_version: 99 } })).toBeNull();
  });

  it.each([undefined, "", 42])("rejects a successful-looking mutation with invalid outcome %s", async (outcome) => {
    const b = bridge({ structuredContent: { snapshot: data, ...(outcome === undefined ? {} : { outcome }) } });
    const adapter = createGroceryBridgeAdapter(b.value, { mode: "interactive", contractSupported: true });
    await expect(adapter.mutate({
      kind: "mark_placed",
      send_id: "s1",
      expected_line_keys: ["milk"],
      snapshot_version: "v",
    })).rejects.toThrow("no valid grocery mutation outcome");
    expect(b.contexts).toHaveLength(0);
    expect(b.messages).toHaveLength(0);
  });

  it("preserves a structured MCP conflict snapshot for controller replacement", async () => {
    const current = { ...data, snapshot_version: "current" };
    const b = bridge({
      isError: true,
      structuredContent: { error: "conflict", message: "The row changed", context: { snapshot: current } },
    });
    const adapter = createGroceryBridgeAdapter(b.value, { mode: "interactive", contractSupported: true });
    await expect(adapter.mutate({ kind: "add", name: "milk" })).rejects.toMatchObject({
      message: "The row changed",
      context: { snapshot: { snapshot_version: "current" } },
    });
    expect(b.contexts).toHaveLength(0);
  });

  it("delegates with an explicit action message only for an outset host without tools", async () => {
    const b = bridge();
    const adapter = createGroceryBridgeAdapter(b.value, { mode: "delegate", contractSupported: true });
    await adapter.delegate?.({
      kind: "substitute",
      original_key: "milk",
      replacement_key: "oat-milk",
      replacement_name: "Oat milk",
      snapshot_version: "v",
    });
    expect(b.messages).toEqual([
      {
        role: "user",
        content: [{ type: "text", text: "Please substitute Oat milk for milk on my grocery list." }],
      },
    ]);
  });
});
