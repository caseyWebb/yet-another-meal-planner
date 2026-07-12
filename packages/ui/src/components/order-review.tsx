import * as React from "react";
import type { OrderReviewProduct } from "@yamp/contract";
import { Button } from "./button";
import { Input } from "./input";
import {
  closeOrderReview,
  createOrderReviewController,
  orderReviewEstimatedTotal,
  orderReviewProjection,
  refreshOrderReview,
  saveOrderReviewBrand,
  searchOrderReview,
  sendOrderReviewState,
  stageOrderReview,
  type OrderReviewHostAdapter,
} from "../order-review-controller";
import type { OrderReviewData } from "@yamp/contract";

export interface OrderReviewProps {
  data: OrderReviewData;
  adapter: OrderReviewHostAdapter;
  onDataChange?(data: OrderReviewData): void;
}

const money = (value: number | null | undefined) => (value == null ? "Unavailable" : `$${value.toFixed(2)}`);
const productLabel = (product: OrderReviewProduct) =>
  `${product.brand ? `${product.brand} ` : ""}${product.description}${product.size ? ` · ${product.size}` : ""}`;

export function OrderReview({ data, adapter, onDataChange }: OrderReviewProps) {
  const [state, setState] = React.useState(() => createOrderReviewController(data));
  const [manual, setManual] = React.useState<Record<string, string>>({});
  const stateRef = React.useRef(state);
  const operationRef = React.useRef(0);
  const publishRef = React.useRef<Promise<void>>(Promise.resolve());
  const enqueueContext = React.useCallback(
    (context: Parameters<NonNullable<OrderReviewHostAdapter["publishModelContext"]>>[0]) => {
      publishRef.current = publishRef.current
        .then(async () => {
          await adapter.publishModelContext?.(context);
        })
        .catch(() => undefined);
      return publishRef.current;
    },
    [adapter],
  );
  const controllerAdapter = React.useMemo<OrderReviewHostAdapter>(
    () => ({ ...adapter, publishModelContext: enqueueContext }),
    [adapter, enqueueContext],
  );
  const update = React.useCallback(
    (next: typeof state) => {
      const previous = stateRef.current;
      stateRef.current = next;
      setState(next);
      if (next.preview !== previous.preview) onDataChange?.(next.preview);
    },
    [onDataChange],
  );
  React.useEffect(() => {
    if (data.preview_fingerprint !== stateRef.current.preview.preview_fingerprint)
      update(createOrderReviewController(data));
  }, [data, update]);
  const publish = (next: typeof state, action: string) => {
    void enqueueContext({
      preview: next.preview,
      stage: next.stage,
      save_receipts: next.save_receipts,
      ...(next.outcome ? { outcome: next.outcome } : {}),
      action_summary: action,
    });
  };
  const readonly = adapter.mode === "readonly";
  const stage = (action: Parameters<typeof stageOrderReview>[1]) => {
    if (readonly || stateRef.current.pending) return;
    const next = stageOrderReview(stateRef.current, action);
    update(next);
    publish(next, action.kind);
  };
  const runAsync = (
    pending: "preview" | "search" | "save" | "send",
    operation: (source: typeof state) => Promise<typeof state>,
  ) => {
    const source = stateRef.current;
    if (source.pending || readonly) return;
    const operationId = ++operationRef.current;
    update({ ...source, pending, error: null });
    void operation(source)
      .then((next) => {
        if (operationId === operationRef.current) update(next);
      })
      .catch((error) => {
        if (operationId === operationRef.current)
          update({ ...source, pending: null, error: error instanceof Error ? error.message : String(error) });
      });
  };
  const confirmed = state.outcome?.status === "sent" ? state.outcome : null;
  if (confirmed)
    return (
      <section
        id="grocery-order-review"
        role="region"
        className="order-review"
        data-testid="order-review-confirmed"
        aria-labelledby="order-review-confirmed-title"
      >
        <h2 id="order-review-confirmed-title">Sent to Kroger</h2>
        <p>This sent items to the Kroger cart. Checkout is still yours to complete.</p>
        <ol data-testid="order-review-send-steps">
          <li>{confirmed.steps.cart.count ?? 0} items sent to Kroger</li>
          <li>
            {confirmed.steps.list.advanced
              ? "Moved to In cart"
              : `List advance unavailable${confirmed.steps.list.error ? `: ${confirmed.steps.list.error}` : ""}`}
          </li>
          <li>
            {confirmed.steps.cache.inserted.length + confirmed.steps.cache.updated.length} store matches
            learned
            {confirmed.steps.cache.inserted.length
              ? ` (new: ${confirmed.steps.cache.inserted.join(", ")})`
              : ""}
            {confirmed.steps.cache.updated.length
              ? ` (updated: ${confirmed.steps.cache.updated.join(", ")})`
              : ""}
            {confirmed.steps.cache.error ? `; learning failed: ${confirmed.steps.cache.error}` : ""}
          </li>
          <li>
            {confirmed.verified_saved_brands.length
              ? `Preferred brands verified: ${confirmed.verified_saved_brands.map((item) => item.brand).join(", ")}`
              : "No preferred-brand saves verified"}
          </li>
          <li>
            {confirmed.left_off.length
              ? `Stayed to-buy: ${confirmed.left_off.map((line) => `${line.name} (${line.reason})`).join(", ")}`
              : "Nothing left off"}
          </li>
          <li>
            {confirmed.steps.send.recorded
              ? `${money(confirmed.steps.send.estimated_total)} persisted estimate; ${money(confirmed.steps.send.flyer_savings)} flyer savings`
              : `Send summary unavailable: ${confirmed.steps.send.error ?? "not recorded"}`}
          </li>
        </ol>
        <Button onClick={() => void closeOrderReview(stateRef.current, controllerAdapter)}>Back to grocery</Button>
      </section>
    );
  const projection = orderReviewProjection(state);
  const total = orderReviewEstimatedTotal(state);
  const busy = state.pending != null;
  return (
    <section
      id="grocery-order-review"
      role="region"
      className="order-review"
      data-testid="order-review"
      aria-labelledby="order-review-title"
    >
      <header>
        <div>
          <h2 id="order-review-title">Order review</h2>
          <p>{state.preview.store?.name ?? "Kroger location unavailable"}</p>
        </div>
        <Button
          variant="ghost"
          aria-label="Close order review"
          onClick={() => void closeOrderReview(stateRef.current, controllerAdapter)}
        >
          Close
        </Button>
      </header>
      {readonly ? (
        <p role="status">This saved review is read-only until current store facts can be refreshed.</p>
      ) : null}
      <div className="order-review-tiles" aria-label="Order quote summary">
        <div>
          <strong>{projection.going_to_cart}</strong>
          <span>Going to cart</span>
        </div>
        <div>
          <strong>{money(total)}</strong>
          <span>Estimated total</span>
        </div>
        {state.preview.flyer_savings && state.preview.flyer_savings > 0 ? (
          <div>
            <strong>{money(state.preview.flyer_savings)}</strong>
            <span>Flyer savings</span>
          </div>
        ) : null}
      </div>
      <p className="order-review-disclaimer">{state.preview.quote_disclaimer}</p>
      {state.preview.cleared_cart_ack_required ? (
        <label className="order-review-warning">
          <input
            type="checkbox"
            disabled={readonly || busy}
            checked={state.cleared_cart_ack}
            onChange={(event) => stage({ kind: "clearance", checked: event.target.checked })}
          />{" "}
          I've cleared the old Kroger cart ({state.preview.stale_cart_count} prior items)
        </label>
      ) : null}
      {state.error ? <p role="alert">{state.error}</p> : null}
      {state.outcome?.status === "send_failed" ? (
        <ol data-testid="order-review-failed-steps">
          <li>
            Cart:{" "}
            {state.outcome.steps.cart.written
              ? "written"
              : `failed${state.outcome.steps.cart.error ? ` — ${state.outcome.steps.cart.error}` : ""}`}
          </li>
          <li>
            List:{" "}
            {state.outcome.steps.list.advanced
              ? state.outcome.steps.list.rolled_back
                ? "rolled back"
                : "advanced; rollback did not complete"
              : "not advanced"}
          </li>
          <li>
            Send record:{" "}
            {state.outcome.steps.send.recorded
              ? "recorded"
              : (state.outcome.steps.send.error ?? "not recorded")}
          </li>
          <li>
            Store learning:{" "}
            {state.outcome.steps.cache.committed
              ? "recorded"
              : (state.outcome.steps.cache.error ?? "not recorded")}
          </li>
        </ol>
      ) : null}
      {state.outcome?.status === "review_changed" && state.outcome.divergences.length ? (
        <ul data-testid="order-review-divergences">
          {state.outcome.divergences.map((divergence, index) => (
            <li key={`${divergence.category}:${divergence.line_key ?? "review"}:${index}`}>
              {divergence.message}
            </li>
          ))}
        </ul>
      ) : null}
      {state.outcome?.status === "send_failed" &&
      state.outcome.steps.cart.code === "reauth_required" &&
      adapter.reauthorize ? (
        <Button variant="outline" disabled={busy} onClick={() => void adapter.reauthorize?.()}>
          Reconnect Kroger
        </Button>
      ) : null}
      <h3>Matched</h3>
      <ul>
        {state.preview.matched.map((line) => {
          const skipped = state.stage.skipped.includes(line.line_key);
          const quantity = state.stage.quantities[line.line_key] ?? line.quantity;
          return (
            <li key={line.line_key} data-testid="order-review-line" data-name={line.name}>
              <strong>{line.display_name ?? line.name}</strong>
              <span>
                {productLabel(line.selected)} ·{" "}
                {money(line.selected.on_sale ? line.selected.price.promo : line.selected.price.regular)}
              </span>
              {line.assumed_quantity ? (
                <span>
                  <Button
                    disabled={readonly || busy}
                    aria-label={`Decrease ${line.name}`}
                    onClick={() =>
                      stage({ kind: "quantity", line_key: line.line_key, quantity: quantity - 1 })
                    }
                  >
                    −
                  </Button>
                  <output>{quantity}</output>
                  <Button
                    disabled={readonly || busy}
                    aria-label={`Increase ${line.name}`}
                    onClick={() =>
                      stage({ kind: "quantity", line_key: line.line_key, quantity: quantity + 1 })
                    }
                  >
                    +
                  </Button>
                </span>
              ) : (
                <span>Quantity {line.quantity}</span>
              )}
              <Button
                variant="ghost"
                disabled={readonly || busy}
                onClick={() => stage({ kind: skipped ? "add_back" : "skip", line_key: line.line_key })}
              >
                {skipped ? "Add back" : "Skip"}
              </Button>
              {line.options.length || line.featured_swap ? (
                <fieldset disabled={readonly || busy}>
                  <legend>Options for {line.name}</legend>
                  <label>
                    <input
                      type="radio"
                      name={`choice-${line.line_key}`}
                      checked={
                        !state.stage.selections.some((selection) => selection.line_key === line.line_key)
                      }
                      onChange={() => stage({ kind: "undo_selection", line_key: line.line_key })}
                    />
                    Current pick: {productLabel(line.selected)}
                  </label>
                  {line.featured_swap ? (
                    <label>
                      <input
                        type="radio"
                        name={`choice-${line.line_key}`}
                        checked={state.stage.selections.some(
                          (selection) =>
                            selection.line_key === line.line_key && selection.sku === line.featured_swap?.sku,
                        )}
                        onChange={() =>
                          stage({
                            kind: "select",
                            line_key: line.line_key,
                            sku: line.featured_swap!.sku,
                            source: "same_identity",
                          })
                        }
                      />
                      Featured swap: {productLabel(line.featured_swap)}
                    </label>
                  ) : null}
                  {line.options
                    .filter((option) => option.sku !== line.featured_swap?.sku)
                    .map((option) => (
                      <label key={option.sku}>
                        <input
                          type="radio"
                          name={`choice-${line.line_key}`}
                          checked={state.stage.selections.some(
                            (selection) =>
                              selection.line_key === line.line_key && selection.sku === option.sku,
                          )}
                          onChange={() =>
                            stage({
                              kind: "select",
                              line_key: line.line_key,
                              sku: option.sku,
                              source: "same_identity",
                            })
                          }
                        />
                        {productLabel(option)}
                      </label>
                    ))}
                </fieldset>
              ) : null}
              {state.stage.selections.some((selection) => selection.line_key === line.line_key) ? (
                <Button
                  variant="ghost"
                  disabled={readonly || busy}
                  onClick={() => stage({ kind: "undo_selection", line_key: line.line_key })}
                >
                  Undo choice
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {state.preview.decisions.length ? (
        <>
          <h3>Needs a decision</h3>
          <ul>
            {state.preview.decisions.map((line) => {
              const results = state.searches[line.line_key];
              return (
                <li key={line.line_key}>
                  <strong>{line.name}</strong>
                  <p>
                    {line.kind === "choose_one"
                      ? "Choose one; this won't be guessed."
                      : "Unavailable at this store."}
                  </p>
                  {line.candidates.map((candidate) => (
                    <div key={candidate.sku}>
                      <label>
                        <input
                          disabled={readonly || busy}
                          type="radio"
                          name={`choice-${line.line_key}`}
                          checked={state.stage.selections.some(
                            (selection) =>
                              selection.line_key === line.line_key && selection.sku === candidate.sku,
                          )}
                          onChange={() =>
                            stage({
                              kind: "select",
                              line_key: line.line_key,
                              sku: candidate.sku,
                              source: "same_identity",
                            })
                          }
                        />
                        {productLabel(candidate)}
                      </label>
                      {line.can_save_brand ? (
                        <Button
                          variant="ghost"
                          disabled={readonly || busy}
                          onClick={() =>
                            runAsync("save", (source) =>
                              saveOrderReviewBrand(source, controllerAdapter, line.line_key, candidate.brand),
                            )
                          }
                        >
                          Save preferred brand
                        </Button>
                      ) : null}
                    </div>
                  ))}
                  {line.can_search_broader ? (
                    <Button
                      variant="outline"
                      disabled={readonly || busy}
                      onClick={() =>
                        runAsync("search", (source) =>
                          searchOrderReview(source, controllerAdapter, "broader", line.line_key),
                        )
                      }
                    >
                      Search broader
                    </Button>
                  ) : null}
                  {line.can_search_manual ? (
                    <>
                      <Input
                        disabled={readonly || busy}
                        aria-label={`Search catalog for ${line.name}`}
                        value={manual[line.line_key] ?? ""}
                        onChange={(event) => setManual({ ...manual, [line.line_key]: event.target.value })}
                      />
                      <Button
                        variant="outline"
                        disabled={readonly || busy || (manual[line.line_key]?.trim().length ?? 0) < 2}
                        onClick={() =>
                          runAsync("search", (source) =>
                            searchOrderReview(
                              source,
                              controllerAdapter,
                              "manual",
                              line.line_key,
                              manual[line.line_key],
                            ),
                          )
                        }
                      >
                        Search catalog
                      </Button>
                    </>
                  ) : null}
                  {results?.candidates.map((candidate) => (
                    <label key={candidate.sku}>
                      <input
                        disabled={readonly || busy}
                        type="radio"
                        name={`choice-${line.line_key}`}
                        checked={state.stage.selections.some(
                          (selection) =>
                            selection.line_key === line.line_key && selection.sku === candidate.sku,
                        )}
                        onChange={() =>
                          stage({
                            kind: "select",
                            line_key: line.line_key,
                            sku: candidate.sku,
                            source: results.mode === "broader" ? "broader" : "manual",
                            divergence: candidate.divergence,
                          })
                        }
                      />
                      {productLabel(candidate)} · {candidate.fulfillment.curbside ? "curbside" : ""}
                      {candidate.fulfillment.delivery ? " delivery" : ""}
                      {candidate.divergence ? ` — searched ${candidate.divergence.searched_label}` : ""}
                    </label>
                  ))}
                  {state.stage.selections.some((selection) => selection.line_key === line.line_key) ? (
                    <Button
                      variant="ghost"
                      disabled={readonly || busy}
                      onClick={() => stage({ kind: "undo_selection", line_key: line.line_key })}
                    >
                      Undo choice
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
      {projection.left_off_lines.length ? (
        <section aria-labelledby="order-review-left-off-title">
          <h3 id="order-review-left-off-title">Staying to-buy</h3>
          <ul>
            {projection.left_off_lines.map((line) => (
              <li key={`${line.line_key}:${line.reason}`}>
                {line.name} — {line.reason.replaceAll("_", " ")}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (readonly || busy) return;
          const form = new FormData(event.currentTarget);
          const label = String(form.get("impulse") ?? "").trim();
          if (label.length >= 2) {
            stage({ kind: "impulse", key: `impulse-${Date.now()}`, label });
            event.currentTarget.reset();
            if (adapter.mode === "interactive")
              runAsync("preview", (source) => refreshOrderReview(source, controllerAdapter));
          }
        }}
      >
        <fieldset disabled={readonly || busy}>
          <label>
            Add something
            <Input name="impulse" minLength={2} maxLength={80} />
          </label>
          <Button type="submit" variant="outline">
            Add to this order
          </Button>
        </fieldset>
      </form>
      <footer className="order-review-footer">
        <span>
          {projection.going_to_cart} going · {projection.left_off} left off
        </span>
        <Button
          disabled={
            readonly ||
            busy ||
            !projection.can_send ||
            (state.preview.cleared_cart_ack_required && !state.cleared_cart_ack)
          }
          onClick={() => runAsync("send", (source) => sendOrderReviewState(source, controllerAdapter))}
        >
          {busy ? "Sending…" : adapter.mode === "delegate" ? "Ask to send" : "Send to Kroger"}
        </Button>
      </footer>
    </section>
  );
}
