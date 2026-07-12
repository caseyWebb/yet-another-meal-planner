import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button, IconAlert, IconCart, IconCheck, IconChevronRight, IconX, toast } from "@yamp/ui";
import { api, apiError } from "../lib/api";
import {
  fetchSubstitutions,
  type LineSuggestions,
  type OrderOutcome,
  type OrderRequest,
  type SubstitutionAlternative,
} from "../lib/data";

type OrderPhase =
  | { at: "loading" }
  | { at: "error"; message: string }
  | { at: "preview"; result: OrderOutcome }
  | { at: "committing"; result: OrderOutcome }
  | { at: "done"; result: OrderOutcome };

/** Typed preview -> disposition -> commit workflow. Cart writes are deliberately
 * online-only and never enter the replayable mutation registry. */
export function OrderPanel({ inCartCount, onClose }: { inCartCount: number; onClose(): void }) {
  const qc = useQueryClient();
  const [phase, setPhase] = React.useState<OrderPhase>({ at: "loading" });
  const [excluded, setExcluded] = React.useState<Set<string>>(new Set());
  const [quantities, setQuantities] = React.useState<Record<string, number>>({});
  const [picks, setPicks] = React.useState<Record<string, string>>({});
  const [confirmedPartials, setConfirmedPartials] = React.useState<Set<string>>(new Set());
  const [cartAcknowledged, setCartAcknowledged] = React.useState(false);
  const [alternatives, setAlternatives] = React.useState<Record<string, LineSuggestions>>({});

  const post = React.useCallback(async (body: OrderRequest): Promise<OrderOutcome> => {
    const response = await api.api.grocery.order.$post({ json: body });
    if (!response.ok) throw await apiError(response);
    return (await response.json()) as OrderOutcome;
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    post({ preview: true })
      .then((result) => {
        if (cancelled) return;
        setPhase({ at: "preview", result });
        const names = result.resolved.map((line) => line.name);
        if (!names.length) return;
        void fetchSubstitutions({ names })
          .then((suggestions) => {
            if (cancelled) return;
            setAlternatives(Object.fromEntries(suggestions.suggestions.map((line) => [line.for.name, line])));
          })
          .catch(() => undefined);
      })
      .catch((error: { message?: string }) => {
        if (!cancelled) setPhase({ at: "error", message: error.message ?? "Preview failed" });
      });
    return () => {
      cancelled = true;
    };
  }, [post]);

  async function commit(preview: OrderOutcome) {
    setPhase({ at: "committing", result: preview });
    try {
      const result = await post({
        exclude: [...excluded],
        quantities,
        overrides: Object.entries(picks).map(([name, sku]) => ({ name, sku })),
        include_partials: [...confirmedPartials],
      });
      setPhase({ at: "done", result });
      await qc.invalidateQueries({ queryKey: ["grocery"] });
    } catch (error) {
      setPhase({ at: "error", message: (error as { message?: string }).message ?? "Order failed" });
    }
  }

  async function relinkKroger() {
    const response = await api.api.profile["kroger-login-url"].$get().catch(() => null);
    if (!response?.ok) {
      toast("Couldn't mint the Kroger link — try again");
      return;
    }
    const { url } = (await response.json()) as { url: string };
    window.open(url, "_blank", "noopener");
  }

  const commitArmed = inCartCount === 0 || cartAcknowledged;
  return (
    <section className="order-panel" role="dialog" aria-label="Order review" data-testid="order-panel">
      <header className="order-head">
        <div>
          <h2>
            <IconCart /> Kroger order
          </h2>
          <p>
            Review what an order would buy right now, sort out the flagged items, then send it to your cart.
          </p>
        </div>
        <button className="icon-btn" data-testid="order-close" title="Close" onClick={onClose}>
          <IconX />
        </button>
      </header>

      {inCartCount > 0 ? (
        <div className="order-warn" data-testid="order-stale-warning">
          <IconAlert />
          {inCartCount} item{inCartCount === 1 ? " is" : "s are"} still marked in-cart and never confirmed
          placed. The Kroger cart can't be read back — clear it there first so this order doesn't double-add.
          <label>
            <input
              type="checkbox"
              data-testid="order-stale-ack"
              checked={cartAcknowledged}
              onChange={(event) => setCartAcknowledged(event.target.checked)}
            />
            I've checked the Kroger cart
          </label>
        </div>
      ) : null}

      {phase.at === "loading" ? <p className="order-empty">Resolving your list against Kroger…</p> : null}
      {phase.at === "error" ? (
        <p className="order-empty" data-testid="order-error">
          {phase.message}
        </p>
      ) : null}
      {phase.at === "preview" || phase.at === "committing" ? (
        <OrderPreview
          result={phase.result}
          alternatives={alternatives}
          busy={phase.at === "committing"}
          excluded={excluded}
          setExcluded={setExcluded}
          quantities={quantities}
          setQuantities={setQuantities}
          picks={picks}
          setPicks={setPicks}
          confirmedPartials={confirmedPartials}
          setConfirmedPartials={setConfirmedPartials}
          commitArmed={commitArmed}
          onCommit={() => void commit(phase.result)}
        />
      ) : null}
      {phase.at === "done" ? (
        <OrderResult result={phase.result} onRelink={() => void relinkKroger()} />
      ) : null}
    </section>
  );
}

