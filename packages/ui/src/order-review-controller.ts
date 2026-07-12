import {
  emptyOrderReviewStage,
  type BrandSaveReceipt,
  type CatalogSearchResult,
  type OrderReviewData,
  type OrderReviewModelContext,
  type OrderReviewOutcome,
  type OrderReviewSendResult,
  type OrderReviewStage,
} from "@yamp/contract";

export interface OrderReviewHostAdapter {
  mode: "interactive" | "delegate" | "readonly";
  online?: boolean;
  preview(stage: OrderReviewStage): Promise<OrderReviewData>;
  search(
    mode: "broader" | "manual",
    lineKey: string,
    fingerprint: string,
    stage: OrderReviewStage,
    query?: string,
  ): Promise<CatalogSearchResult>;
  saveBrand(input: {
    family_key: string;
    line_key: string;
    brand: string;
    expected_family_fingerprint: string;
    preview_fingerprint: string;
    stage: OrderReviewStage;
  }): Promise<BrandSaveReceipt>;
  send(input: {
    stage: OrderReviewStage;
    preview_fingerprint: string;
    cleared_cart_ack: boolean;
  }): Promise<OrderReviewSendResult>;
  publishModelContext?(context: OrderReviewModelContext): Promise<void> | void;
  notifyCompletion?(outcome: OrderReviewOutcome & { carted_names: string[] }): Promise<void> | void;
  delegate?(action: {
    kind: "send";
    stage: OrderReviewStage;
    cleared_cart_ack: boolean;
  }): Promise<void> | void;
  reauthorize?(): Promise<void> | void;
  closeToGrocery(): Promise<void> | void;
}

export type OrderReviewPending = null | "preview" | "search" | "save" | "send";
export interface OrderReviewControllerState {
  preview: OrderReviewData;
  stage: OrderReviewStage;
  save_receipts: BrandSaveReceipt[];
  searches: Record<string, CatalogSearchResult>;
  outcome: OrderReviewSendResult | null;
  pending: OrderReviewPending;
  error: string | null;
  cleared_cart_ack: boolean;
}

export function createOrderReviewController(preview: OrderReviewData): OrderReviewControllerState {
  return {
    preview,
    stage: emptyOrderReviewStage(),
    save_receipts: [],
    searches: {},
    outcome: null,
    pending: null,
    error: null,
    cleared_cart_ack: false,
  };
}

export function orderReviewEstimatedTotal(state: OrderReviewControllerState): number | null {
  return orderReviewProjection(state).estimated_total;
}

export interface OrderReviewProjection {
  going_to_cart: number;
  needs_decision: number;
  left_off: number;
  estimated_total: number | null;
  can_send: boolean;
  left_off_lines: {
    line_key: string;
    name: string;
    reason: "skipped" | "undecided" | "unavailable" | "revalidation_failed" | "underived";
  }[];
}

/** Presentation-only projection of the complete local draft. The Worker remains authoritative. */
export function orderReviewProjection(state: OrderReviewControllerState): OrderReviewProjection {
  const skipped = new Set(state.stage.skipped);
  const selections = new Map(state.stage.selections.map((selection) => [selection.line_key, selection]));
  const searchProducts = new Map(
    Object.values(state.searches)
      .flatMap((search) => search.candidates)
      .map((product) => [product.sku, product]),
  );
  let going = 0;
  let unresolved = 0;
  let total = 0;
  let priced = 0;
  const left = [...state.preview.left_off];

  for (const line of state.preview.matched) {
    if (skipped.has(line.line_key)) {
      left.push({ line_key: line.line_key, name: line.display_name ?? line.name, reason: "skipped" });
      continue;
    }
    going += 1;
    const selection = selections.get(line.line_key);
    const product = selection
      ? ([line.selected, line.featured_swap, ...line.options].find(
          (candidate) => candidate?.sku === selection.sku,
        ) ?? searchProducts.get(selection.sku))
      : line.selected;
    if (product) {
      const quantity = state.stage.quantities[line.line_key] ?? line.quantity;
      total += quantity * (product.on_sale ? product.price.promo : product.price.regular);
      priced += 1;
    }
  }
  for (const line of state.preview.decisions) {
    if (skipped.has(line.line_key)) {
      left.push({ line_key: line.line_key, name: line.display_name ?? line.name, reason: "skipped" });
    } else if (selections.has(line.line_key)) {
      going += 1;
      const selection = selections.get(line.line_key)!;
      const product =
        line.candidates.find((candidate) => candidate.sku === selection.sku) ??
        searchProducts.get(selection.sku);
      if (product) {
        const quantity = state.stage.quantities[line.line_key] ?? line.quantity;
        total += quantity * (product.on_sale ? product.price.promo : product.price.regular);
        priced += 1;
      }
    } else {
      unresolved += 1;
      left.push({
        line_key: line.line_key,
        name: line.display_name ?? line.name,
        reason: line.kind === "unavailable" ? "unavailable" : "undecided",
      });
    }
  }
  for (const impulse of state.stage.impulses) {
    if (!impulse.sku || skipped.has(impulse.key)) {
      left.push({
        line_key: impulse.key,
        name: impulse.label,
        reason: impulse.sku ? "skipped" : "undecided",
      });
      continue;
    }
    going += 1;
    const product = searchProducts.get(impulse.sku);
    if (product) {
      total += product.on_sale ? product.price.promo : product.price.regular;
      priced += 1;
    }
  }
  for (const recipe of state.preview.underived)
    left.push({ line_key: `underived:${recipe}`, name: recipe, reason: "underived" });
  const uniqueLeft = [...new Map(left.map((line) => [`${line.line_key}:${line.reason}`, line])).values()];
  return {
    going_to_cart: going,
    needs_decision: unresolved,
    left_off: uniqueLeft.length,
    estimated_total: going > 0 && priced === going ? Math.round(total * 100) / 100 : null,
    can_send: going > 0,
    left_off_lines: uniqueLeft,
  };
}

