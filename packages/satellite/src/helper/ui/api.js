/* Order Helper — the same-origin client for the localhost helper API (src/helper/server.ts).
   Auth rides the httpOnly `oh_session` cookie set by POST /api/unlock (so EventSource, which
   cannot send a Bearer header, is authenticated too); state-changing POSTs echo the unlock
   response's csrf token in the `x-oh-csrf` header. Every call is throw-free: a network failure
   is normalized to `{ ok:false, status:0, body:{ error } }` so the UI's handling stays uniform. */

let csrfToken = null;

/** GET a JSON endpoint. Cookies ride same-origin automatically. */
async function getJson(path) {
  try {
    const res = await fetch(path, { method: "GET", credentials: "same-origin" });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    return { ok: false, status: 0, body: { ok: false, error: { code: "network", message: String((err && err.message) || err) } } };
  }
}

/** POST a JSON body with the CSRF header (once unlocked). */
async function postJson(path, body) {
  const headers = { "content-type": "application/json" };
  if (csrfToken) headers["x-oh-csrf"] = csrfToken;
  try {
    const res = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers,
      body: JSON.stringify(body || {}),
    });
    const parsed = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, body: parsed };
  } catch (err) {
    return { ok: false, status: 0, body: { ok: false, error: { code: "network", message: String((err && err.message) || err) } } };
  }
}

export const api = {
  /** Prove the session token; on success stashes the CSRF token + returns the store/adapter/session info. */
  async unlock(token) {
    const r = await postJson("/api/unlock", { token });
    if (r.status === 200 && r.body && r.body.csrf_token) csrfToken = r.body.csrf_token;
    return r;
  },
  /** Header + connection popover: store, connector reachability, helper address, adapter/session presence. */
  session() {
    return getJson("/api/session");
  },
  /** Pull the freshly-resolved to-buy list (also stops any prior drive server-side). */
  list() {
    return postJson("/api/list", {});
  },
  /** Kick a cart-fill drive (202 { drive_id }); open the SSE stream AFTER this resolves. */
  fill() {
    return postJson("/api/fill", {});
  },
  /** Snapshot of the current drive (phase, per-item states, pending checkpoint) — for reconnect. */
  fillStatus() {
    return getJson("/api/fill/status");
  },
  /** Cancel the running drive (closes the headful browser); returns the UI to the list view. */
  stop() {
    return postJson("/api/fill/stop", {});
  },
  /** Resolve a checkpoint: resolution ∈ { pick:{productId} } | { skip:true } | { substitute } | { abort:true }. */
  resolveCheckpoint(checkpointId, resolution) {
    return postJson("/api/checkpoint/resolve", { checkpoint_id: checkpointId, resolution });
  },
  /** Post the assembled receipt (auto-called on review-ready); returns the Worker's { order_list, results }. */
  receipt() {
    return postJson("/api/receipt", {});
  },
  /** Advance the issued in_cart lines to `ordered` after the human checked out in the store window. */
  markPlaced() {
    return postJson("/api/mark-placed", {});
  },
};

/**
 * Subscribe to the drive's SSE stream (cookie-authed). Buffered events replay on connect, so opening
 * this AFTER POST /api/fill never misses an early item transition. Returns a disposer that closes it.
 */
export function openFillEvents(handlers) {
  const es = new EventSource("/api/fill/events");
  const on = (name, fn) => {
    if (!fn) return;
    es.addEventListener(name, (ev) => {
      let data = null;
      try {
        data = ev.data ? JSON.parse(ev.data) : null;
      } catch {
        data = null;
      }
      fn(data);
    });
  };
  on("item", handlers.onItem);
  on("checkpoint", handlers.onCheckpoint);
  on("review-ready", handlers.onReviewReady);
  on("cancelled", handlers.onCancelled);
  on("error", handlers.onError);
  if (handlers.onStreamError) es.onerror = handlers.onStreamError;
  return () => {
    try {
      es.close();
    } catch {
      /* already closed */
    }
  };
}