function priceLabel(line: { price?: { regular: number; promo: number }; on_sale?: boolean }): string | null {
  if (!line.price) return null;
  const price = line.on_sale && line.price.promo > 0 ? line.price.promo : line.price.regular;
  return `$${price.toFixed(2)}${line.on_sale ? " on sale" : ""}`;
}

function unitPriceLabel(unitPrice: number | undefined, baseUnit: string | undefined): string | null {
  if (unitPrice === undefined || baseUnit === undefined) return null;
  if (baseUnit === "g") return `$${(unitPrice * 28.3495).toFixed(2)}/oz`;
  if (baseUnit === "ml") return `$${(unitPrice * 29.5735).toFixed(2)}/fl oz`;
  return `$${unitPrice.toFixed(2)}/ea`;
}

function reasonPills(line: LineSuggestions, alternative: SubstitutionAlternative): string[] {
  return alternative.reasons.map((reason) => {
    if (reason === "cheaper") {
      const next = unitPriceLabel(alternative.unit_price, alternative.base_unit);
      const current = unitPriceLabel(line.current?.unit_price, line.current?.base_unit);
      return next && current ? `cheaper — ${next} vs ${current}` : "cheaper";
    }
    if (reason === "on_sale")
      return `on sale — $${alternative.price.promo.toFixed(2)} (was $${alternative.price.regular.toFixed(2)})`;
    return "in stock now";
  });
}

interface PreviewProps {
  result: OrderOutcome;
  alternatives: Record<string, LineSuggestions>;
  busy: boolean;
  excluded: Set<string>;
  setExcluded(value: Set<string>): void;
  quantities: Record<string, number>;
  setQuantities(value: Record<string, number>): void;
  picks: Record<string, string>;
  setPicks(value: Record<string, string>): void;
  confirmedPartials: Set<string>;
  setConfirmedPartials(value: Set<string>): void;
  commitArmed: boolean;
  onCommit(): void;
}

