import {
  type GroceryListData,
  type GroceryModelContext,
  groceryContractSupport,
  parseGroceryListData,
} from "@yamp/contract";
import type { GroceryAction, GroceryHostAdapter } from "./grocery-controller";

export interface GroceryBridgeResult {
  structuredContent?: Record<string, unknown>;
  content?: { type: string; text?: string }[];
  isError?: boolean;
}
export interface GroceryBridge {
  callServerTool(params: { name: string; arguments: Record<string, unknown> }): Promise<GroceryBridgeResult>;
  updateModelContext(params: { structuredContent?: Record<string, unknown> }): Promise<unknown>;
  sendMessage(params: { role: "user"; content: { type: "text"; text: string }[] }): Promise<unknown>;
}
export interface GroceryCapabilities {
  mode: "interactive" | "delegate" | "readonly";
  contractSupported: boolean;
}

export function resolveGroceryCapabilities(input: {
  contractVersion: unknown;
  serverTools: boolean;
  updateModelContext: boolean;
  message: boolean;
  hydrated: boolean;
}): GroceryCapabilities {
  const contractSupported = groceryContractSupport(input.contractVersion) === "supported";
  if (!contractSupported) return { mode: "readonly", contractSupported };
  if (input.serverTools && input.updateModelContext)
    return { mode: input.hydrated ? "interactive" : "readonly", contractSupported };
  // Delegation is only the outset fallback for hosts with no direct tool proxy. A host
  // that can boot directly stays read-only while boot is pending or after boot fails.
  if (!input.serverTools && input.message) return { mode: "delegate", contractSupported };
  return { mode: "readonly", contractSupported };
}

/** Re-evaluate compatibility from the boot snapshot, never from stale spawning content. */
export function resolveHydratedGroceryCapabilities(input: {
  currentContractVersion: unknown;
  serverTools: boolean;
  updateModelContext: boolean;
  message: boolean;
  hydrated: boolean;
}): GroceryCapabilities {
  return resolveGroceryCapabilities({
    contractVersion: input.currentContractVersion,
    serverTools: input.serverTools,
    updateModelContext: input.updateModelContext,
    message: input.message,
    hydrated: input.hydrated,
  });
}

export function grocerySnapshotFromBridge(result: GroceryBridgeResult): GroceryListData | null {
  if (result.isError) return null;
  const structured = result.structuredContent;
  const candidate = structured?.snapshot ?? structured;
  const parsed = parseGroceryListDataSafe(candidate);
  if (parsed) return parsed;
  const text = result.content?.find((c) => c.type === "text")?.text;
  if (!text) return null;
  try {
    const value = JSON.parse(text) as Record<string, unknown>;
    return parseGroceryListDataSafe(value.snapshot ?? value);
  } catch {
    return null;
  }
}

