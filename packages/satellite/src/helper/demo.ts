// Order Helper DEMO mode (satellite-order-cart-fill) — canned fixtures so the whole UI can be walked
// with NO Worker and NO real store (offline QA + operator preview). It is a self-contained, isolated
// module gated behind the CLI `--demo` flag (or `OH_DEMO=1`): the real drive/adapter/connector path is
// NEVER touched. It plugs into the helper's existing injection seams — the `fetchImpl` (canned pull-
// list + receipt), the `adapterFactory` (a scripted fill that emits progress and raises two
// checkpoints), the `openPage` (a stub, no browser), and a non-null `session` — so the ENTIRE flow
// runs through the real server + `Drive` orchestration; only the store and the connector are faked.
//
// Fixtures are derived from the Claude Design bundle's sample content (Target · Minneapolis Nicollet).

import type { OrderLine, OrderObservation, OrderReceiptRequest } from "@grocery-agent/contract";
import type { OrderStoreConfig } from "../config.js";
import type { StorageState } from "../session.js";
import type { FetchImpl } from "../push.js";
import type { OrderAdapterFactory } from "../order-adapter.js";
import type { PageHandle, OrderProduct } from "./drive.js";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** The demo store — a fake `[[order_stores]]` entry (slug renders title-cased in the UI header). */
export const DEMO_STORE: OrderStoreConfig = { store: "target", adapter: "target-demo" };

/** A non-null placeholder session so the UI's connection popover shows a captured session. */
export const DEMO_SESSION: StorageState = { cookies: [], origins: [] } as unknown as StorageState;

/** One scripted line: the pull-list fields + how the demo adapter dispositions it during the fill. */
interface DemoItem {
  line: OrderLine;
  /** carted / substituted with this product, unavailable with a note, or a human checkpoint. */
  outcome:
    | { kind: "carted"; product: OrderProduct }
    | { kind: "substituted"; product: OrderProduct; note: string }
    | { kind: "unavailable"; note: string }
    | { kind: "checkpoint"; message: string; options: OrderProduct[] };
}