export function stageOrderReview(
  state: OrderReviewControllerState,
  action:
    | { kind: "skip" | "add_back"; line_key: string }
    | { kind: "quantity"; line_key: string; quantity: number }
    | {
        kind: "select";
        line_key: string;
        sku: string;
        source: "same_identity" | "broader" | "manual" | "impulse";
        divergence?: OrderReviewStage["selections"][number]["divergence"];
      }
    | { kind: "impulse"; key: string; label: string; sku?: string }
    | { kind: "undo_selection"; line_key: string }
    | { kind: "clearance"; checked: boolean },
): OrderReviewControllerState {
  if (action.kind === "clearance") return { ...state, cleared_cart_ack: action.checked };
  let stage = state.stage;
  if (action.kind === "skip")
    stage = { ...stage, skipped: [...new Set([...stage.skipped, action.line_key])] };
  if (action.kind === "add_back")
    stage = { ...stage, skipped: stage.skipped.filter((key) => key !== action.line_key) };
  if (action.kind === "quantity")
    stage = {
      ...stage,
      quantities: {
        ...stage.quantities,
        [action.line_key]: Math.max(1, Math.min(99, Math.round(action.quantity))),
      },
    };
  if (action.kind === "select")
    stage = {
      ...stage,
      selections: [
        ...stage.selections.filter((selection) => selection.line_key !== action.line_key),
        {
          line_key: action.line_key,
          sku: action.sku,
          source: action.source,
          ...(action.divergence ? { divergence: action.divergence } : {}),
        },
      ],
    };
  if (action.kind === "undo_selection")
    stage = {
      ...stage,
      selections: stage.selections.filter((selection) => selection.line_key !== action.line_key),
    };
  if (action.kind === "impulse")
    stage = {
      ...stage,
      impulses: [
        ...stage.impulses.filter((impulse) => impulse.key !== action.key),
        { key: action.key, label: action.label, ...(action.sku ? { sku: action.sku } : {}) },
      ],
    };
  return { ...state, stage, outcome: null, error: null };
}

async function publish(state: OrderReviewControllerState, adapter: OrderReviewHostAdapter, action: string) {
  await adapter.publishModelContext?.({
    preview: state.preview,
    stage: state.stage,
    save_receipts: state.save_receipts,
    ...(state.outcome ? { outcome: state.outcome } : {}),
    action_summary: action,
  });
}

