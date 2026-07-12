import * as React from "react";
import type { OrderReviewProduct } from "@yamp/contract";
import { Button } from "./button";
import { Input } from "./input";
import {
  closeOrderReview, createOrderReviewController, orderReviewEstimatedTotal,
  saveOrderReviewBrand, searchOrderReview, sendOrderReviewState, stageOrderReview,
  type OrderReviewHostAdapter,
} from "../order-review-controller";
import type { OrderReviewData } from "@yamp/contract";

export interface OrderReviewProps { data: OrderReviewData; adapter: OrderReviewHostAdapter; onDataChange?(data: OrderReviewData): void }

const money = (value: number | null | undefined) => value == null ? "Unavailable" : `$${value.toFixed(2)}`;
const productLabel = (product: OrderReviewProduct) => `${product.brand ? `${product.brand} ` : ""}${product.description}${product.size ? ` · ${product.size}` : ""}`;

export function OrderReview({ data, adapter, onDataChange }: OrderReviewProps) {
  const [state, setState] = React.useState(() => createOrderReviewController(data));
  const [manual, setManual] = React.useState<Record<string, string>>({});
  React.useEffect(() => setState(createOrderReviewController(data)), [data.preview_fingerprint]);
  const update = (next: typeof state) => { setState(next); if (next.preview !== state.preview) onDataChange?.(next.preview); };
  const stage = (action: Parameters<typeof stageOrderReview>[1]) => {
    const next = stageOrderReview(state, action); setState(next);
    void adapter.publishModelContext?.({ preview: next.preview, stage: next.stage, save_receipts: next.save_receipts, action_summary: action.kind });
  };
  const runAsync = (pending: "search" | "save" | "send", operation: () => Promise<typeof state>) => {
    if (state.pending) return;
    setState({ ...state, pending, error: null });
    void operation().then(update);
  };
  const confirmed = state.outcome?.status === "sent" ? state.outcome : null;
  if (confirmed) return (
    <section id="grocery-order-review" role="region" className="order-review" data-testid="order-review-confirmed" aria-labelledby="order-review-confirmed-title">
      <h2 id="order-review-confirmed-title">Sent to Kroger</h2>
      <p>This sent items to the Kroger cart. Checkout is still yours to complete.</p>
      <ol>
        <li>{confirmed.steps.cart.count ?? 0} items sent to Kroger</li>
        <li>{confirmed.steps.list.advanced ? "Moved to In cart" : "List advance unavailable"}</li>
        <li>{confirmed.steps.cache.inserted.length + confirmed.steps.cache.updated.length} store matches learned</li>
        <li>{confirmed.verified_saved_brands.length} preferred brands verified</li>
        <li>{confirmed.left_off.length} items left to-buy</li>
        <li>{confirmed.steps.send.recorded ? `${money(confirmed.steps.send.estimated_total)} persisted estimate; ${money(confirmed.steps.send.flyer_savings)} flyer savings` : `Send summary unavailable: ${confirmed.steps.send.error ?? "not recorded"}`}</li>
      </ol>
      <Button onClick={() => void closeOrderReview(state, adapter).then(update)}>Back to grocery</Button>
    </section>
  );
  const total = orderReviewEstimatedTotal(state);
  const busy = state.pending != null;
  return (
    <section id="grocery-order-review" role="region" className="order-review" data-testid="order-review" aria-labelledby="order-review-title">
      <header><div><h2 id="order-review-title">Order review</h2><p>{state.preview.store?.name ?? "Kroger location unavailable"}</p></div><Button variant="ghost" aria-label="Close order review" onClick={() => void closeOrderReview(state, adapter).then(update)}>Close</Button></header>
      <div className="order-review-tiles" aria-label="Order quote summary">
        <div><strong>{state.preview.counts.going_to_cart}</strong><span>Going to cart</span></div>
        <div><strong>{money(total)}</strong><span>Estimated total</span></div>
        {state.preview.flyer_savings && state.preview.flyer_savings > 0 ? <div><strong>{money(state.preview.flyer_savings)}</strong><span>Flyer savings</span></div> : null}
      </div>
      <p className="order-review-disclaimer">{state.preview.quote_disclaimer}</p>
      {state.preview.cleared_cart_ack_required ? <label className="order-review-warning"><input type="checkbox" checked={state.cleared_cart_ack} onChange={(event) => stage({ kind: "clearance", checked: event.target.checked })} /> I've cleared the old Kroger cart</label> : null}
      {state.error ? <p role="alert">{state.error}</p> : null}
      <h3>Matched</h3>
      <ul>{state.preview.matched.map((line) => {
        const skipped = state.stage.skipped.includes(line.line_key);
        const quantity = state.stage.quantities[line.line_key] ?? line.quantity;
        return <li key={line.line_key} data-testid="order-review-line" data-name={line.name}>
          <strong>{line.display_name ?? line.name}</strong><span>{productLabel(line.selected)} · {money(line.selected.on_sale ? line.selected.price.promo : line.selected.price.regular)}</span>
          {line.assumed_quantity ? <span><Button aria-label={`Decrease ${line.name}`} onClick={() => stage({ kind: "quantity", line_key: line.line_key, quantity: quantity - 1 })}>−</Button><output>{quantity}</output><Button aria-label={`Increase ${line.name}`} onClick={() => stage({ kind: "quantity", line_key: line.line_key, quantity: quantity + 1 })}>+</Button></span> : <span>Quantity {line.quantity}</span>}
          <Button variant="ghost" onClick={() => stage({ kind: skipped ? "add_back" : "skip", line_key: line.line_key })}>{skipped ? "Add back" : "Skip"}</Button>
          {line.options.length ? <fieldset><legend>Options for {line.name}</legend>{line.options.map((option) => <label key={option.sku}><input type="radio" name={`option-${line.line_key}`} onChange={() => stage({ kind: "select", line_key: line.line_key, sku: option.sku, source: "same_identity" })} />{productLabel(option)}</label>)}</fieldset> : null}
          {state.stage.selections.some((selection) => selection.line_key === line.line_key) ? <Button variant="ghost" onClick={() => stage({ kind: "undo_selection", line_key: line.line_key })}>Undo choice</Button> : null}
        </li>;
      })}</ul>
      {state.preview.decisions.length ? <><h3>Needs a decision</h3><ul>{state.preview.decisions.map((line) => {
        const results = state.searches[line.line_key];
        return <li key={line.line_key}><strong>{line.name}</strong><p>{line.kind === "choose_one" ? "Choose one; this won't be guessed." : "Unavailable at this store."}</p>
          {line.candidates.map((candidate) => <div key={candidate.sku}><label><input type="radio" name={`decision-${line.line_key}`} onChange={() => stage({ kind: "select", line_key: line.line_key, sku: candidate.sku, source: "same_identity" })} />{productLabel(candidate)}</label>{line.can_save_brand ? <Button variant="ghost" disabled={busy} onClick={() => runAsync("save", () => saveOrderReviewBrand(state, adapter, line.line_key, candidate.brand))}>Save preferred brand</Button> : null}</div>)}
          {line.can_search_broader ? <Button variant="outline" disabled={busy} onClick={() => runAsync("search", () => searchOrderReview(state, adapter, "broader", line.line_key))}>Search broader</Button> : null}
          <Input aria-label={`Search catalog for ${line.name}`} value={manual[line.line_key] ?? ""} onChange={(event) => setManual({ ...manual, [line.line_key]: event.target.value })} />
          <Button variant="outline" disabled={busy} onClick={() => runAsync("search", () => searchOrderReview(state, adapter, "manual", line.line_key, manual[line.line_key]))}>Search catalog</Button>
          {results?.candidates.map((candidate) => <label key={candidate.sku}><input type="radio" name={`search-${line.line_key}`} onChange={() => stage({ kind: "select", line_key: line.line_key, sku: candidate.sku, source: results.mode === "broader" ? "broader" : "manual", divergence: candidate.divergence })} />{productLabel(candidate)} · {candidate.fulfillment.curbside ? "curbside" : ""}{candidate.fulfillment.delivery ? " delivery" : ""}{candidate.divergence ? ` — searched ${candidate.divergence.searched_label}` : ""}</label>)}
        </li>;
      })}</ul></> : null}
      <form onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const label = String(form.get("impulse") ?? "").trim(); if (label.length >= 2) { stage({ kind: "impulse", key: `impulse-${Date.now()}`, label }); event.currentTarget.reset(); } }}><label>Add something<Input name="impulse" minLength={2} maxLength={80} /></label><Button type="submit" variant="outline">Add to this order</Button></form>
      <footer className="order-review-footer"><span>{state.preview.counts.going_to_cart} going · {state.preview.counts.left_off} left off</span><Button disabled={busy || state.preview.counts.going_to_cart === 0 || (state.preview.cleared_cart_ack_required && !state.cleared_cart_ack)} onClick={() => runAsync("send", () => sendOrderReviewState(state, adapter))}>{busy ? "Sending…" : "Send to Kroger"}</Button></footer>
    </section>
  );
}
