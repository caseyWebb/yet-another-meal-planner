// The localhost cart-fill HELPER server (satellite-order-cart-fill) — the satellite's FIRST inbound
// listener. It is a human ↔ localhost surface (NOT a Worker-facing one: the Worker still never dials
// in — the helper only calls it OUTBOUND via the order client), so it carries standard local-app
// hardening (Decision 7):
//   * Bind scope — the CLI binds loopback (`127.0.0.1`) by default; a LAN bind is an explicit opt-in.
//     This server binds wherever it is told; it never defaults to `0.0.0.0`.
//   * Session token — a random token printed at start; every `/api/*` request must present it (as an
//     `Authorization: Bearer` header OR the httpOnly `oh_session` cookie set by `POST /api/unlock`).
//     This is distinct from the tenant INGEST KEY the helper holds to call the Worker.
//   * CSRF — every state-changing POST must echo the per-session CSRF token in the `x-oh-csrf` header
//     (issued in the unlock response). Safe GETs need no CSRF. A cross-site page can neither read the
//     token (same-origin policy) nor set a custom header without a CORS grant we never issue.
//   * The store `storageState` is held in-process to drive the browser and is NEVER served.
//
// `node:http` only (the satellite adds no web framework). Handlers are throw-free and return STRUCTURED
// error bodies; auth/CSRF/routing failures use HTTP status codes, application outcomes use HTTP 200
// with a top-level `{ ok }` so the UI's fetch handling is uniform.

import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize, sep, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchOrderList, postReceipt, type OrderListOutcome, type ReceiptOutcome } from "../order.js";
import type { FetchImpl, PushOptions } from "../push.js";
import { Drive, toCheckpointResolution, type PageHandle } from "./drive.js";
import { validateOrderEmit, type OrderAdapterFactory } from "../order-adapter.js";
import type { OrderStoreConfig, SatelliteConfig } from "../config.js";
import type { StorageState } from "../session.js";
import type { Logger } from "../adapter.js";
import type { OrderListResponse, OrderReceiptRequest } from "@grocery-agent/contract";

/** What the caller wires into the helper — everything injectable so tests use fakes and no real network/browser. */
export interface HelperDeps {
  /** The single `[[order_stores]]` entry this helper drives. */
  store: OrderStoreConfig;
  config: SatelliteConfig;
  /** The grocery-mcp connector base URL the order client dials outbound. */
  connectorUrl: string;
  /** The tenant-bound ingest key the helper holds to call the Worker (NEVER served to the UI). */
  ingestKey: string;
  /** The store's captured `storageState` (held in-process to drive the browser; NEVER served). */
  session: StorageState | null;
  /** The operator order adapter factory; undefined ⇒ Refresh works but Fill errors `no_adapter`. */
  adapterFactory?: OrderAdapterFactory;
  /** Open a live Playwright page bound to the store session (real: headful Chromium; test: a fake). */
  openPage: () => Promise<PageHandle>;
  /** The fetch used by the order client — injectable so tests avoid the network. */
  fetchImpl?: FetchImpl;
  /** Backoff knobs passed to the order client (tests use `{ baseDelayMs: 0, sleep }`). */
  clientOptions?: PushOptions;
  log: Logger;
  /** Static-assets dir (the UI drops in next phase). Defaults to `./public` beside this module. */
  publicDir?: string;
  /** Fixed tokens for deterministic tests; random `crypto` tokens otherwise. */
  tokens?: { session?: string; csrf?: string };
}

/** The running helper — its printable tokens plus lifecycle control. */
export interface Helper {
  readonly sessionToken: string;
  readonly csrfToken: string;
  listen(host: string, port: number): Promise<{ server: Server; url: string; host: string; port: number }>;
  close(): Promise<void>;
}

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

/**
 * Constant-time secret comparison for the session / CSRF tokens. An unequal length returns false
 * WITHOUT calling `timingSafeEqual` (which throws on a length mismatch — so length is never leaked via
 * a throw), and equal-length inputs are compared without short-circuiting on the first differing byte.
 */
