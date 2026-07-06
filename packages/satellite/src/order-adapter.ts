// The cart-fill adapter plugin model + its SDK (satellite-order-cart-fill), parallel to the
// sale-scan SaleScanAdapter in ./sale-adapter.ts. An order adapter drives a store's own cart in a
// LIVE authenticated browser session to add each issued line, and emits RAW `order` observations
// (sensor-not-judge — the per-item cart outcome only, never a derived grocery-list state; the
// Worker re-derives the `in_cart` transition). Every emit is validated against the shared contract
// (`parseOrderObservation`) before the satellite will post the receipt, so an adapter cannot smuggle
// a non-contract shape or a derived state field onto the wire.
//
// Cart-fill is human-directed and ToS-hostile, so — like sale-scan and consistent with the
// initiative principle (core ships host + contract + SDK, users ship the drivers) — there is NO
// built-in named-retailer order adapter: order adapters load only from the mounted adapters_dir.
// It is also browser-ONLY: a fill needs a live authenticated store session, so unlike the recipe/
// sale SDKs there is no plain-HTTP tier here — the SDK always carries a live Playwright `page`.

import { parseOrderObservation, type OrderLine, type OrderObservation, type LocalRejectCategory } from "@grocery-agent/contract";
import { pathToFileURL } from "node:url";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { SatelliteConfig, OrderStoreConfig } from "./config.js";
import type { StorageState } from "./session.js";
import type { Logger } from "./adapter.js";
// Import the Playwright TYPES only (erased at compile time by verbatimModuleSyntax + `import type`),
// so no runtime dependency is created — the live page is injected by the helper, never launched here.
import type { Page } from "playwright";

/**
 * An ambiguity the adapter surfaces to the human in the local UI and awaits a resolution for — the
 * ONLY resolver backend (Decision 9): there is no automated matcher, so a substitution/ambiguity is
 * always a human decision. `item_id` scopes it to the pull-list line; `options` are the candidate
 * store products to choose among (empty ⇒ a plain confirm).
 */
export interface CheckpointPrompt {
  /** The pull-list line this ambiguity is about (its canonical id). */
  item_id: string;
  /** Human-readable question/context (e.g. "3 close matches for 'whole milk' — pick one"). */
  message: string;
  /** Candidate store products the human chooses among — the same raw provenance shape an emit carries. */
  options?: { productId: string; description: string; size?: string; price?: number; url?: string }[];
}

/** The human's resolution of a checkpoint — a discriminated union so an unhandled action can't slip through. */
export type CheckpointResolution =
  | { action: "select"; productId: string }
  | { action: "substitute"; product: { productId: string; description: string; size?: string; price?: number; url?: string } }
  | { action: "skip" }
  | { action: "abort" };

/**
 * The SDK injected into an order adapter — the store's config + captured session, a LIVE Playwright
 * page bound to that session (cart-fill is browser-only, so there is no fetch tier), a logger, and
 * the human `checkpoint` hand-off (the only resolver). The page is opened and disposed by the helper.
 */
export interface OrderSdk {
  /** The `[[order_stores]]` entry this SDK instance drives. */
  store: OrderStoreConfig;
  /** The machine's config (adapters_dir, connector, etc.). */
  config: SatelliteConfig;
  /** The store's loaded session (null when none captured — the fill will fail auth without one). */
  session: StorageState | null;
  /** A live Playwright page bound to the store session — the adapter drives the store's own cart on it. */
  page: Page;
  log: Logger;
  /** Surface an ambiguity to the human in the local UI and await their resolution (the only resolver). */
  checkpoint(prompt: CheckpointPrompt): Promise<CheckpointResolution>;
}

/**
 * A cart-fill adapter. `fill` drives the store cart for the issued `lines` (the pull-list), resolving
 * any ambiguity through `sdk.checkpoint` (the human), and returns the RAW per-item `order`
 * observations it produced, or a structured error to fail the whole fill (e.g. the session expired).
 * It fills the cart and stops at review — it NEVER checks out (the safety property, Decision 6).
 */
export interface OrderAdapter {
  id: string;
  fill(sdk: OrderSdk, lines: OrderLine[]): Promise<OrderObservation[] | { error: string }>;
}

/** An operator order adapter module's default export: a factory over the OrderSdk. */
export type OrderAdapterFactory = (sdk: OrderSdk) => OrderAdapter;

/** Derived grocery-list-state keys a sensor-not-judge adapter must NEVER emit — the Worker re-derives these. */
const JUDGMENT_KEYS = ["status", "in_cart", "inCart", "ordered", "grocery_status", "state", "advanced"] as const;

/**
 * Validate ONE emitted observation against the shared contract before the satellite posts the receipt.
 * Returns the parsed observation, or a structured error the caller treats as a local skip — an adapter
 * cannot post a non-contract shape or a smuggled derived-state field. A derived grocery-list state field
 * (`status`/`in_cart`/…) is REJECTED loudly rather than silently stripped, so a misbehaving adapter
 * surfaces to the operator instead of quietly shipping a judgment (the Worker also re-derives regardless).
 */
export function validateOrderEmit(
  emitted: unknown,
): { ok: true; value: OrderObservation } | { ok: false; error: string; category: LocalRejectCategory } {
  if (emitted !== null && typeof emitted === "object") {
    for (const k of JUDGMENT_KEYS) {
      if (k in (emitted as Record<string, unknown>)) {
        return {
          ok: false,
          error: `sensor-not-judge violation: adapter emitted a derived grocery-list "${k}" field (report only the raw { item_id, disposition, product })`,
          category: "judgment_smuggled",
        };
      }
    }
  }
  const parsed = parseOrderObservation(emitted);
  if (!parsed.ok) return { ok: false, error: `adapter emitted an invalid order observation: ${parsed.error}`, category: "contract_invalid" };
  return { ok: true, value: parsed.value };
}

/**
 * Load the operator order-fill adapter factories from `config.adapters_dir` (modules ending
 * .mjs/.js/.ts default-exporting a factory `(sdk) => OrderAdapter`). The module's basename is its
 * adapter name. Like the sale-scan loader — and UNLIKE the recipe loader — there are NO built-ins:
 * a store's order adapter is always operator-authored (the ToS-hostile driver the core does not
 * ship). A missing adapters_dir yields an empty map (the machine references no order adapter).
 */
export async function loadOrderAdapters(config: SatelliteConfig): Promise<Record<string, OrderAdapterFactory>> {
  const adapters: Record<string, OrderAdapterFactory> = {};
  if (!config.adapters_dir) return adapters;

  let entries: string[];
  try {
    entries = readdirSync(config.adapters_dir);
  } catch {
    return adapters; // a missing dir is not fatal — validated again when a fill needs an adapter
  }

  for (const file of entries) {
    if (!/\.(mjs|js|ts)$/.test(file)) continue;
    const name = file.replace(/\.(mjs|js|ts)$/, "");
    const modUrl = pathToFileURL(join(config.adapters_dir, file)).href;
    const mod = (await import(modUrl)) as { default?: unknown };
    if (typeof mod.default !== "function") {
      throw new Error(`operator order adapter ${file} must default-export a factory (sdk) => OrderAdapter`);
    }
    adapters[name] = mod.default as OrderAdapterFactory;
  }
  return adapters;
}
