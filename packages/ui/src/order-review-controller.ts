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
  search(mode: "broader" | "manual", lineKey: string, fingerprint: string, stage: OrderReviewStage, query?: string): Promise<CatalogSearchResult>;
  saveBrand(input: { family_key: string; line_key: string; brand: string; expected_family_fingerprint: string; preview_fingerprint: string }): Promise<BrandSaveReceipt>;
  send(input: { stage: OrderReviewStage; preview_fingerprint: string; cleared_cart_ack: boolean }): Promise<OrderReviewSendResult>;
  publishModelContext?(context: OrderReviewModelContext): Promise<void> | void;
  notifyCompletion?(outcome: OrderReviewOutcome): Promise<void> | void;
  delegate?(action: string): Promise<void> | void;
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
  return { preview, stage: emptyOrderReviewStage(), save_receipts: [], searches: {}, outcome: null, pending: null, error: null, cleared_cart_ack: false };
}

export function orderReviewEstimatedTotal(state: OrderReviewControllerState): number | null {
  const skipped = new Set(state.stage.skipped);
  const lines = state.preview.matched.filter((line) => !skipped.has(line.line_key));
  if (!lines.length) return null;
  return Math.round(lines.reduce((sum, line) => {
    const quantity = state.stage.quantities[line.line_key] ?? line.quantity;
    const price = line.selected.on_sale ? line.selected.price.promo : line.selected.price.regular;
    return sum + quantity * price;
  }, 0) * 100) / 100;
}

export function stageOrderReview(
  state: OrderReviewControllerState,
  action:
    | { kind: "skip" | "add_back"; line_key: string }
    | { kind: "quantity"; line_key: string; quantity: number }
    | { kind: "select"; line_key: string; sku: string; source: "same_identity" | "broader" | "manual" | "impulse"; divergence?: OrderReviewStage["selections"][number]["divergence"] }
    | { kind: "impulse"; key: string; label: string; sku?: string }
    | { kind: "undo_selection"; line_key: string }
    | { kind: "clearance"; checked: boolean },
): OrderReviewControllerState {
  if (action.kind === "clearance") return { ...state, cleared_cart_ack: action.checked };
  let stage = state.stage;
  if (action.kind === "skip") stage = { ...stage, skipped: [...new Set([...stage.skipped, action.line_key])] };
  if (action.kind === "add_back") stage = { ...stage, skipped: stage.skipped.filter((key) => key !== action.line_key) };
  if (action.kind === "quantity") stage = { ...stage, quantities: { ...stage.quantities, [action.line_key]: Math.max(1, Math.min(99, Math.round(action.quantity))) } };
  if (action.kind === "select") stage = { ...stage, selections: [...stage.selections.filter((selection) => selection.line_key !== action.line_key), { line_key: action.line_key, sku: action.sku, source: action.source, ...(action.divergence ? { divergence: action.divergence } : {}) }] };
  if (action.kind === "undo_selection") stage = { ...stage, selections: stage.selections.filter((selection) => selection.line_key !== action.line_key) };
  if (action.kind === "impulse") stage = { ...stage, impulses: [...stage.impulses.filter((impulse) => impulse.key !== action.key), { key: action.key, label: action.label, ...(action.sku ? { sku: action.sku } : {}) }] };
  return { ...state, stage, outcome: null, error: null };
}

async function publish(state: OrderReviewControllerState, adapter: OrderReviewHostAdapter, action: string) {
  await adapter.publishModelContext?.({ preview: state.preview, stage: state.stage, save_receipts: state.save_receipts, ...(state.outcome ? { outcome: state.outcome } : {}), action_summary: action });
}

export async function refreshOrderReview(state: OrderReviewControllerState, adapter: OrderReviewHostAdapter): Promise<OrderReviewControllerState> {
  if (adapter.mode !== "interactive" || adapter.online === false || state.pending) return state;
  try {
    const preview = await adapter.preview(state.stage);
    const next = { ...state, preview, stage: preview.stage, pending: null, error: null };
    await publish(next, adapter, "Review refreshed with current store facts.");
    return next;
  } catch (error) { return { ...state, pending: null, error: error instanceof Error ? error.message : String(error) }; }
}

export async function searchOrderReview(state: OrderReviewControllerState, adapter: OrderReviewHostAdapter, mode: "broader" | "manual", lineKey: string, query?: string): Promise<OrderReviewControllerState> {
  if (adapter.mode !== "interactive" || adapter.online === false || state.pending) return state;
  try {
    const result = await adapter.search(mode, lineKey, state.preview.preview_fingerprint, state.stage, query);
    const next = { ...state, searches: { ...state.searches, [lineKey]: result }, pending: null, error: null };
    await publish(next, adapter, `${mode === "broader" ? "Broader" : "Manual"} search returned ${result.candidates.length} candidates.`);
    return next;
  } catch (error) { return { ...state, pending: null, error: error instanceof Error ? error.message : String(error) }; }
}