function OrderPreview(props: PreviewProps) {
  const toggleSet = (current: Set<string>, value: string, update: (next: Set<string>) => void) => {
    const next = new Set(current);
    next.has(value) ? next.delete(value) : next.add(value);
    update(next);
  };
  return (
    <div data-testid="order-preview">
      {props.result.underived.length ? (
        <p className="order-empty" data-testid="order-underived">
          Not derived yet (items missing from this order): {props.result.underived.join(", ")}
        </p>
      ) : null}
      {props.result.resolved.length ? (
        <ul className="order-list">
          {props.result.resolved.map((line) => {
            const excluded = props.excluded.has(line.name);
            const suggestion = props.alternatives[line.name];
            const alternative = suggestion?.alternatives[0];
            const showAlternative =
              alternative && (alternative.reasons.length > 0 || suggestion.status === "current_unavailable");
            return (
              <React.Fragment key={line.name}>
                <li
                  className={`order-row${excluded ? " excluded" : ""}`}
                  data-testid="order-line"
                  data-name={line.name}
                >
                  <div className="order-line">
                    <span className="order-name">{line.name}</span>
                    <span className="order-pick">
                      {line.brand}
                      {line.size ? ` · ${line.size}` : ""}
                    </span>
                    {priceLabel(line) ? (
                      <span className={`order-price${line.on_sale ? " sale" : ""}`}>{priceLabel(line)}</span>
                    ) : null}
                  </div>
                  <div className="order-actions">
                    {line.assumed_quantity ? (
                      <span className="order-qty" data-testid="order-qty">
                        qty{" "}
                        <input
                          className="input"
                          type="number"
                          min={1}
                          max={99}
                          aria-label={`Quantity for ${line.name}`}
                          value={props.quantities[line.name] ?? line.quantity}
                          disabled={excluded || props.busy}
                          onChange={(event) => {
                            const value = Number(event.target.value);
                            if (Number.isInteger(value) && value >= 1 && value <= 99)
                              props.setQuantities({ ...props.quantities, [line.name]: value });
                          }}
                        />
                      </span>
                    ) : (
                      <span className="order-qty">qty {line.quantity}</span>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      data-testid="order-exclude"
                      disabled={props.busy}
                      onClick={() => toggleSet(props.excluded, line.name, props.setExcluded)}
                    >
                      {excluded ? "Include" : "Skip"}
                    </Button>
                  </div>
                </li>
                {showAlternative ? (
                  <li className="subs-row" data-testid="subs-row" data-for={line.name}>
                    <div className="subs-swap">
                      <span className="subs-from">{line.name}</span>
                      {suggestion.status === "current_unavailable" ? (
                        <span className="subs-why warn" data-testid="subs-out-of-stock">
                          out of stock
                        </span>
                      ) : null}
                      <IconChevronRight />
                      <span className="subs-to">
                        {alternative.brand ? `${alternative.brand} · ` : ""}
                        {alternative.description}
                        {alternative.size ? ` · ${alternative.size}` : ""}
                      </span>
                      {reasonPills(suggestion, alternative).map((pill) => (
                        <span className="subs-why" key={pill} data-testid="subs-reason">
                          {pill}
                        </span>
                      ))}
                    </div>
                    <div className="subs-actions">
                      {props.picks[line.name] === alternative.sku ? (
                        <Button size="sm" variant="outline" disabled data-testid="subs-staged">
                          Staged for the next order
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          data-testid="subs-accept"
                          onClick={() => {
                            props.setPicks({ ...props.picks, [line.name]: alternative.sku });
                            toast(
                              `Swap staged — ${line.name} orders as ${alternative.brand || alternative.description} at the next Kroger order`,
                            );
                          }}
                        >
                          Swap
                        </Button>
                      )}
                    </div>
                  </li>
                ) : null}
              </React.Fragment>
            );
          })}
        </ul>
      ) : (
        <p className="order-empty">Nothing to buy — the pantry covers the plan.</p>
      )}

      {props.result.checkpoint.length ? (
        <>
          <h3 className="order-section-h">Needs a decision</h3>
          <ul className="order-list" data-testid="order-checkpoint">
            {props.result.checkpoint.map((checkpoint) => (
              <li
                className="order-row"
                key={checkpoint.name}
                data-testid="order-checkpoint-item"
                data-name={checkpoint.name}
              >
                <div className="order-line">
                  <span className="order-name">{checkpoint.name}</span>
                  <span className="order-pick">{checkpoint.message}</span>
                </div>
                {checkpoint.kind === "ambiguous" && checkpoint.candidates?.length ? (
                  <ul className="order-cands">
                    {checkpoint.candidates.slice(0, 5).map((candidate) => (
                      <li key={candidate.sku}>
                        <label>
                          <input
                            type="radio"
                            name={`cand-${checkpoint.name}`}
                            data-testid="order-cand"
                            data-sku={candidate.sku}
                            checked={props.picks[checkpoint.name] === candidate.sku}
                            disabled={props.busy}
                            onChange={() =>
                              props.setPicks({ ...props.picks, [checkpoint.name]: candidate.sku })
                            }
                          />
                          {candidate.brand}
                          {candidate.size ? ` · ${candidate.size}` : ""} · $
                          {(candidate.on_sale && candidate.price.promo > 0
                            ? candidate.price.promo
                            : candidate.price.regular
                          ).toFixed(2)}
                        </label>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="order-pick">left out of this order unless you pick a product</span>
                )}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {props.result.partials.length ? (
        <>
          <h3 className="order-section-h">Pantry says you have these</h3>
          <ul className="order-list" data-testid="order-partials">
            {props.result.partials.map((partial) => (
              <li
                className="order-row"
                key={partial.name}
                data-testid="order-partial"
                data-name={partial.name}
              >
                <div className="order-line">
                  <span className="order-name">{partial.name}</span>
                  {partial.for_recipes.length ? (
                    <span className="order-pick">for {partial.for_recipes.join(", ")}</span>
                  ) : null}
                </div>
                <label className="order-qty">
                  <input
                    type="checkbox"
                    data-testid="order-partial-confirm"
                    checked={props.confirmedPartials.has(partial.name)}
                    disabled={props.busy}
                    onChange={() =>
                      toggleSet(props.confirmedPartials, partial.name, props.setConfirmedPartials)
                    }
                  />
                  buy anyway
                </label>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <div className="order-foot">
        <Button
          data-testid="order-commit"
          disabled={!props.commitArmed || props.busy}
          onClick={props.onCommit}
        >
          {props.busy ? "Sending…" : "Send to Kroger cart"}
        </Button>
      </div>
    </div>
  );
}

function OrderResult({ result, onRelink }: { result: OrderOutcome; onRelink(): void }) {
  const count = result.cart.count ?? result.resolved.length;
  return (
    <div className="order-result" data-testid="order-result">
      <div
        className={`order-result-row ${result.cart.written ? "ok" : "fail"}`}
        data-testid="order-result-cart"
      >
        {result.cart.written ? <IconCheck /> : <IconAlert />}
        {result.cart.written ? (
          <span>
            {count} item{count === 1 ? "" : "s"} sent to the Kroger cart.
          </span>
        ) : (
          <span>
            The cart was NOT written
            {result.cart.code === "reauth_required"
              ? " — Kroger needs to be re-linked."
              : result.cart.error
                ? ` — ${result.cart.error}`
                : "."}{" "}
            The items stay on your to-buy list.
            {result.cart.code === "reauth_required" ? (
              <>
                {" "}
                <Button size="sm" variant="outline" data-testid="order-relink" onClick={onRelink}>
                  Re-link Kroger
                </Button>
              </>
            ) : null}
          </span>
        )}
      </div>
      <div className={`order-result-row ${result.list.advanced ? "ok" : ""}`} data-testid="order-result-list">
        {result.list.advanced ? <IconCheck /> : <IconAlert />}
        <span>
          {result.list.advanced
            ? "The carted items moved to the In cart group."
            : "The list was not advanced — nothing is marked in-cart."}
        </span>
      </div>
      {result.checkpoint.length ? (
        <div className="order-result-row" data-testid="order-result-checkpoint">
          <IconAlert />
          <span>Not carted (needs a decision): {result.checkpoint.map((item) => item.name).join(", ")}.</span>
        </div>
      ) : null}
    </div>
  );
}
