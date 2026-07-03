/* Order Helper — orchestrator. Theme, the unlock gate, and the forward-moving task flow, driven by
   the live helper API (POST /api/list · /api/fill + SSE /api/fill/events · /api/checkpoint/resolve ·
   /api/receipt · /api/mark-placed). The prototype's simulated setTimeout drive is replaced by real
   SSE progress; the prototype's StateJumper is dropped. */
import { Header, SafetyLine, TokenGate } from "./shell.jsx";
import { RefreshScreen, ListScreen, FillScreen } from "./screens.jsx";
import { CheckpointModal, ReviewScreen, ConfirmScreen } from "./surfaces.jsx";
import { I } from "./icons.js";
import { api, openFillEvents } from "./api.js";

const { useState, useEffect, useRef, useCallback } = React;

/* Theme: OS-preference default, manual override persisted to `oh:theme` (identical to the prototype). */
function useTheme() {
  const read = () => {
    try {
      const saved = localStorage.getItem("oh:theme");
      if (saved === "light" || saved === "dark") return saved;
    } catch (e) {}
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  };
  const [theme, setTheme] = useState(read);
  const [manual, setManual] = useState(() => {
    try { return !!localStorage.getItem("oh:theme"); } catch (e) { return false; }
  });
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);
  useEffect(() => {
    if (manual || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e) => setTheme(e.matches ? "dark" : "light");
    mq.addEventListener ? mq.addEventListener("change", onChange) : mq.addListener(onChange);
    return () => { mq.removeEventListener ? mq.removeEventListener("change", onChange) : mq.removeListener(onChange); };
  }, [manual]);
  const toggle = () => {
    setManual(true);
    setTheme((t) => {
      const next = t === "dark" ? "light" : "dark";
      try { localStorage.setItem("oh:theme", next); } catch (e) {}
      return next;
    });
  };
  return [theme, toggle];
}

