/* Order Helper — task screens: refresh/landing, to-buy list, live fill checklist. Driven by the
   live pull-list (POST /api/list) and the drive's SSE per-item states — no mock data. The prototype's
   Pause/Resume is dropped (the fill is one-shot); Stop and Resolve remain. */
import { I } from "./icons.js";
import { storeName, storeLocation, formatPrice, productName } from "./util.js";

const TERMINAL = ["carted", "substituted", "unavailable"];

/* ── 1. Refresh / landing (idle · loading · empty · error) ── */
export function RefreshScreen({ sub, errorMsg, onRefresh, onRetry }) {
  if (sub === "loading") {
    return (
      <div className="fade-in">
        <div className="loading-head"><I.refresh size={16} className="spin" /> Getting your list from the agent…</div>
        <div className="surface" style={{ marginTop: ".75rem" }}>
          <div className="sk-list" style={{ padding: ".4rem 1.1rem" }}>
            {[68, 52, 60, 44, 58, 48].map((w, i) => (
              <div className="sk-row" key={i}>
                <span className="sk sk-check" />
                <span className="sk" style={{ width: "3.2rem" }} />
                <span className="sk" style={{ width: w + "%", flex: "none" }} />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (sub === "empty") {
    return (
      <div className="hero state-empty fade-in">
        <span className="hero-ico"><I.listChecks size={26} /></span>
        <h1>Your list is empty</h1>
        <p>Add items with your grocery agent, then refresh to pull them here.</p>
        <button className="btn" data-variant="outline" onClick={onRefresh}><I.refresh size={15} /> Refresh list</button>
      </div>
    );
  }

  if (sub === "error") {
    return (
      <div className="hero state-error fade-in">
        <span className="hero-ico"><I.wifiOff size={26} /></span>
        <h1>Couldn't reach your agent</h1>
        <p>{errorMsg || "The helper is running, but the agent didn't answer. Check that it's online, then try again."}</p>
        <button className="btn" onClick={onRetry}><I.refresh size={15} /> Retry</button>
        <div className="hero-meta"><I.info size={13} /> Nothing was changed on the store.</div>
      </div>
    );
  }

  // idle
  return (
    <div className="hero fade-in">
      <span className="hero-ico"><I.cart size={26} /></span>
      <h1>Ready when you are</h1>
      <p>Pull the latest to-buy list from your agent, then we'll fill the cart together — one item at a time.</p>
      <button className="btn btn-lg" data-size="lg" onClick={onRefresh}><I.refresh size={16} /> Refresh list</button>
      <div className="hero-meta"><I.sparkles size={13} /> Get the latest to-buy list from your agent</div>
    </div>
  );
}

/* ── 2. To-buy list (loaded) ── */
export function ListScreen({ list, onFill, fillError, filling }) {
  const items = (list && list.items) || [];
  const partials = (list && list.partials) || [];
  const store = (list && list.store) || {};
  const name = storeName(store);
  const loc = storeLocation(store);

  return (
    <div className="fade-in">
      <div className="phead">
        <div>
          <h1>To-buy list</h1>
          <p className="sub"><b>{name}{loc ? " · " + loc : ""}</b> · pulled just now</p>
        </div>
        <span className="badge" data-variant="outline"><span className="count-badge">{items.length}</span>&nbsp;items</span>
      </div>

      <div className="surface">
        <div className="sec-head">
          <span className="t"><I.listChecks size={14} /> Items to buy</span>
          <span className="badge" data-variant="ghost" style={{ color: "var(--c-soft)" }}>{items.length}</span>
        </div>
        {items.map((it) => (
          <div className="row" key={it.id}>
            <span className="row-qty">{it.qty}</span>
            <div className="row-main">
              <div className="row-name">
                {it.name}
                {it.assumed && <span className="hint"><I.info size={11} /> assumed qty</span>}
              </div>
              <div className="row-recipes">{(it.recipes || []).join(" · ")}</div>
            </div>
          </div>
        ))}
      </div>

      {partials.length > 0 && (
        <div className="surface partials">
          <div className="sec-head">
            <span className="t"><I.sparkles size={14} /> You'll handle these</span>
            <span className="badge" data-variant="ghost" style={{ color: "var(--c-soft)" }}>{partials.length}</span>
          </div>
          {partials.map((p, i) => (
            <div className="partial-row" key={i}>
              <span className="partial-ico"><I.search size={13} /></span>
              <div className="partial-text">
                <q>{p.name}</q>
                <div className="partial-recipes">{(p.recipes || []).join(" · ")} · too vague to match automatically</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {fillError && (
        <div className="callout info" style={{ marginTop: "1rem", background: "var(--c-fail-bg)", borderColor: "var(--c-fail-line)" }}>
          <div className="callout-head" style={{ color: "var(--c-fail)" }}><I.alert size={15} /> Couldn't start the fill</div>
          <div style={{ fontSize: ".82rem", color: "var(--c-body)" }}>{fillError}</div>
        </div>
      )}

      <div className="actionbar">
        <span className="ab-note"><b>{items.length} items</b> ready{partials.length > 0 ? ` · ${partials.length} for you` : ""}</span>
        <button className="btn" onClick={onFill} disabled={filling || items.length === 0}>
          <I.cart size={15} /> {filling ? "Starting…" : "Fill cart"} <I.arrowRight size={15} />
        </button>
      </div>
    </div>
  );
}

/* ── 3. Filling — live checklist ── */
export function StatusChip({ s }) {
  if (s === "carted") return <span className="chip carted"><I.check size={12} /> carted</span>;
  if (s === "substituted") return <span className="chip substituted"><I.swap size={12} /> substituted</span>;
  if (s === "unavailable") return <span className="chip unavailable"><I.minus size={12} /> unavailable</span>;
  if (s === "adding") return <span className="chip adding"><I.refresh size={12} className="spin" /> adding…</span>;
  if (s === "checkpoint") return <span className="chip checkpoint"><I.search size={12} /> needs you</span>;
  return <span className="chip pending">pending</span>;
}
function FillIcon({ s }) {
  if (s === "carted") return <span className="fs-ico fs-carted"><I.check size={13} /></span>;
  if (s === "substituted") return <span className="fs-ico fs-sub"><I.swap size={12} /></span>;
  if (s === "unavailable") return <span className="fs-ico fs-unavail"><I.minus size={12} /></span>;
  if (s === "adding") return <span className="fs-ico fs-adding"><I.refresh size={13} className="spin" /></span>;
  if (s === "checkpoint") return <span className="fs-ico fs-check"><I.search size={12} /></span>;
  return <span className="fs-ico fs-pending"><I.circle size={13} /></span>;
}

export function FillScreen({ list, driveItems, checkpoint, onOpenCheckpoint, onStop, driveError, onBackToList }) {
  const items = (list && list.items) || [];
  const store = (list && list.store) || {};
  const name = storeName(store);
  const cpItem = checkpoint ? checkpoint.item_id : null;
  const pendingCheckpoints = checkpoint ? 1 : 0;

  const stateOf = (it) => {
    const raw = (driveItems[it.id] && driveItems[it.id].state) || "pending";
    if (cpItem === it.id && !TERMINAL.includes(raw)) return "checkpoint";
    return raw;
  };

  const carted = items.filter((it) => stateOf(it) === "carted").length;
  const subbed = items.filter((it) => stateOf(it) === "substituted").length;
  const unavail = items.filter((it) => stateOf(it) === "unavailable").length;
  const done = carted + subbed + unavail;
  const pct = items.length ? Math.round((done / items.length) * 100) : 0;

  return (
    <div className="fade-in">
      <div className="phead" style={{ marginBottom: ".9rem" }}>
        <div>
          <h1>Filling your cart</h1>
          <p className="sub">Watching the automation drive <b>{name}</b>. Nothing is bought yet.</p>
        </div>
      </div>

      {driveError && (
        <div className="callout info" style={{ background: "var(--c-fail-bg)", borderColor: "var(--c-fail-line)" }}>
          <div className="callout-head" style={{ color: "var(--c-fail)" }}><I.alert size={15} /> The fill stopped</div>
          <div style={{ fontSize: ".82rem", color: "var(--c-body)", marginBottom: ".6rem" }}>{driveError}</div>
          <button className="btn" data-variant="outline" data-size="sm" onClick={onBackToList}><I.arrowRight size={13} /> Back to the list</button>
        </div>
      )}

      <div className="surface progress-card">
        <div className="prog-top">
          <div className="prog-summary">
            <span className="big">{carted}</span>
            <span className="of">of {items.length} carted</span>
            <div className="prog-tags" style={{ marginLeft: ".5rem" }}>
              {subbed > 0 && <span className="chip substituted"><I.swap size={12} /> {subbed} substituted</span>}
              {unavail > 0 && <span className="chip unavailable"><I.minus size={12} /> {unavail} unavailable</span>}
            </div>
          </div>
          <div className="prog-controls">
            {pendingCheckpoints > 0 && (
              <button className="btn" data-size="sm" onClick={onOpenCheckpoint}>
                <I.search size={13} /> Resolve
              </button>
            )}
            <button className="btn" data-variant="ghost" data-size="sm" onClick={onStop}><I.stop size={13} /> Stop</button>
          </div>
        </div>
        <div className="prog-bar"><span style={{ width: pct + "%" }} /></div>
      </div>

      {pendingCheckpoints > 0 && (
        <div style={{ margin: "1rem .2rem .25rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span className="queue-note"><span className="qn-dot" /> 1 item needs your call</span>
        </div>
      )}

      <div className="surface" style={{ marginTop: pendingCheckpoints > 0 ? ".5rem" : "1rem" }}>
        {items.map((it) => {
          const s = stateOf(it);
          const di = driveItems[it.id] || {};
          const prod = di.product;
          const showProd = ["carted", "substituted"].includes(s) && prod;
          return (
            <div className={"fill-row" + (s === "adding" || s === "checkpoint" ? " active" : "")} key={it.id}>
              <FillIcon s={s} />
              <span className="thumb" style={{ opacity: s === "pending" ? 0.5 : 1 }}><I.package size={16} /></span>
              <div className="fill-main">
                <div className={"fill-name" + (s === "pending" ? " dim" : "")}>{it.name}</div>
                {showProd ? (
                  <div className="fill-prod">
                    {productName(prod)}{prod.size ? " · " + prod.size : ""}
                    {formatPrice(prod.price) && <>{" · "}<span className="price">{formatPrice(prod.price)}</span></>}
                  </div>
                ) : s === "unavailable" ? (
                  <div className="fill-prod">{di.note || "Not available — left for you to decide"}</div>
                ) : s === "checkpoint" ? (
                  <div className="fill-prod">Automation isn't sure — waiting for your pick</div>
                ) : (
                  <div className="fill-prod" style={{ color: "var(--c-faint)" }}>{it.qty} · queued</div>
                )}
              </div>
              <StatusChip s={s} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
