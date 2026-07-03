// The cart-fill DRIVE orchestration (satellite-order-cart-fill) — the crux of the local helper.
// A `Drive` runs ONE fill: it builds the `OrderSdk` (the store's config + session, a live Playwright
// page, a progress-aware logger, and the human `checkpoint` hand-off), runs the operator-authored
// `adapter.fill(sdk, lines)`, and turns the adapter's activity into a stream of `DriveEvent`s the
// helper server relays to the UI (SSE) and folds into a poll-able snapshot.
//
// Two hand-offs make the drive interactive without any model (Decision 9 — the human is the ONLY
// resolver):
//   * checkpoint — `sdk.checkpoint(prompt)` emits a `checkpoint` event and BLOCKS on a Promise the
//     server resolves when `POST /api/checkpoint/resolve` arrives for that id (the human decides).
//   * progress   — an adapter reports live per-item transitions by logging with a
//     `{ progress: { item_id, state, product?, note? } }` extra; the drive surfaces those as `item`
//     events. It is OPTIONAL — a silent adapter still yields correct TERMINAL item states from the
//     `OrderObservation[]` it returns.
//
// The adapter fills the cart and stops at the store's review page — it NEVER checks out (Decision 6);
// `review-ready` is the terminal success event, and the human completes the purchase in the store's
// own UI. Every returned emit is re-validated with `validateOrderEmit` (the sensor-not-judge gate)
// before it is collected for the receipt, so a non-contract or smuggled-derived-state emit is dropped.

import { validateOrderEmit, type OrderAdapterFactory, type OrderSdk, type CheckpointPrompt, type CheckpointResolution } from "../order-adapter.js";
import type { OrderLine, OrderObservation } from "@grocery-agent/contract";
import type { OrderStoreConfig, SatelliteConfig } from "../config.js";
import type { StorageState } from "../session.js";
import type { Logger } from "../adapter.js";
// Playwright TYPES only (erased at compile time) — the live page is injected by the caller (the CLI
// launches headful Chromium), never launched here, so the drive stays unit-testable with a fake page.
import type { Page } from "playwright";

/** The raw store product provenance an `order` observation / checkpoint candidate carries. */
export interface OrderProduct {
  productId: string;
  description: string;
  size?: string;
  price?: number;
  url?: string;
}

/** Per-item lifecycle the UI animates: pending → adding → one terminal disposition. */
export type ItemState = "pending" | "adding" | "carted" | "substituted" | "unavailable";
const PROGRESS_STATES = new Set<ItemState>(["pending", "adding", "carted", "substituted", "unavailable"]);

/**
 * One event the drive emits — buffered for SSE replay AND folded into the poll-able snapshot. A
 * discriminated union so the server's relay handles every kind exhaustively:
 *   item          a per-item transition (with the matched product, once carted/substituted)
 *   checkpoint    an ambiguity awaiting the human's resolution (blocks the adapter)
 *   review-ready  TERMINAL success — the cart is filled and the adapter stopped at review
 *   cancelled     TERMINAL — the human stopped the fill (the page is closed; a fresh fill is allowed)
 *   error         TERMINAL failure — the adapter errored / threw / the browser failed to launch
 */
export type DriveEvent =
  | { type: "item"; item_id: string; state: ItemState; product?: OrderProduct; note?: string }
  | { type: "checkpoint"; checkpoint_id: string; item_id: string; message: string; options: OrderProduct[] }
  | { type: "review-ready"; count: number }
  | { type: "cancelled" }
  | { type: "error"; code: string; message: string };

/**
 * The human's checkpoint resolution as the UI posts it (`POST /api/checkpoint/resolve`), mapped to the
 * SDK's `CheckpointResolution` by `toCheckpointResolution`. The vocabulary is exactly what the SDK can
 * consume — pick one of the presented candidates, substitute a specific product, skip the line, or
 * abort the whole fill. (There is no free-text "search" resolution: the fixed SDK carries no such
 * action, so a "search again" affordance would need an adapter that re-checkpoints with fresh options.)
 */
export type ApiResolution =
  | { pick: { productId: string } }
  | { substitute: OrderProduct }
  | { skip: true }
  | { abort: true };

/** Map an `ApiResolution` from the wire to the SDK's `CheckpointResolution`, or null when malformed. */
export function toCheckpointResolution(r: unknown): CheckpointResolution | null {
  if (r === null || typeof r !== "object") return null;
  const o = r as Record<string, unknown>;
  if (o.pick && typeof o.pick === "object" && typeof (o.pick as Record<string, unknown>).productId === "string") {
    return { action: "select", productId: (o.pick as { productId: string }).productId };
  }
  if (o.substitute && typeof o.substitute === "object" && typeof (o.substitute as Record<string, unknown>).productId === "string") {
    const p = o.substitute as OrderProduct;
    return { action: "substitute", product: { productId: p.productId, description: p.description, size: p.size, price: p.price, url: p.url } };
  }
  if (o.skip === true) return { action: "skip" };
  if (o.abort === true) return { action: "abort" };
  return null;
}