function App() {
  const [theme, toggleTheme] = useTheme();
  const [unlocked, setUnlocked] = useState(false);
  const [session, setSession] = useState(null);

  const [stage, setStage] = useState("refresh");   // refresh | list | filling | review | confirm
  const [sub, setSub] = useState("idle");           // refresh substate: idle | loading | empty | error
  const [refreshError, setRefreshError] = useState("");

  const [list, setList] = useState(null);
  const [filling, setFilling] = useState(false);
  const [fillError, setFillError] = useState("");

  const [driveItems, setDriveItems] = useState({});
  const [checkpoint, setCheckpoint] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [driveError, setDriveError] = useState("");

  const [receipt, setReceipt] = useState(null);
  const [receiptError, setReceiptError] = useState("");
  const [placed, setPlaced] = useState(false);
  const [markBusy, setMarkBusy] = useState(false);

  const sseCloseRef = useRef(null);
  const postedRef = useRef(false);

  const closeSSE = useCallback(() => {
    if (sseCloseRef.current) {
      sseCloseRef.current();
      sseCloseRef.current = null;
    }
  }, []);

  useEffect(() => () => closeSSE(), [closeSSE]);

  const lineFor = (itemId) => ((list && list.items) || []).find((it) => it.id === itemId) || null;

  // ── Unlock ──
  const doUnlock = async (token) => {
    const r = await api.unlock(token);
    if (r.status === 200 && r.body && r.body.ok) {
      setSession(r.body);
      setUnlocked(true);
      setStage("refresh");
      setSub("idle");
      // Enrich with connector reachability (the unlock body carries store/adapter/session, not it).
      const s = await api.session();
      if (s.body && s.body.ok) setSession((prev) => ({ ...prev, ...s.body }));
      return { ok: true };
    }
    const msg = (r.body && r.body.error && r.body.error.message) || "That token doesn't look right — check the terminal.";
    return { ok: false, error: r.status === 401 ? "That token wasn't accepted — check the terminal and try again." : msg };
  };

  // ── Refresh: pull the to-buy list ──
  const refreshList = async () => {
    setSub("loading");
    setRefreshError("");
    setFillError("");
    const r = await api.list();
    if (r.body && r.body.ok) {
      setList(r.body);
      if (r.body.store) setSession((prev) => ({ ...(prev || {}), store: r.body.store }));
      if (!r.body.items || r.body.items.length === 0) {
        setSub("empty");
      } else {
        setStage("list");
        setSub("idle");
      }
      return;
    }
    setSub("error");
    setRefreshError((r.body && r.body.error && r.body.error.message) || "The helper is running, but the agent didn't answer.");
  };

  // ── Fill: kick the drive, then stream progress over SSE ──
  const openSSE = useCallback(() => {
    closeSSE();
    sseCloseRef.current = openFillEvents({
      onItem: (d) => {
        if (!d || !d.item_id) return;
        setDriveItems((m) => ({ ...m, [d.item_id]: { state: d.state, product: d.product, note: d.note } }));
      },
      onCheckpoint: (d) => {
        if (!d) return;
        setCheckpoint(d);
        setModalOpen(true);
      },
      onReviewReady: () => { void postReceipt(); },
      onCancelled: () => {
        closeSSE();
        setStage("list");
      },
      onError: (d) => {
        setDriveError((d && d.message) || "The automation hit an error.");
        closeSSE();
      },
    });
  }, [closeSSE]);

  const startFill = async () => {
    setFilling(true);
    setFillError("");
    setDriveError("");
    setReceipt(null);
    setReceiptError("");
    postedRef.current = false;
    const seed = {};
    ((list && list.items) || []).forEach((it) => { seed[it.id] = { state: "pending" }; });
    setDriveItems(seed);
    setCheckpoint(null);
    setModalOpen(false);
    const r = await api.fill();
    setFilling(false);
    if (r.status === 202 && r.body && r.body.ok) {
      setStage("filling");
      openSSE();
      return;
    }
    setFillError((r.body && r.body.error && r.body.error.message) || "Couldn't start the fill.");
  };

  const postReceipt = useCallback(async () => {
    if (postedRef.current) return;
    postedRef.current = true;
    closeSSE();
    const r = await api.receipt();
    if (r.body && r.body.ok) {
      setReceipt({ order_list: r.body.order_list, results: r.body.results });
    } else {
      setReceiptError((r.body && r.body.error && r.body.error.message) || "The cart is filled, but reporting it back failed.");
    }
    setStage("review");
  }, [closeSSE]);

  // ── Checkpoint resolution (the human is the only resolver) ──
  const resolveWith = async (resolution) => {
    if (!checkpoint) return;
    setResolving(true);
    const r = await api.resolveCheckpoint(checkpoint.checkpoint_id, resolution);
    setResolving(false);
    if (r.body && r.body.ok) {
      setModalOpen(false);
      setCheckpoint(null);
    }
    // On failure the modal stays open so the human can retry; the drive is still blocked on this checkpoint.
  };
  const onPick = (productId) => resolveWith({ pick: { productId } });
  const onSkip = () => resolveWith({ skip: true });

  const onStop = async () => {
    closeSSE();
    await api.stop();
    setStage("list");
    setDriveItems({});
    setCheckpoint(null);
    setModalOpen(false);
    setDriveError("");
  };

  const backToList = () => {
    closeSSE();
    setDriveError("");
    setCheckpoint(null);
    setModalOpen(false);
    setStage("list");
  };

  const onMarkPlaced = async () => {
    setMarkBusy(true);
    const r = await api.markPlaced();
    setMarkBusy(false);
    if (r.body && r.body.ok) {
      setPlaced(true);
      if (r.body.results) setReceipt((prev) => ({ ...(prev || {}), ...r.body }));
    }
  };

  // ── Render ──
  if (!unlocked) {
    return <TokenGate onUnlock={doUnlock} theme={theme} onToggleTheme={toggleTheme} />;
  }

  let body = null;
  if (stage === "refresh") {
    body = <RefreshScreen sub={sub} errorMsg={refreshError} onRefresh={refreshList} onRetry={refreshList} />;
  } else if (stage === "list") {
    body = <ListScreen list={list} onFill={startFill} fillError={fillError} filling={filling} />;
  } else if (stage === "filling") {
    body = (
      <FillScreen
        list={list}
        driveItems={driveItems}
        checkpoint={checkpoint}
        onOpenCheckpoint={() => setModalOpen(true)}
        onStop={onStop}
        driveError={driveError}
        onBackToList={backToList}
      />
    );
  } else if (stage === "review") {
    body = (
      <>
        {receiptError && (
          <div className="callout info" style={{ background: "var(--c-warn-bg)", borderColor: "var(--c-warn-line)", marginBottom: "1rem" }}>
            <div className="callout-head" style={{ color: "var(--c-warn)" }}><I.info size={15} /> Heads up</div>
            <div style={{ fontSize: ".82rem", color: "var(--c-body)" }}>{receiptError}</div>
          </div>
        )}
        <ReviewScreen list={list} driveItems={driveItems} receipt={receipt} onConfirm={() => setStage("confirm")} />
      </>
    );
  } else if (stage === "confirm") {
    body = <ConfirmScreen list={list} driveItems={driveItems} placed={placed} onMarkPlaced={onMarkPlaced} markBusy={markBusy} />;
  }

  const fullWidthConfirm = stage === "confirm";

  return (
    <div className="app">
      <Header theme={theme} onToggleTheme={toggleTheme} session={session} />
      {fullWidthConfirm ? body : <main className="main">{body}</main>}
      <SafetyLine />
      {modalOpen && checkpoint && (
        <CheckpointModal
          checkpoint={checkpoint}
          line={lineFor(checkpoint.item_id)}
          onPick={onPick}
          onSkip={onSkip}
          onClose={() => setModalOpen(false)}
          busy={resolving}
        />
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("oh-root")).render(<App />);
