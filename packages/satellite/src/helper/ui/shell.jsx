/* Order Helper — shell chrome: header (store + live connection popover), safety line, token gate.
   Wired to the live /api/session info; the prototype's StateJumper is dropped. */
import { I } from "./icons.js";
import { storeName, storeLocation } from "./util.js";

const { useState, useEffect, useRef } = React;

export function Header({ theme, onToggleTheme, session }) {
  const [popOpen, setPopOpen] = useState(false);
  const wrapRef = useRef(null);
  useEffect(() => {
    if (!popOpen) return;
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setPopOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [popOpen]);

  const store = (session && session.store) || {};
  const name = storeName(store);
  const loc = storeLocation(store);
  const connected = !!(session && session.connectorReachable);
  const slug = store.slug || store.name || "store";

  return (
    <header className="hdr">
      <span className="hdr-mark">
        <span className="mark-ico"><I.cart size={16} /></span>
        Order Helper
      </span>
      <span className="hdr-store">
        <I.store size={14} />
        <b>{name}</b>
        {loc && <span className="loc">· {loc}</span>}
      </span>
      <span className="hdr-spacer" />
      <div className="pop-wrap" ref={wrapRef}>
        <button className={"conn" + (connected ? "" : " offline")} onClick={() => setPopOpen((v) => !v)} aria-label="Connection details">
          <span className="cdot" />
          {connected ? <I.wifi size={14} /> : <I.wifiOff size={14} />}
          {connected ? "Connected" : "Offline"}
        </button>
        {popOpen && (
          <div className="pop">
            <h4>Connection</h4>
            <p className="pop-sub">One store, one session, this machine.</p>
            <div className="pop-row">
              <span className="k"><I.store size={14} /> Store</span>
              <span className="v">{name}{loc ? " · " + loc : ""}</span>
            </div>
            <div className="pop-row">
              <span className="k"><I.sparkles size={14} /> Agent</span>
              <span className="v">{connected ? "Connected" : "Unreachable"}</span>
            </div>
            <div className="pop-row">
              <span className="k"><I.lock size={14} /> Session</span>
              <span className="v mono">{slug} · {session && session.hasSession ? "captured" : "none"}</span>
            </div>
            <div className="pop-row">
              <span className="k"><I.package size={14} /> Helper</span>
              <span className="v mono">{(session && session.helperAddr) || "127.0.0.1"}</span>
            </div>
          </div>
        )}
      </div>
      <button className="hdr-tog" onClick={onToggleTheme} aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"} title={theme === "dark" ? "Light mode" : "Dark mode"}>
        {theme === "dark" ? <I.sun size={16} /> : <I.moon size={16} />}
      </button>
    </header>
  );
}

export function SafetyLine() {
  return (
    <div className="safety">
      <I.shieldCheck size={15} />
      <span>This tool fills your cart. It <b>never checks out</b> — you place the order yourself on the store's site.</span>
    </div>
  );
}

/**
 * The unlock gate — submits the session token to POST /api/unlock via `onUnlock(token)`, which resolves
 * to `{ ok }` (and, on failure, an optional `error` message). A bad token surfaces the server's rejection.
 */
export function TokenGate({ onUnlock, theme, onToggleTheme }) {
  const [val, setVal] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const token = val.trim();
    if (!token) {
      setErr("Enter the session token from your terminal.");
      return;
    }
    setBusy(true);
    setErr("");
    const res = await onUnlock(token);
    setBusy(false);
    if (!res || !res.ok) setErr((res && res.error) || "That token doesn't look right — check the terminal.");
  };

  return (
    <div className="gate-wrap">
      <button className="hdr-tog" onClick={onToggleTheme} style={{ position: "fixed", top: "1rem", right: "1.1rem" }} aria-label="Toggle theme">
        {theme === "dark" ? <I.sun size={16} /> : <I.moon size={16} />}
      </button>
      <div className="gate fade-in">
        <span className="gate-ico"><I.lock size={22} /></span>
        <h1>Unlock Order Helper</h1>
        <p>Enter the session token printed in your terminal when the helper started.</p>
        <form onSubmit={submit}>
          <div className="field">
            <label className="label" htmlFor="tok">Session token</label>
            <input
              id="tok"
              className="input token-input"
              value={val}
              onChange={(e) => { setVal(e.target.value); setErr(""); }}
              placeholder="• • • • • •"
              autoComplete="off"
              autoFocus
              disabled={busy}
            />
            {err && <div className="gate-err">{err}</div>}
          </div>
          <button className="btn" type="submit" disabled={busy}>
            <I.lock size={15} /> {busy ? "Unlocking…" : "Unlock"}
          </button>
        </form>
        <div className="gate-hint"><I.info size={13} /> Asked once per session. We never share it.</div>
      </div>
    </div>
  );
}