export async function refreshOrderReview(
  state: OrderReviewControllerState,
  adapter: OrderReviewHostAdapter,
): Promise<OrderReviewControllerState> {
  if (adapter.mode !== "interactive" || adapter.online === false || state.pending) return state;
  try {
    const preview = await adapter.preview(state.stage);
    const next = { ...state, preview, stage: preview.stage, pending: null, error: null };
    await publish(next, adapter, "Review refreshed with current store facts.");
    return next;
  } catch (error) {
    return { ...state, pending: null, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function searchOrderReview(
  state: OrderReviewControllerState,
  adapter: OrderReviewHostAdapter,
  mode: "broader" | "manual",
  lineKey: string,
  query?: string,
): Promise<OrderReviewControllerState> {
  if (adapter.mode !== "interactive" || adapter.online === false || state.pending) return state;
  try {
    const result = await adapter.search(mode, lineKey, state.preview.preview_fingerprint, state.stage, query);
    const next = { ...state, searches: { ...state.searches, [lineKey]: result }, pending: null, error: null };
    await publish(
      next,
      adapter,
      `${mode === "broader" ? "Broader" : "Manual"} search returned ${result.candidates.length} candidates.`,
    );
    return next;
  } catch (error) {
    return { ...state, pending: null, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function saveOrderReviewBrand(
  state: OrderReviewControllerState,
  adapter: OrderReviewHostAdapter,
  lineKey: string,
  brand: string,
): Promise<OrderReviewControllerState> {
  const line = [...state.preview.matched, ...state.preview.decisions].find(
    (candidate) => candidate.line_key === lineKey,
  );
  if (!line || adapter.mode !== "interactive" || adapter.online === false || state.pending) return state;
  try {
    const receipt = await adapter.saveBrand({
      family_key: line.family_key,
      line_key: line.line_key,
      brand,
      expected_family_fingerprint: line.family_fingerprint,
      preview_fingerprint: state.preview.preview_fingerprint,
      stage: state.stage,
    });
    const receipts = [
      ...state.save_receipts.filter((item) => item.family_key !== receipt.family_key),
      receipt,
    ];
    if (receipt.status === "conflict") {
      const next = {
        ...state,
        save_receipts: receipts,
        pending: null,
        error: "Brand preferences changed elsewhere. Review the current family and try again.",
      };
      await publish(next, adapter, "Brand save conflicted with a newer family edit.");
      return next;
    }
    const marker = { family_key: receipt.family_key, brand: receipt.brand };
    const next = {
      ...state,
      save_receipts: receipts,
      stage: {
        ...state.stage,
        saved_brands: [
          ...state.stage.saved_brands.filter((item) => item.family_key !== marker.family_key),
          marker,
        ],
      },
      pending: null,
      error: null,
    };
    await publish(next, adapter, `Saved ${brand} in the preferred brand family.`);
    return next;
  } catch (error) {
    return { ...state, pending: null, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function sendOrderReviewState(
  state: OrderReviewControllerState,
  adapter: OrderReviewHostAdapter,
): Promise<OrderReviewControllerState> {
  if (state.pending || state.outcome?.status === "sent") return state;
  if (adapter.mode === "delegate") {
    await adapter.delegate?.({ kind: "send", stage: state.stage, cleared_cart_ack: state.cleared_cart_ack });
    return state;
  }
  if (adapter.mode !== "interactive" || adapter.online === false)
    return { ...state, error: "Order sending is available online only." };
  try {
    // The stage is disposable client state, so obtain its authoritative fingerprint immediately
    // before send. If non-stage facts moved, adopt the refresh and require another explicit press.
    const refreshed = await adapter.preview(state.stage);
    const facts = (preview: OrderReviewData) =>
      JSON.stringify({
        grocery: preview.grocery_snapshot_version,
        store: preview.store,
        matched: preview.matched.map((line) => ({
          key: line.line_key,
          selected: line.selected,
          options: line.options,
          family: line.family_fingerprint,
        })),
        decisions: preview.decisions.map((line) => ({
          key: line.line_key,
          kind: line.kind,
          candidates: line.candidates,
          family: line.family_fingerprint,
        })),
        underived: preview.underived,
      });
    if (facts(refreshed) !== facts(state.preview)) {
      const next = {
        ...state,
        preview: refreshed,
        stage: refreshed.stage,
        pending: null,
        error: "The review changed. Check the refreshed facts and send again.",
      };
      await publish(next, adapter, next.error);
      return next;
    }
    const outcome = await adapter.send({
      stage: state.stage,
      preview_fingerprint: refreshed.preview_fingerprint,
      cleared_cart_ack: state.cleared_cart_ack,
    });
    if (outcome.status === "review_changed" || outcome.status === "cart_clearance_required") {
      const next = {
        ...state,
        preview: outcome.preview,
        stage: outcome.preview.stage,
        outcome,
        pending: null,
        error:
          outcome.status === "review_changed"
            ? "The review changed. Check the refreshed facts and send again."
            : "Clear and acknowledge the old Kroger cart first.",
      };
      await publish(next, adapter, next.error);
      return next;
    }
    const next = {
      ...state,
      outcome,
      pending: null,
      error: outcome.status === "sent" ? null : "Kroger did not accept the cart. Nothing is confirmed.",
    };
    await publish(next, adapter, outcome.status === "sent" ? "Order sent to Kroger." : "Order send failed.");
    if (outcome.status === "sent") {
      const skipped = new Set(state.stage.skipped);
      const selected = new Set(state.stage.selections.map((selection) => selection.line_key));
      const carted_names = [
        ...state.preview.matched
          .filter((line) => !skipped.has(line.line_key))
          .map((line) => line.display_name ?? line.name),
        ...state.preview.decisions
          .filter((line) => !skipped.has(line.line_key) && selected.has(line.line_key))
          .map((line) => line.display_name ?? line.name),
        ...state.stage.impulses
          .filter((line) => line.sku && !skipped.has(line.key))
          .map((line) => line.label),
      ];
      await adapter.notifyCompletion?.({ send: outcome, save_receipts: next.save_receipts, carted_names });
    }
    return next;
  } catch (error) {
    return { ...state, pending: null, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function closeOrderReview(
  state: OrderReviewControllerState,
  adapter: OrderReviewHostAdapter,
): Promise<OrderReviewControllerState> {
  await adapter.closeToGrocery();
  return state;
}