/** Order mirrors the design's DRIVE_ORDER — a natural build-up before each checkpoint. */
const DEMO_ITEMS: DemoItem[] = [
  {
    line: { item_id: "onions", name: "Yellow onions", quantity: 3, for_recipes: ["Weeknight chicken tacos", "Sunday chili"], assumed_quantity: false },
    outcome: { kind: "carted", product: { productId: "gg-onions", description: "Good & Gather Yellow Onions", size: "3 lb bag", price: 3.29 } },
  },
  {
    line: { item_id: "tortillas", name: "Corn tortillas", quantity: 1, for_recipes: ["Weeknight chicken tacos"], assumed_quantity: false },
    outcome: { kind: "carted", product: { productId: "mission-corn", description: "Mission White Corn Tortillas", size: "30 ct", price: 2.49 } },
  },
  {
    line: { item_id: "beans", name: "Black beans", quantity: 2, for_recipes: ["Sunday chili"], assumed_quantity: true },
    outcome: { kind: "carted", product: { productId: "gg-black-beans", description: "Good & Gather Black Beans", size: "2 × 15 oz", price: 1.78 } },
  },
  {
    line: { item_id: "tomatoes", name: "Diced tomatoes", quantity: 1, for_recipes: ["Sunday chili"], assumed_quantity: false },
    outcome: {
      kind: "substituted",
      product: { productId: "gg-diced-tomatoes", description: "Good & Gather Diced Tomatoes", size: "2 × 14.5 oz", price: 1.98 },
      note: "28 oz size out of stock — matched two 14.5 oz cans",
    },
  },
  {
    line: { item_id: "chicken", name: "Boneless chicken thighs", quantity: 1, for_recipes: ["Weeknight chicken tacos", "Sunday chili"], assumed_quantity: false },
    outcome: {
      kind: "checkpoint",
      message: "The closest match is a bit over 2 lb. A few options fit — pick the one you want.",
      options: [
        { productId: "gg-thighs", description: "Good & Gather Boneless Skinless Chicken Thighs", size: "2.5 lb", price: 8.49 },
        { productId: "mp-thighs", description: "Market Pantry Boneless Chicken Thighs", size: "1.4 lb", price: 5.29 },
        { productId: "gg-org-thighs", description: "Good & Gather Organic Chicken Thighs", size: "1 lb", price: 6.99 },
      ],
    },
  },
  {
    line: { item_id: "cumin", name: "Ground cumin", quantity: 1, for_recipes: ["Weeknight chicken tacos", "Sunday chili"], assumed_quantity: true },
    outcome: { kind: "carted", product: { productId: "gg-cumin", description: "Good & Gather Ground Cumin", size: "2.1 oz", price: 2.19 } },
  },
  {
    line: { item_id: "limes", name: "Limes", quantity: 4, for_recipes: ["Weeknight chicken tacos"], assumed_quantity: false },
    outcome: { kind: "carted", product: { productId: "limes", description: "Limes", size: "sold each · 4", price: 1.56 } },
  },
  {
    line: { item_id: "cheddar", name: "Sharp cheddar", quantity: 1, for_recipes: ["Weeknight chicken tacos"], assumed_quantity: false },
    outcome: { kind: "carted", product: { productId: "gg-cheddar", description: "Good & Gather Sharp Cheddar", size: "8 oz block", price: 2.99 } },
  },
  {
    line: { item_id: "sourcream", name: "Sour cream", quantity: 1, for_recipes: ["Weeknight chicken tacos"], assumed_quantity: false },
    outcome: {
      kind: "substituted",
      product: { productId: "gg-sour-cream", description: "Good & Gather Sour Cream", size: "16 oz", price: 1.99 },
      note: "Daisy 16 oz unavailable — matched store brand",
    },
  },
  {
    line: { item_id: "romaine", name: "Romaine hearts", quantity: 2, for_recipes: ["Kale caesar"], assumed_quantity: false },
    outcome: {
      kind: "checkpoint",
      message: "Romaine hearts come a few ways here. Confirm the pack you'd like.",
      options: [
        { productId: "gg-romaine-3", description: "Good & Gather Romaine Hearts", size: "3 ct", price: 3.49 },
        { productId: "mp-romaine-2", description: "Market Pantry Romaine Hearts", size: "2 ct", price: 2.99 },
        { productId: "whole-romaine", description: "Whole Romaine Lettuce", size: "sold each", price: 1.99 },
      ],
    },
  },
  {
    line: { item_id: "parmesan", name: "Parmesan wedge", quantity: 1, for_recipes: ["Kale caesar"], assumed_quantity: false },
    outcome: { kind: "unavailable", note: "Only pre-shredded parmesan in stock — left for you to decide" },
  },
  {
    line: { item_id: "eggs", name: "Large eggs", quantity: 1, for_recipes: ["Weekend breakfast"], assumed_quantity: false },
    outcome: { kind: "carted", product: { productId: "gg-eggs", description: "Good & Gather Grade A Large Eggs", size: "12 ct", price: 2.79 } },
  },
];

const DEMO_PARTIALS = [
  { name: "something leafy for the salad", for_recipes: ["Kale caesar"] },
  { name: "a crusty bread for the chili", for_recipes: ["Sunday chili"] },
];

const DEMO_ORDER_LIST_ID = "demo-order-list-0001";

/** The canned pull-list the demo `fetchImpl` serves for `POST /satellite/order/list`. */
function demoList(): unknown {
  return {
    order_list_id: DEMO_ORDER_LIST_ID,
    store: DEMO_STORE.store,
    location_id: "Minneapolis Nicollet",
    items: DEMO_ITEMS.map((d) => d.line),
    partials: DEMO_PARTIALS,
  };
}

/**
 * A fake `FetchImpl` that stands in for the connector: it answers the order client's two outbound
 * calls (`/satellite/order/list`, `/satellite/order/receipt`) with canned envelopes and refuses
 * anything else. A `mark_placed` receipt (no observations) returns `ordered`; a fill receipt returns
 * `in_cart` with one accepted result per posted observation.
 */