/** A live Playwright page plus its disposer — the caller opens (and, on completion, closes) the browser. */
export interface PageHandle {
  page: Page;
  close: () => Promise<void>;
}

/** Everything one fill needs, injected so tests use a fake adapter + fake page + no real browser. */
export interface DriveDeps {
  store: OrderStoreConfig;
  config: SatelliteConfig;
  session: StorageState | null;
  /** The operator adapter factory (built with the drive's SDK); undefined is guarded before a drive starts. */
  adapterFactory: OrderAdapterFactory;
  /** Open a live page bound to the store session (real: headful Chromium; test: a fake). */
  openPage: () => Promise<PageHandle>;
  log: Logger;
}

/**
 * A single cart-fill. The server creates one per `POST /api/fill`, kicks `run` off fire-and-forget,
 * and relays its events (SSE) / snapshot (`GET /api/fill/status`). `resolveCheckpoint` is how the
 * server hands the human's decision back to the blocked adapter.
 */
export class Drive {
  readonly id: string;
  phase: "running" | "review-ready" | "cancelled" | "error" = "running";
  error: { code: string; message: string } | null = null;
  /** The last-known per-item state (the snapshot the status route serves + the UI reconciles against). */
  readonly items = new Map<string, { state: ItemState; product?: OrderProduct; note?: string }>();
  /** The one checkpoint currently awaiting the human, or null. */
  pendingCheckpoint: { checkpoint_id: string; item_id: string; message: string; options: OrderProduct[] } | null = null;
  /** The validated observations collected from the completed fill — the receipt is assembled from these. */
  readonly observations: OrderObservation[] = [];

  private readonly events: DriveEvent[] = [];
  private readonly subscribers = new Set<(e: DriveEvent) => void>();
  private readonly resolvers = new Map<string, (r: CheckpointResolution) => void>();
  private cpSeq = 0;
  /** The live page handle — held OPEN past `fill()` on success (the human checks out in it), else closed. */
  private handle: PageHandle | null = null;
  /** Set by `stop()` so a late `fill()` return doesn't override the cancelled terminal state. */
  private cancelled = false;

  constructor(id: string) {
    this.id = id;
  }

  /** Subscribe to future events (the SSE relay); returns an unsubscribe. */
  subscribe(fn: (e: DriveEvent) => void): () => void {
    this.subscribers.add(fn);
    return () => {
      this.subscribers.delete(fn);
    };
  }

  /** The events emitted so far — replayed to a late SSE subscriber so it catches up. */
  buffered(): DriveEvent[] {
    return [...this.events];
  }

  private emit(e: DriveEvent): void {
    this.events.push(e);
    if (e.type === "item") {
      this.items.set(e.item_id, { state: e.state, product: e.product, note: e.note });
    } else if (e.type === "checkpoint") {
      this.pendingCheckpoint = { checkpoint_id: e.checkpoint_id, item_id: e.item_id, message: e.message, options: e.options };
    } else if (e.type === "review-ready") {
      this.phase = "review-ready";
      this.pendingCheckpoint = null;
    } else if (e.type === "cancelled") {
      this.phase = "cancelled";
      this.pendingCheckpoint = null;
    } else if (e.type === "error") {
      this.phase = "error";
      this.error = { code: e.code, message: e.message };
      this.pendingCheckpoint = null;
    }
    for (const fn of this.subscribers) {
      try {
        fn(e);
      } catch {
        // A subscriber (a dropped SSE socket) must never break the drive.
      }
    }
  }

  /** Hand the human's decision to a blocked adapter. Returns false when the id is unknown/already resolved. */
  resolveCheckpoint(checkpointId: string, resolution: CheckpointResolution): boolean {
    const resolver = this.resolvers.get(checkpointId);
    if (!resolver) return false;
    this.resolvers.delete(checkpointId);
    if (this.pendingCheckpoint?.checkpoint_id === checkpointId) this.pendingCheckpoint = null;
    resolver(resolution);
    return true;
  }

  /** Emit a checkpoint and return a Promise the server resolves via `resolveCheckpoint` (the human). */
  private raiseCheckpoint(prompt: CheckpointPrompt): Promise<CheckpointResolution> {
    const checkpoint_id = `cp_${++this.cpSeq}`;
    return new Promise<CheckpointResolution>((resolve) => {
      this.resolvers.set(checkpoint_id, resolve);
      this.emit({ type: "checkpoint", checkpoint_id, item_id: prompt.item_id, message: prompt.message, options: prompt.options ?? [] });
    });
  }