function safeEqual(provided: string | undefined, expected: string): boolean {
  if (typeof provided !== "string") return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Build the helper. Nothing binds a port until `listen`. */
export function createHelper(deps: HelperDeps): Helper {
  const sessionToken = deps.tokens?.session ?? randomBytes(32).toString("base64url");
  const csrfToken = deps.tokens?.csrf ?? randomBytes(32).toString("base64url");
  const publicDir = normalize(deps.publicDir ?? join(MODULE_DIR, "public"));
  const fetchImpl = deps.fetchImpl;
  const clientOptions = deps.clientOptions ?? {};

  // --- in-process state (one tenant, one store, one drive at a time) --------------------------------
  let orderList: OrderListResponse | null = null;
  let drive: Drive | null = null;
  let helperAddr = "";
  let httpServer: Server | null = null;

  // --- small http utilities -------------------------------------------------------------------------
  function sendJson(res: ServerResponse, status: number, body: unknown): void {
    const s = JSON.stringify(body);
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(s) });
    res.end(s);
  }
  function apiError(res: ServerResponse, status: number, code: string, message: string): void {
    sendJson(res, status, { ok: false, error: { code, message } });
  }
  function readBody(req: IncomingMessage, maxBytes = 1_000_000): Promise<string> {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => {
        size += c.length;
        if (size > maxBytes) {
          req.destroy();
          reject(new Error("request body too large"));
          return;
        }
        chunks.push(c);
      });
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      req.on("error", reject);
    });
  }
  async function readJson(req: IncomingMessage): Promise<unknown> {
    const raw = await readBody(req);
    if (!raw.trim()) return {};
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error("invalid JSON body");
    }
  }
  function bearerToken(req: IncomingMessage): string | undefined {
    const auth = req.headers.authorization;
    if (typeof auth === "string" && auth.startsWith("Bearer ")) return auth.slice("Bearer ".length);
    return undefined;
  }
  function cookie(req: IncomingMessage, name: string): string | undefined {
    const raw = req.headers.cookie;
    if (typeof raw !== "string") return undefined;
    for (const part of raw.split(";")) {
      const eq = part.indexOf("=");
      if (eq === -1) continue;
      if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
    }
    return undefined;
  }
  function hasSession(req: IncomingMessage): boolean {
    return safeEqual(bearerToken(req), sessionToken) || safeEqual(cookie(req, "oh_session"), sessionToken);
  }
  function hasCsrf(req: IncomingMessage): boolean {
    const h = req.headers["x-oh-csrf"];
    return typeof h === "string" && safeEqual(h, csrfToken);
  }

  // --- view helpers ---------------------------------------------------------------------------------
  /** The store descriptor the UI's connection popover shows — the slug (the pull-list carries no friendly name). */
  function storeInfo(): { name: string; slug: string; location: string | null } {
    return { name: orderList?.store ?? deps.store.store, slug: deps.store.store, location: orderList?.location_id ?? null };
  }
  function adaptList(list: OrderListResponse): unknown {
    return {
      order_list_id: list.order_list_id,
      store: { name: list.store, slug: deps.store.store, location: list.location_id },
      items: list.items.map((i) => ({ id: i.item_id, name: i.name, qty: i.quantity, recipes: i.for_recipes, assumed: i.assumed_quantity })),
      partials: list.partials.map((p) => ({ name: p.name, recipes: p.for_recipes })),
    };
  }
  function mapListError(o: Exclude<OrderListOutcome, { result: "ok" }>): { code: string; message: string } {
    switch (o.result) {
      case "bad_key":
        return { code: "bad_key", message: "the ingest key is unknown or revoked — re-provision the satellite" };
      case "forbidden":
        return { code: "forbidden", message: o.error };
      case "wrong_mode":
        return { code: "wrong_fulfillment_mode", message: o.error };
      case "rate_limited":
        return { code: "rate_limited", message: "the connector is rate-limiting — try again shortly" };
      default:
        return { code: "error", message: o.error };
    }
  }
  function mapReceiptError(o: Exclude<ReceiptOutcome, { result: "ok" }>): { code: string; message: string } {
    switch (o.result) {
      case "bad_key":
        return { code: "bad_key", message: "the ingest key is unknown or revoked — re-provision the satellite" };
      case "forbidden":
        return { code: "forbidden", message: o.error };
      case "bad_payload":
        return { code: "bad_payload", message: o.error };
      case "not_found":
        return { code: "not_found", message: "the order-list is unknown — it may have expired; refresh again" };
      case "rate_limited":
        return { code: "rate_limited", message: "the connector is rate-limiting — try again shortly" };
      default:
        return { code: "error", message: o.error };
    }
  }

  // --- static assets (unauthenticated — the UI shell + token gate must load before unlock) ----------
  async function serveStatic(res: ServerResponse, rel: string, optional = false): Promise<void> {
    const target = normalize(join(publicDir, rel));
    if (target !== publicDir && !target.startsWith(publicDir + sep)) {
      apiError(res, 403, "forbidden", "path traversal rejected");
      return;
    }
    if (!existsSync(target)) {
      apiError(res, 404, "not_found", optional ? "no such asset" : "not found");
      return;
    }
    let data: Buffer;
    try {
      data = await readFile(target);
    } catch {
      apiError(res, 404, "not_found", "not found");
      return;
    }
    res.writeHead(200, { "content-type": CONTENT_TYPES[extname(target)] ?? "application/octet-stream", "content-length": data.length });
    res.end(data);
  }

  // --- route handlers -------------------------------------------------------------------------------
  async function handleUnlock(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let body: unknown;
    try {
      body = await readJson(req);
    } catch (err) {
      apiError(res, 400, "bad_request", (err as Error).message);
      return;
    }
    const provided = typeof (body as { token?: unknown })?.token === "string" ? (body as { token: string }).token : bearerToken(req);
    if (!safeEqual(provided, sessionToken)) {
      apiError(res, 401, "unauthorized", "invalid session token");
      return;
    }
    // Set the session cookie (so EventSource — which cannot send a Bearer header — authenticates) and
    // hand the UI the CSRF token it echoes on state-changing POSTs.
    res.setHeader("set-cookie", `oh_session=${sessionToken}; HttpOnly; SameSite=Strict; Path=/`);
    sendJson(res, 200, { ok: true, csrf_token: csrfToken, store: storeInfo(), helperAddr, adapter: Boolean(deps.adapterFactory), hasSession: Boolean(deps.session) });
  }

  function handleSessionInfo(res: ServerResponse): void {
    sendJson(res, 200, {
      ok: true,
      store: storeInfo(),
      connectorReachable: Boolean(deps.connectorUrl),
      helperAddr,
      adapter: Boolean(deps.adapterFactory),
      hasSession: Boolean(deps.session),
    });
  }

  async function handleList(res: ServerResponse): Promise<void> {
    const outcome = await fetchOrderList(deps.connectorUrl, deps.ingestKey, fetchImpl, clientOptions);
    if (outcome.result !== "ok") {
      sendJson(res, 200, { ok: false, error: mapListError(outcome) });
      return;
    }
    orderList = outcome.list;
    // A fresh list supersedes any prior drive (a stale fill's observations no longer apply). Stop it
    // first — closing an open page — so an abandoned/finished drive never leaks the headful browser.
    if (drive) await drive.stop();
    drive = null;
    sendJson(res, 200, { ok: true, ...(adaptList(outcome.list) as object) });
  }

  async function handleFill(res: ServerResponse): Promise<void> {
    if (!orderList) {
      sendJson(res, 200, { ok: false, error: { code: "no_list", message: "refresh the to-buy list first" } });
      return;
    }
    if (!deps.adapterFactory) {
      sendJson(res, 200, { ok: false, error: { code: "no_adapter", message: `no order adapter "${deps.store.adapter}" loaded from adapters_dir` } });
      return;
    }
    if (drive && drive.phase === "running") {
      sendJson(res, 200, { ok: false, error: { code: "drive_in_progress", message: "a fill is already running" } });
      return;
    }
    // CLAIM THE SLOT SYNCHRONOUSLY — before any await. A new Drive is `phase: "running"` by default, so a
    // concurrent second POST /api/fill now sees THIS drive as running and is rejected `drive_in_progress`,
    // instead of both racing past the terminal-drive check and each opening a headful browser (orphaning
    // one). The prior terminal drive is still superseded — its page is closed via `previous.stop()`.
    const previous = drive;
    const d = new Drive(`drive_${randomBytes(6).toString("hex")}`);
    drive = d;
    if (previous) await previous.stop();
    const adapterFactory = deps.adapterFactory;
    // Fire-and-forget: return 202 immediately; progress streams over SSE / the status route. (If a
    // concurrent /api/list or /api/fill/stop cancelled `d` during the await above, `run` closes the page
    // and bails on its cancelled guard rather than driving a superseded fill.)
    void d.run({ store: deps.store, config: deps.config, session: deps.session, adapterFactory, openPage: deps.openPage, log: deps.log }, orderList.items);
    sendJson(res, 202, { ok: true, drive_id: d.id });
  }

  async function handleStop(res: ServerResponse): Promise<void> {
    if (!drive) {
      sendJson(res, 200, { ok: false, error: { code: "no_drive", message: "no active fill" } });
      return;
    }
    // Cancel the current fill (abort a pending checkpoint, close the page). A fresh /api/fill is allowed after.
    await drive.stop();
    sendJson(res, 200, { ok: true });
  }

  function handleFillStatus(res: ServerResponse): void {
    if (!drive) {
      sendJson(res, 200, { ok: true, drive: { phase: "none" } });
      return;
    }
    const items: Record<string, unknown> = {};
    for (const [k, v] of drive.items) items[k] = v;
    sendJson(res, 200, {
      ok: true,
      drive: {
        id: drive.id,
        phase: drive.phase,
        items,
        checkpoint: drive.pendingCheckpoint,
        observations_count: drive.observations.length,
        error: drive.error ?? undefined,
      },
    });
  }

  function handleFillEvents(req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache", connection: "keep-alive" });
    res.write(":ok\n\n");
    const write = (e: unknown): void => {
      const ev = e as { type: string };
      res.write(`event: ${ev.type}\ndata: ${JSON.stringify(e)}\n\n`);
    };
    // Replay the buffered events so a subscriber that connects after `POST /api/fill` catches up.
    let unsub = (): void => {};
    if (drive) {
      for (const e of drive.buffered()) write(e);
      unsub = drive.subscribe(write);
    }
    const keepalive = setInterval(() => {
      try {
        res.write(":keepalive\n\n");
      } catch {
        // socket gone — the close handler cleans up
      }
    }, 15_000);
    req.on("close", () => {
      unsub();
      clearInterval(keepalive);
    });
  }

  async function handleResolve(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let body: unknown;
    try {
      body = await readJson(req);
    } catch (err) {
      apiError(res, 400, "bad_request", (err as Error).message);
      return;
    }
    const b = body as { checkpoint_id?: unknown; resolution?: unknown };
    if (typeof b.checkpoint_id !== "string") {
      apiError(res, 400, "bad_request", "checkpoint_id is required");
      return;
    }
    const resolution = toCheckpointResolution(b.resolution);
    if (!resolution) {
      apiError(res, 400, "bad_request", "resolution must be one of { pick } | { substitute } | { skip } | { abort }");
      return;
    }
    if (!drive) {
      sendJson(res, 200, { ok: false, error: { code: "no_drive", message: "no active fill" } });
      return;
    }
    const ok = drive.resolveCheckpoint(b.checkpoint_id, resolution);
    if (!ok) {
      sendJson(res, 200, { ok: false, error: { code: "unknown_checkpoint", message: "no pending checkpoint with that id" } });
      return;
    }
    sendJson(res, 200, { ok: true });
  }

  async function handleReceipt(res: ServerResponse): Promise<void> {
    if (!orderList) {
      sendJson(res, 200, { ok: false, error: { code: "no_list", message: "refresh the to-buy list first" } });
      return;
    }
    if (!drive || drive.phase !== "review-ready") {
      sendJson(res, 200, { ok: false, error: { code: "not_ready", message: "the fill has not reached review yet" } });
      return;
    }
    // Re-validate every collected observation through the sensor-not-judge gate before the receipt posts.
    const observations: unknown[] = [];
    for (const obs of drive.observations) {
      const v = validateOrderEmit(obs);
      if (v.ok) observations.push(v.value);
    }
    const receipt: OrderReceiptRequest = { order_list_id: orderList.order_list_id, observations };
    const outcome = await postReceipt(deps.connectorUrl, deps.ingestKey, receipt, fetchImpl, clientOptions);
    if (outcome.result !== "ok") {
      sendJson(res, 200, { ok: false, error: mapReceiptError(outcome) });
      return;
    }
    sendJson(res, 200, { ok: true, order_list: outcome.response.order_list, results: outcome.response.results });
  }

  async function handleMarkPlaced(res: ServerResponse): Promise<void> {
    if (!orderList) {
      sendJson(res, 200, { ok: false, error: { code: "no_list", message: "refresh the to-buy list first" } });
      return;
    }
    // A re-post with no new observations — advances the issued in_cart lines to `ordered` after the
    // human actually checked out. It buys nothing; it only tells the Worker.
    const receipt: OrderReceiptRequest = { order_list_id: orderList.order_list_id, mark_placed: true };
    const outcome = await postReceipt(deps.connectorUrl, deps.ingestKey, receipt, fetchImpl, clientOptions);
    if (outcome.result !== "ok") {
      sendJson(res, 200, { ok: false, error: mapReceiptError(outcome) });
      return;
    }
    sendJson(res, 200, { ok: true, order_list: outcome.response.order_list, results: outcome.response.results });
  }

  // --- dispatch -------------------------------------------------------------------------------------
  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;
    const method = req.method ?? "GET";

    // Static assets — no auth (the shell + token gate must load first).
    if (method === "GET" && (path === "/" || path === "/index.html")) return serveStatic(res, "index.html");
    if (method === "GET" && path.startsWith("/assets/")) return serveStatic(res, path.replace(/^\/+/, ""));
    if (method === "GET" && path === "/favicon.ico") return serveStatic(res, "favicon.ico", true);

    // Bootstrap: prove knowledge of the session token, receive the cookie + CSRF token.
    if (path === "/api/unlock") {
      if (method !== "POST") return apiError(res, 405, "method_not_allowed", "POST only");
      return handleUnlock(req, res);
    }

    if (!path.startsWith("/api/")) return apiError(res, 404, "not_found", "no such route");

    // Everything below requires the session token.
    if (!hasSession(req)) return apiError(res, 401, "unauthorized", "missing or invalid session token");

    // Safe GETs — no CSRF.
    if (method === "GET" && path === "/api/session") return handleSessionInfo(res);
    if (method === "GET" && path === "/api/fill/status") return handleFillStatus(res);
    if (method === "GET" && path === "/api/fill/events") return handleFillEvents(req, res);

    if (method === "POST") {
      // State-changing — require the CSRF token.
      if (!hasCsrf(req)) return apiError(res, 403, "csrf", "missing or invalid CSRF token");
      if (path === "/api/list") return handleList(res);
      if (path === "/api/fill") return handleFill(res);
      if (path === "/api/fill/stop") return handleStop(res);
      if (path === "/api/checkpoint/resolve") return handleResolve(req, res);
      if (path === "/api/receipt") return handleReceipt(res);
      if (path === "/api/mark-placed") return handleMarkPlaced(res);
      return apiError(res, 404, "not_found", "no such route");
    }

    return apiError(res, 405, "method_not_allowed", "unsupported method for this route");
  }

  return {
    sessionToken,
    csrfToken,
    listen(host: string, port: number) {
      return new Promise((resolve, reject) => {
        const server = createServer((req, res) => {
          handle(req, res).catch((err) => {
            deps.log.error("helper request failed", { error: (err as Error).message });
            try {
              if (!res.headersSent) apiError(res, 500, "internal", "request failed");
              else res.end();
            } catch {
              // response already torn down
            }
          });
        });
        server.on("error", reject);
        server.listen(port, host, () => {
          const addr = server.address();
          const actualPort = typeof addr === "object" && addr ? addr.port : port;
          helperAddr = `http://${host}:${actualPort}`;
          httpServer = server;
          resolve({ server, url: helperAddr, host, port: actualPort });
        });
      });
    },
    async close() {
      // Stop any open drive first so its headful browser page never leaks past shutdown.
      if (drive) {
        try {
          await drive.stop();
        } catch {
          // shutdown must not throw
        }
      }
      await new Promise<void>((resolve) => {
        if (!httpServer) {
          resolve();
          return;
        }
        httpServer.close(() => resolve());
      });
    },
  };
}