export const demoFetchImpl: FetchImpl = async (url, init) => {
  const json = (value: unknown) => ({ status: 200, json: async () => value });
  if (url.endsWith("/satellite/order/list")) {
    return json(demoList());
  }
  if (url.endsWith("/satellite/order/receipt")) {
    let body: OrderReceiptRequest = { order_list_id: DEMO_ORDER_LIST_ID };
    try {
      body = JSON.parse(init.body) as OrderReceiptRequest;
    } catch {
      /* keep the default */
    }
    if (body.mark_placed) {
      return json({ order_list: { id: DEMO_ORDER_LIST_ID, status: "ordered" }, results: [] });
    }
    const observations = Array.isArray(body.observations) ? body.observations : [];
    const results = observations.map((o) => ({
      disposition: "accepted",
      source: (o as { item_id?: string }).item_id ?? "unknown",
    }));
    return json({ order_list: { id: DEMO_ORDER_LIST_ID, status: "in_cart" }, results });
  }
  return { status: 404, json: async () => ({ ok: false, error: { code: "not_found", message: "demo: no such route" } }) };
};

/** A stub page handle — the demo adapter never touches Playwright, so no browser is launched. */
export const demoOpenPage = async (): Promise<PageHandle> => ({
  page: {} as never,
  close: async () => {},
});

/**
 * The scripted demo adapter. It walks the pull-list in order, emitting `{ progress }` transitions
 * (pending is already seeded by the Drive) — `adding` then the terminal disposition — with short
 * timers, and raises a human checkpoint for the two ambiguous lines, blocking on `sdk.checkpoint`
 * exactly as a real adapter would. It returns the RAW `order` observations the receipt is built from.
 */
export const demoAdapterFactory: OrderAdapterFactory = () => ({
  id: "target-demo",
  async fill(sdk, lines) {
    const byId = new Map(DEMO_ITEMS.map((d) => [d.line.item_id, d]));
    const observations: OrderObservation[] = [];
    const carted = (itemId: string, product: OrderProduct, note?: string): void => {
      sdk.log.info("demo carted", { progress: { item_id: itemId, state: "carted", product, note } });
      observations.push({ kind: "order", item_id: itemId, disposition: "carted", product, ...(note ? { note } : {}) });
    };
    const substituted = (itemId: string, product: OrderProduct, note: string): void => {
      sdk.log.info("demo substituted", { progress: { item_id: itemId, state: "substituted", product, note } });
      observations.push({ kind: "order", item_id: itemId, disposition: "substituted", product, note });
    };
    const unavailable = (itemId: string, note: string): void => {
      sdk.log.info("demo unavailable", { progress: { item_id: itemId, state: "unavailable", note } });
      observations.push({ kind: "order", item_id: itemId, disposition: "unavailable", note });
    };

    for (const line of lines) {
      const demo = byId.get(line.item_id);
      if (!demo) continue;
      sdk.log.info("demo adding", { progress: { item_id: line.item_id, state: "adding" } });
      await sleep(360);
      const o = demo.outcome;

      if (o.kind === "checkpoint") {
        const resolution = await sdk.checkpoint({ item_id: line.item_id, message: o.message, options: o.options });
        if (resolution.action === "abort") return observations; // Drive.stop marks the drive cancelled.
        if (resolution.action === "skip") {
          unavailable(line.item_id, "You skipped this item — left for you to decide");
        } else if (resolution.action === "select") {
          const picked = o.options.find((p) => p.productId === resolution.productId) ?? o.options[0];
          carted(line.item_id, picked);
        } else {
          // substitute — a specific product the human supplied.
          substituted(line.item_id, resolution.product, "You chose a substitute");
        }
        await sleep(220);
        continue;
      }

      if (o.kind === "carted") carted(line.item_id, o.product);
      else if (o.kind === "substituted") substituted(line.item_id, o.product, o.note);
      else unavailable(line.item_id, o.note);
      await sleep(260);
    }
    return observations;
  },
});