export async function saveOrderReviewBrand(state: OrderReviewControllerState, adapter: OrderReviewHostAdapter, lineKey: string, brand: string): Promise<OrderReviewControllerState> {
  const line = [...state.preview.matched, ...state.preview.decisions].find((candidate) => candidate.line_key === lineKey);
  if (!line || adapter.mode !== "interactive" || adapter.online === false || state.pending) return state;
  try {
    const receipt = await adapter.saveBrand({ family_key: line.family_key, line_key: line.line_key, brand, expected_family_fingerprint: line.family_fingerprint, preview_fingerprint: state.preview.preview_fingerprint });
    const receipts = [...state.save_receipts.filter((item) => item.family_key !== receipt.family_key), receipt];
    if (receipt.status === "conflict") {
      const next = { ...state, save_receipts: receipts, pending: null, error: "Brand preferences changed elsewhere. Review the current family and try again." };
      await publish(next, adapter, "Brand save conflicted with a newer family edit."); return next;
    }
    const marker = { family_key: receipt.family_key, brand: receipt.brand };
    const next = { ...state, save_receipts: receipts, stage: { ...state.stage, saved_brands: [...state.stage.saved_brands.filter((item) => item.family_key !== marker.family_key), marker] }, pending: null, error: null };
    await publish(next, adapter, `Saved ${brand} in the preferred brand family.`); return next;
  } catch (error) { return { ...state, pending: null, error: error instanceof Error ? error.message : String(error) }; }
}

export async function sendOrderReviewState(state: OrderReviewControllerState, adapter: OrderReviewHostAdapter): Promise<OrderReviewControllerState> {
  if (state.pending || state.outcome?.status === "sent") return state;
  if (adapter.mode === "delegate") { await adapter.delegate?.(`Send this staged order with fingerprint ${state.preview.preview_fingerprint}`); return state; }
  if (adapter.mode !== "interactive" || adapter.online === false) return { ...state, error: "Order sending is available online only." };
  try {
    // The stage is disposable client state, so obtain its authoritative fingerprint immediately
    // before send. If non-stage facts moved, adopt the refresh and require another explicit press.
    const refreshed = await adapter.preview(state.stage);
    const facts = (preview: OrderReviewData) => JSON.stringify({
      grocery: preview.grocery_snapshot_version, store: preview.store,
      matched: preview.matched.map((line) => ({ key: line.line_key, selected: line.selected, options: line.options, family: line.family_fingerprint })),
      decisions: preview.decisions.map((line) => ({ key: line.line_key, kind: line.kind, candidates: line.candidates, family: line.family_fingerprint })),
      underived: preview.underived,
    });
    if (facts(refreshed) !== facts(state.preview)) {
      const next = { ...state, preview: refreshed, stage: refreshed.stage, pending: null, error: "The review changed. Check the refreshed facts and send again." };
      await publish(next, adapter, next.error); return next;
    }
    const outcome = await adapter.send({ stage: state.stage, preview_fingerprint: refreshed.preview_fingerprint, cleared_cart_ack: state.cleared_cart_ack });
    if (outcome.status === "review_changed" || outcome.status === "cart_clearance_required") {
      const next = { ...state, preview: outcome.preview, stage: outcome.preview.stage, outcome, pending: null, error: outcome.status === "review_changed" ? "The review changed. Check the refreshed facts and send again." : "Clear and acknowledge the old Kroger cart first." };
      await publish(next, adapter, next.error); return next;
    }
    const next = { ...state, outcome, pending: null, error: outcome.status === "sent" ? null : "Kroger did not accept the cart. Nothing is confirmed." };
    await publish(next, adapter, outcome.status === "sent" ? "Order sent to Kroger." : "Order send failed.");
    if (outcome.status === "sent") await adapter.notifyCompletion?.({ send: outcome, save_receipts: next.save_receipts });
    return next;
  } catch (error) { return { ...state, pending: null, error: error instanceof Error ? error.message : String(error) }; }
}

export async function closeOrderReview(state: OrderReviewControllerState, adapter: OrderReviewHostAdapter): Promise<OrderReviewControllerState> {
  await adapter.closeToGrocery();
  return createOrderReviewController(state.preview);
}
