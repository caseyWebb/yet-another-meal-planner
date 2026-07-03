/* Order Helper — high-fidelity surfaces: checkpoint modal, review & hand-off, confirmation.
   Driven by the live checkpoint event, the drive's per-item states, and the posted receipt.
   Reconciled with the fixed backend: the checkpoint modal keeps pick + skip (the "Search
   differently" affordance and the "Best guess"/unit-price hints are dropped — the SDK has no
   re-query and the pull-list carries no unit price); the hand-off is a reminder, not a URL open
   (the headful store window is already parked on the review page). */
import { I } from "./icons.js";
import { storeName, storeLocation, formatPrice, productName } from "./util.js";

const { useState, useEffect } = React;

/* ── 4. Checkpoint decision modal (the key interaction) ── */
export function CheckpointModal({ checkpoint, line, onPick, onSkip, onClose, busy }) {
  const options = checkpoint.options || [];
  const first = options.length ? options[0].productId : null;
  const [sel, setSel] = useState(first);

  useEffect(() => {
    setSel(options.length ? options[0].productId : null);
  }, [checkpoint.checkpoint_id]);

  const itemName = (line && line.name) || checkpoint.item_id;
  const want = line && line.qty != null ? String(line.qty) : null;
  const recipes = (line && line.recipes) || [];

  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={"Resolve " + itemName}>
        <div className="modal-head">
          <div className="modal-eyebrow">
            <span className="lbl"><I.search size={13} /> Needs your call</span>
          </div>
          <h2>{itemName}</h2>
          <p className="want">
            {want && <><b>You asked for {want}</b>{recipes.length ? " · " : ""}</>}
            {recipes.length > 0 && <>for {recipes.join(" & ")}</>}
          </p>
        </div>

        <div className="modal-reason">
          <I.info size={15} />
          <span>{checkpoint.message}</span>
        </div>

        {options.length > 0 ? (
          <div className="picklist">
            {options.map((c) => (
              <button key={c.productId} className={"pick" + (sel === c.productId ? " sel" : "")} onClick={() => setSel(c.productId)}>
                <span className="pick-radio">{sel === c.productId && <I.check size={12} />}</span>
                <span className="pick-thumb"><I.package size={20} /></span>
                <span className="pick-main">
                  <span className="pick-name">{productName(c)}</span>
                  {c.size && <span className="pick-meta"><span>{c.size}</span></span>}
                </span>
                {formatPrice(c.price) && (
                  <span className="pick-price">
                    <div className="p">{formatPrice(c.price)}</div>
                  </span>
                )}
              </button>
            ))}
          </div>
        ) : (
          <div className="picklist">
            <div className="decider" style={{ margin: 0 }}>
              <I.info size={15} />
              <span>No candidates were offered — confirm to add, or skip this line.</span>
            </div>
          </div>
        )}

        <div className="decider">
          <I.shieldCheck size={15} />
          <span><b>You're the decision-maker.</b> Nothing is added until you choose.</span>
        </div>

        <div className="modal-foot">
          <div className="left">
            <button className="btn" data-variant="ghost" data-size="sm" onClick={onSkip} disabled={busy}><I.minus size={14} /> Skip this item</button>
          </div>
          <div className="right">
            <button className="btn" data-variant="outline" onClick={onClose} disabled={busy}>Not now</button>
            <button className="btn" onClick={() => onPick(sel)} disabled={busy || (options.length > 0 && !sel)}>
              <I.check size={15} /> {busy ? "Adding…" : "Add to cart"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── 5. Review & checkout hand-off (the stop point) ── */
export function ReviewScreen({ list, driveItems, receipt, onConfirm }) {
  const items = (list && list.items) || [];
  const store = (list && list.store) || {};
  const name = storeName(store);
  const loc = storeLocation(store);
  const stateOf = (it) => (driveItems[it.id] && driveItems[it.id].state) || "pending";

  const carted = items.filter((it) => stateOf(it) === "carted");
  const subbed = items.filter((it) => stateOf(it) === "substituted");
  const unavail = items.filter((it) => stateOf(it) === "unavailable");
  const inCart = carted.length + subbed.length;

  const priced = [...carted, ...subbed]
    .map((it) => driveItems[it.id] && driveItems[it.id].product && driveItems[it.id].product.price)
    .filter((p) => typeof p === "number");
  const subtotal = priced.reduce((a, b) => a + b, 0);
  // The count moved to "in cart" is the carted + substituted lines (what the receipt advanced);
  // `receipt` confirms the post landed but its per-observation results also count unavailable lines.
  const reported = inCart;
  void receipt;

  return (
    <div className="fade-in">
      <div className="phead" style={{ marginBottom: ".9rem" }}>
        <div>
          <h1>Review your cart</h1>
          <p className="sub">Everything the automation carted at <b>{name}{loc ? " · " + loc : ""}</b>.</p>
        </div>
      </div>

      <div className="summary-grid">
        <div className="sum-tile ok">
          <div className="v">{inCart}</div>
          <div className="k"><I.cart size={13} /> in cart</div>
        </div>
        <div className="sum-tile info">
          <div className="v">{subbed.length}</div>
          <div className="k"><I.swap size={13} /> substituted</div>
        </div>
        <div className="sum-tile neutral">
          <div className="v">{unavail.length}</div>
          <div className="k"><I.minus size={13} /> unavailable</div>
        </div>
      </div>

      {subbed.length > 0 && (
        <div className="callout info">
          <div className="callout-head"><I.swap size={15} /> Substitutions — eyeball these before you buy</div>
          {subbed.map((it) => {
            const prod = (driveItems[it.id] && driveItems[it.id].product) || {};
            const note = driveItems[it.id] && driveItems[it.id].note;
            return (
              <div className="sub-line" key={it.id}>
                <I.replace size={14} />
                <div className="sl-main">
                  <div>
                    <span className="from">{it.name} · {it.qty}</span> → <span className="to">{productName(prod)}{prod.size ? " · " + prod.size : ""}</span>{" "}
                    {formatPrice(prod.price) && <span style={{ color: "var(--c-ink)", fontWeight: 500 }}>{formatPrice(prod.price)}</span>}
                  </div>
                  {note && <div className="why">{note}</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {unavail.length > 0 && (
        <div className="surface" style={{ marginBottom: "1rem" }}>
          <div className="sec-head"><span className="t"><I.minus size={14} /> Left unavailable</span></div>
          {unavail.map((it) => {
            const note = driveItems[it.id] && driveItems[it.id].note;
            return (
              <div className="row" key={it.id}>
                <div className="row-main">
                  <div className="row-name">{it.name} <span className="chip unavailable"><I.minus size={12} /> not carted</span></div>
                  {note && <div className="row-recipes">{note}</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="surface">
        <div className="sec-head">
          <span className="t"><I.cart size={14} /> In your cart</span>
          <span className="badge" data-variant="ghost" style={{ color: "var(--c-soft)" }}>{inCart}</span>
        </div>
        {[...carted, ...subbed].map((it) => {
          const prod = (driveItems[it.id] && driveItems[it.id].product) || {};
          return (
            <div className="fill-row" key={it.id}>
              <span className="thumb"><I.package size={16} /></span>
              <div className="fill-main">
                <div className="fill-name">{productName(prod) || it.name}</div>
                <div className="fill-prod">for {it.name}{prod.size ? " · " + prod.size : ""}</div>
              </div>
              {stateOf(it) === "substituted" && <span className="chip substituted" style={{ marginRight: ".5rem" }}><I.swap size={12} /> sub</span>}
              {formatPrice(prod.price) && <span className="fill-qty" style={{ fontWeight: 600, color: "var(--c-ink)" }}>{formatPrice(prod.price)}</span>}
            </div>
          );
        })}
        {subtotal > 0 && (
          <div className="receipt-total">
            <span className="rt-k">Estimated subtotal</span>
            <span className="rt-v">{formatPrice(subtotal)} <small>· {inCart} items</small></span>
          </div>
        )}
      </div>

      <div className="handoff" style={{ marginTop: "1.25rem" }}>
        <span className="done-badge"><I.check size={13} /> Automation done</span>
        <h2>Your cart is filled — take it from here</h2>
        <p>We've driven {name}'s site to its own cart page and stopped. Finish the checkout yourself in the store window that's already open.</p>
        <button className="btn btn-lg" data-size="lg" data-variant="outline" onClick={() => {}}><I.external size={16} /> Finish checkout in the store window</button>
        <div className="reminder"><I.shieldCheck size={14} /> You complete the purchase on {name}'s site — this tool never does.</div>
      </div>

      <div className="actionbar" style={{ bottom: "2.6rem" }}>
        <span className="ab-note">Reported <b>{reported} items</b> to your agent as "in cart".</span>
        <button className="btn" data-variant="outline" onClick={onConfirm}>What was recorded <I.arrowRight size={15} /></button>
      </div>
    </div>
  );
}

/* ── 6. Post-receipt confirmation + optional mark-as-placed ── */
export function ConfirmScreen({ list, driveItems, placed, onMarkPlaced, markBusy }) {
  const items = (list && list.items) || [];
  const partials = (list && list.partials) || [];
  const store = (list && list.store) || {};
  const name = storeName(store);
  const stateOf = (it) => (driveItems[it.id] && driveItems[it.id].state) || "pending";
  const carted = items.filter((it) => stateOf(it) === "carted").length;
  const subbed = items.filter((it) => stateOf(it) === "substituted").length;
  const unavail = items.filter((it) => stateOf(it) === "unavailable").length;
  const inCart = carted + subbed;

  return (
    <div className="main narrow fade-in" style={{ paddingTop: "1.5rem" }}>
      <div className="confirm-hero">
        <span className="cok"><I.checkCircle size={28} /></span>
        <h1>Reported back to your agent</h1>
        <p>Your agent has advanced the shopping list. Here's what was recorded.</p>
      </div>

      <div className="surface recorded">
        <div className="rec-row"><I.cart size={16} className="rec-ok" /> Moved to "in cart" <span className="rec-count">{inCart}</span></div>
        <div className="rec-row"><I.swap size={16} className="rec-info" /> Recorded as substituted <span className="rec-count">{subbed}</span></div>
        <div className="rec-row"><I.minus size={16} className="rec-muted" /> Still needs buying <span className="rec-count">{unavail}</span></div>
        <div className="rec-row"><I.sparkles size={16} className="rec-muted" /> Partials left for you <span className="rec-count">{partials.length}</span></div>
      </div>

      <div className={"mark-placed" + (placed ? " done" : "")}>
        {placed ? (
          <React.Fragment>
            <span className="cok" style={{ width: "2.4rem", height: "2.4rem", marginBottom: ".6rem" }}><I.check size={20} /></span>
            <h3>Marked as placed</h3>
            <p>Your agent now knows this order is done. Nice work.</p>
          </React.Fragment>
        ) : (
          <React.Fragment>
            <div className="mp-lbl">Optional · after real checkout</div>
            <h3>Did you complete checkout on {name}'s site?</h3>
            <p>Only tap this once you've actually placed the order there. It just tells your agent the order is done — it doesn't buy anything.</p>
            <button className="btn" data-variant="outline" onClick={onMarkPlaced} disabled={markBusy}>
              <I.check size={15} /> {markBusy ? "Marking…" : "I placed the order"}
            </button>
          </React.Fragment>
        )}
      </div>
    </div>
  );
}