function parseGroceryListDataSafe(value: unknown): GroceryListData | null {
  try {
    return parseGroceryListData(value);
  } catch {
    return null;
  }
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function errorFromBridge(
  result: GroceryBridgeResult,
): Error & { snapshot?: GroceryListData; context?: { snapshot?: GroceryListData } } {
  const structured = recordOf(result.structuredContent);
  const text = result.content?.find((item) => item.type === "text")?.text;
  let textBody: Record<string, unknown> | null = null;
  if (text) {
    try {
      textBody = recordOf(JSON.parse(text));
    } catch {
      /* Plain MCP error text is still useful. */
    }
  }
  const body = structured ?? textBody;
  const context = recordOf(body?.context);
  const snapshot = parseGroceryListDataSafe(body?.snapshot ?? context?.snapshot);
  const message =
    (typeof body?.message === "string" && body.message) ||
    (typeof body?.error === "string" && body.error) ||
    text ||
    "The grocery action failed";
  return Object.assign(new Error(message), snapshot ? { snapshot, context: { snapshot } } : {});
}

function callFor(action: GroceryAction): { name: string; arguments: Record<string, unknown> } {
  switch (action.kind) {
    case "add":
      return { name: "grocery_add", arguments: { name: action.name } };
    case "remove":
      return { name: "grocery_remove", arguments: { key: action.key } };
    case "checked":
      return {
        name: "set_grocery_checked",
        arguments: {
          key: action.key,
          checked: action.checked,
          expected_row_version: action.expected_row_version,
          snapshot_version: action.snapshot_version,
        },
      };
    case "pantry_verify":
      return { name: "verify_grocery_pantry", arguments: action };
    case "pantry_buy_anyway":
      return { name: "set_grocery_buy_anyway", arguments: { ...action, enabled: true } };
    case "pantry_undo":
      return { name: "set_grocery_buy_anyway", arguments: { ...action, enabled: false } };
    case "substitute":
      return { name: "set_grocery_substitution", arguments: action };
    case "substitute_undo":
      return { name: "set_grocery_substitution", arguments: { ...action, undo: true } };
    case "relist":
      return {
        name: "relist_grocery_send_line",
        arguments: {
          send_id: action.send_id,
          line_key: action.key,
          expected_row_version: action.expected_row_version,
        },
      };
    case "mark_placed":
      return {
        name: "mark_grocery_send_placed",
        arguments: {
          send_id: action.send_id,
          expected_line_keys: action.expected_line_keys,
          snapshot_version: action.snapshot_version,
        },
      };
  }
}

function outcomeFromBridge(result: GroceryBridgeResult, fallback: string): string {
  const structured = recordOf(result.structuredContent);
  if (typeof structured?.outcome === "string" && structured.outcome.trim()) return structured.outcome;
  const text = result.content?.find((item) => item.type === "text")?.text;
  if (text) {
    try {
      const body = recordOf(JSON.parse(text));
      if (typeof body?.outcome === "string" && body.outcome.trim()) return body.outcome;
    } catch {
      /* The structured channel owns mutation outcomes; plain fallback text is not reinterpreted. */
    }
  }
  return fallback;
}

export function createGroceryBridgeAdapter(
  bridge: GroceryBridge,
  capabilities: GroceryCapabilities,
): GroceryHostAdapter {
  return {
    mode: capabilities.mode,
    online: true,
    async mutate(action) {
      if (capabilities.mode !== "interactive")
        throw new Error("Grocery writes are not available in this host");
      const call = callFor(action);
      const result = await bridge.callServerTool(call);
      if (result.isError) throw errorFromBridge(result);
      const snapshot = grocerySnapshotFromBridge(result);
      if (!snapshot)
        throw new Error(
          result.isError ? "The grocery action failed" : "The server returned no current grocery snapshot",
        );
      const actualOutcome = outcomeFromBridge(result, action.kind);
      const context: GroceryModelContext = {
        ...snapshot,
        action_summary: action.kind,
        outcome: {
          kind:
            action.kind === "mark_placed"
              ? "placed"
              : action.kind === "relist"
                ? "relisted"
                : action.kind === "checked"
                  ? "checked"
                  : action.kind.startsWith("pantry")
                    ? "pantry"
                    : "substitution",
          message: actualOutcome,
        },
      };
      await bridge.updateModelContext({ structuredContent: context as unknown as Record<string, unknown> });
      if (action.kind === "mark_placed")
        await bridge.sendMessage({
          role: "user",
          content: [{ type: "text", text: `Grocery send ${action.send_id}: ${actualOutcome}.` }],
        });
      return snapshot;
    },
    async delegate(action) {
      if (capabilities.mode !== "delegate") return;
      await bridge.sendMessage({
        role: "user",
        content: [{ type: "text", text: delegationMessage(action) }],
      });
    },
  };
}

function delegationMessage(action: GroceryAction): string {
  switch (action.kind) {
    case "add":
      return `Please add ${action.name} to my grocery list.`;
    case "remove":
      return `Please remove ${action.key} from my grocery list.`;
    case "checked":
      return `Please mark ${action.key} ${action.checked ? "checked" : "not checked"} on my grocery list.`;
    case "relist":
      return `Please move ${action.key} from send ${action.send_id} back to my grocery list.`;
    case "mark_placed":
      return `Please mark the whole ${action.send_id} grocery send placed.`;
    case "pantry_verify":
      return `Please verify that ${action.key} is still good in my pantry.`;
    case "pantry_buy_anyway":
      return `Please buy ${action.key} anyway despite pantry coverage.`;
    case "pantry_undo":
      return `Please restore pantry coverage for ${action.key}.`;
    case "substitute":
      return `Please substitute ${action.replacement_name} for ${action.original_key} on my grocery list.`;
    case "substitute_undo":
      return `Please undo the substitution for ${action.original_key} on my grocery list.`;
  }
}