  /** The SDK logger: a passthrough that ALSO surfaces a `{ progress }` extra as an `item` event. */
  private progressLog(base: Logger): Logger {
    const forward = (extra?: Record<string, unknown>): void => {
      const p = extra?.progress as { item_id?: unknown; state?: unknown; product?: OrderProduct; note?: string } | undefined;
      if (p && typeof p.item_id === "string" && typeof p.state === "string" && PROGRESS_STATES.has(p.state as ItemState)) {
        this.emit({ type: "item", item_id: p.item_id, state: p.state as ItemState, product: p.product, note: p.note });
      }
    };
    return {
      info: (msg, extra) => {
        base.info(msg, extra);
        forward(extra);
      },
      warn: (msg, extra) => {
        base.warn(msg, extra);
        forward(extra);
      },
      error: (msg, extra) => base.error(msg, extra),
    };
  }

  /**
   * Close the held page (idempotent). Called on a fill FAILURE, an explicit `stop`, a superseding
   * fill/refresh, or server shutdown — NEVER on the success (review-ready) path, where the human keeps
   * driving the same headful window to checkout.
   */
  async closePage(): Promise<void> {
    const h = this.handle;
    this.handle = null;
    if (!h) return;
    try {
      await h.close();
    } catch {
      // A close failure is non-fatal — the fill outcome already stands.
    }
  }

  /**
   * Cancel the drive (the UI's Stop control): unblock any pending checkpoint with an abort so a blocked
   * adapter returns, close the page, and mark the drive terminal (`cancelled`). Idempotent — on an
   * already-terminal drive it just ensures the page is closed. Prevents an orphaned headful browser and
   * lets a fresh `/api/fill` start afterward.
   */
  async stop(): Promise<void> {
    if (this.phase !== "running") {
      await this.closePage();
      return;
    }
    this.cancelled = true;
    for (const resolve of this.resolvers.values()) resolve({ action: "abort" });
    this.resolvers.clear();
    await this.closePage();
    this.emit({ type: "cancelled" });
  }

  /**
   * Run the fill: seed pending items, open the page, build the SDK, run the adapter, then validate and
   * collect its emitted observations and finish `review-ready` (or `error`/`cancelled`). Never throws —
   * an adapter throw / structured error / browser-launch failure becomes a terminal `error` event.
   *
   * On the review-ready path the page is left OPEN: `fill()` returns exactly when the adapter has driven
   * to the store's review page and stopped, so the authenticated headful window MUST survive for the
   * human to complete checkout (Decision 6/7). The page is closed only on a fill failure here, or later
   * by `stop()` / a superseding fill / server shutdown.
   */
  async run(deps: DriveDeps, lines: OrderLine[]): Promise<void> {
    // Stopped before we even started (a concurrent stop/refresh in the fire-and-forget window) — don't
    // open a browser for a drive that's already been superseded.
    if (this.cancelled) return;
    for (const line of lines) this.emit({ type: "item", item_id: line.item_id, state: "pending" });

    let handle: PageHandle;
    try {
      handle = await deps.openPage();
    } catch (err) {
      this.emit({ type: "error", code: "browser_launch_failed", message: (err as Error).message });
      return;
    }
    this.handle = handle;
    // Stopped while the page was opening — close it now rather than driving a cancelled fill (stop()
    // ran when this.handle was still null, so it could not close this page itself).
    if (this.cancelled) {
      await this.closePage();
      return;
    }

    const sdk: OrderSdk = {
      store: deps.store,
      config: deps.config,
      session: deps.session,
      page: handle.page,
      log: this.progressLog(deps.log),
      checkpoint: (prompt) => this.raiseCheckpoint(prompt),
    };

    let result: OrderObservation[] | { error: string } | null = null;
    let threw: Error | null = null;
    try {
      const adapter = deps.adapterFactory(sdk);
      result = await adapter.fill(sdk, lines);
    } catch (err) {
      threw = err as Error;
    }

    // A `stop()` during the fill already aborted the pending checkpoint, closed the page, and marked the
    // drive `cancelled` — don't override that terminal state with a late review-ready / error.
    if (this.cancelled) return;

    if (threw) {
      // The fill did NOT reach review — close the page (there is no checkout hand-off to preserve).
      this.emit({ type: "error", code: "fill_threw", message: threw.message });
      await this.closePage();
      return;
    }
    if (result && typeof result === "object" && "error" in result) {
      this.emit({ type: "error", code: "adapter_error", message: result.error });
      await this.closePage();
      return;
    }

    for (const raw of result as OrderObservation[]) {
      const v = validateOrderEmit(raw);
      if (!v.ok) {
        // A non-contract / smuggled-derived-state emit is dropped from the receipt and surfaced.
        deps.log.warn("order emit rejected — not added to the receipt", { reason: v.error });
        continue;
      }
      const obs = v.value;
      this.observations.push(obs);
      this.emit({ type: "item", item_id: obs.item_id, state: obs.disposition, product: obs.product, note: obs.note });
    }
    // Success — leave the page OPEN for the human to complete checkout.
    this.emit({ type: "review-ready", count: this.observations.length });
  }
}
