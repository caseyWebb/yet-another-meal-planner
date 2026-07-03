import { describe, expect, it, vi } from "vitest";
import { createHelper, type Helper } from "../src/helper/server.js";
import type { FetchImpl } from "../src/push.js";
import type { OrderListResponse, OrderObservation, OrderReceiptResponse } from "@grocery-agent/contract";

// The localhost cart-fill helper SERVER (satellite-order-cart-fill): loopback bind, session-token +
// CSRF gates, and the full drive → receipt round-trip driven over real HTTP against a loopback port,
// with a fake order client (no network) + a fake adapter + a fake page (no browser).

const SESSION = "sess-tok";
const CSRF = "csrf-tok";

const listBody: OrderListResponse = {
  order_list_id: "ol_1",
  store: "target",
  location_id: "T-1",
  items: [
    { item_id: "milk", name: "Milk", quantity: 1, for_recipes: ["stew"], assumed_quantity: false },
    { item_id: "eggs", name: "Eggs", quantity: 1, for_recipes: [], assumed_quantity: false },
  ],
  partials: [{ name: "crusty bread", for_recipes: ["chili"] }],
};
const receiptBody: OrderReceiptResponse = {
  order_list: { id: "ol_1", status: "received" },
  results: [
    { disposition: "accepted", source: "milk" },
    { disposition: "accepted", source: "eggs" },
  ],
};

/** A fake order-client fetch: routes /list and /receipt to canned bodies, recording every call. */
function fakeFetch(): FetchImpl & { calls: { url: string; body: string }[] } {
  const calls: { url: string; body: string }[] = [];
  const impl = ((url: string, init: { method: string; headers: Record<string, string>; body: string }) => {
    calls.push({ url, body: init.body });
    if (url.endsWith("/satellite/order/list")) return Promise.resolve({ status: 200, json: () => Promise.resolve(listBody) });
    if (url.endsWith("/satellite/order/receipt")) return Promise.resolve({ status: 200, json: () => Promise.resolve(receiptBody) });
    return Promise.resolve({ status: 404, json: () => Promise.resolve({}) });
  }) as FetchImpl & { calls: { url: string; body: string }[] };
  impl.calls = calls;
  return impl;
}

/** A fake adapter that checkpoints on `milk`, then carts milk and marks eggs unavailable. */
const fakeAdapterFactory = () => ({
  id: "fake",
  async fill(sdk: { checkpoint: (p: unknown) => Promise<unknown> }): Promise<OrderObservation[]> {
    await sdk.checkpoint({ item_id: "milk", message: "pick a match", options: [{ productId: "p1", description: "Milk A" }] });
    return [
      { kind: "order", item_id: "milk", disposition: "carted", product: { productId: "p1", description: "Milk A" } },
      { kind: "order", item_id: "eggs", disposition: "unavailable" },
    ];
  },
});

function build(): { helper: Helper; fetchImpl: ReturnType<typeof fakeFetch> } {
  const fetchImpl = fakeFetch();
  const helper = createHelper({
    store: { store: "target", adapter: "target" },
    config: { connector_url: "https://mcp.example", sources: [] },
    connectorUrl: "https://mcp.example",
    ingestKey: "ingest-123",
    session: null,
    adapterFactory: fakeAdapterFactory as never,
    openPage: async () => ({ page: {} as never, close: async () => {} }),
    fetchImpl,
    clientOptions: { baseDelayMs: 0, sleep: () => Promise.resolve() },
    log: { info() {}, warn() {}, error() {} },
    tokens: { session: SESSION, csrf: CSRF },
  });
  return { helper, fetchImpl };
}

/** Spin the helper on a loopback ephemeral port, run the body, always close. */
async function withServer(fn: (base: string, helper: Helper, fetchImpl: ReturnType<typeof fakeFetch>) => Promise<void>): Promise<void> {
  const { helper, fetchImpl } = build();
  const { url } = await helper.listen("127.0.0.1", 0);
  try {
    await fn(url, helper, fetchImpl);
  } finally {
    await helper.close();
  }
}

const authed = { authorization: `Bearer ${SESSION}` };
const authedPost = { ...authed, "content-type": "application/json", "x-oh-csrf": CSRF };

async function waitFor<T>(get: () => Promise<T>, pred: (v: T) => boolean, ms = 1500): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const v = await get();
    if (pred(v)) return v;
    if (Date.now() > deadline) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("helper server — bind + auth + CSRF hardening", () => {
  it("binds loopback and serves the static shell without auth", async () => {
    await withServer(async (base) => {
      expect(base.startsWith("http://127.0.0.1:")).toBe(true);
      const res = await fetch(`${base}/`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/text\/html/);
    });
  });

  it("rejects an /api request with no session token → 401", async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/session`);
      expect(res.status).toBe(401);
      const body = (await res.json()) as { ok: boolean; error: { code: string } };
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe("unauthorized");
    });
  });

  it("serves a safe GET with a valid session token", async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/session`, { headers: authed });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; store: { slug: string } };
      expect(body.ok).toBe(true);
      expect(body.store.slug).toBe("target");
    });
  });

  it("rejects a state-changing POST with a missing or bad CSRF token → 403", async () => {
    await withServer(async (base) => {
      const noCsrf = await fetch(`${base}/api/list`, { method: "POST", headers: { ...authed, "content-type": "application/json" }, body: "{}" });
      expect(noCsrf.status).toBe(403);
      const badCsrf = await fetch(`${base}/api/list`, { method: "POST", headers: { ...authed, "content-type": "application/json", "x-oh-csrf": "wrong" }, body: "{}" });
      expect(badCsrf.status).toBe(403);
    });
  });

  it("unlock validates the token, sets the httpOnly cookie, and returns the CSRF token", async () => {
    await withServer(async (base) => {
      const bad = await fetch(`${base}/api/unlock`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: "nope" }) });
      expect(bad.status).toBe(401);
      const res = await fetch(`${base}/api/unlock`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: SESSION }) });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; csrf_token: string };
      expect(body.ok).toBe(true);
      expect(body.csrf_token).toBe(CSRF);
      expect(res.headers.get("set-cookie")).toMatch(/oh_session=.*HttpOnly/i);
    });
  });
});

describe("helper server — the fill → checkpoint → receipt round-trip", () => {
  it("refreshes the list, drives the fill through a human checkpoint, and posts the assembled receipt", async () => {
    await withServer(async (base, _helper, fetchImpl) => {
      // Refresh: the Worker pull-list, adapted to the UI shape.
      const list = await (await fetch(`${base}/api/list`, { method: "POST", headers: authedPost, body: "{}" })).json();
      expect(list.ok).toBe(true);
      expect(list.order_list_id).toBe("ol_1");
      expect(list.items).toHaveLength(2);
      expect(list.items[0]).toMatchObject({ id: "milk", name: "Milk", qty: 1, recipes: ["stew"], assumed: false });
      expect(list.partials[0]).toMatchObject({ name: "crusty bread" });

      // Start the drive.
      const fill = await fetch(`${base}/api/fill`, { method: "POST", headers: authedPost, body: "{}" });
      expect(fill.status).toBe(202);
      expect((await fill.json()).drive_id).toBeTruthy();

      // The adapter blocks at the checkpoint — the status route surfaces it.
      const withCp = await waitFor(
        async () => (await (await fetch(`${base}/api/fill/status`, { headers: authed })).json()).drive,
        (d: { checkpoint: { checkpoint_id: string } | null; phase: string }) => d.checkpoint !== null,
      );
      expect(withCp.phase).toBe("running");
      const checkpointId = withCp.checkpoint!.checkpoint_id;

      // The human resolves — the blocked adapter continues.
      const resolve = await fetch(`${base}/api/checkpoint/resolve`, {
        method: "POST",
        headers: authedPost,
        body: JSON.stringify({ checkpoint_id: checkpointId, resolution: { pick: { productId: "p1" } } }),
      });
      expect((await resolve.json()).ok).toBe(true);

      // The drive reaches review-ready.
      await waitFor(
        async () => (await (await fetch(`${base}/api/fill/status`, { headers: authed })).json()).drive,
        (d: { phase: string }) => d.phase === "review-ready",
      );

      // Receipt: assembled from the drive's observations, validated, posted; the Worker's results surface.
      const receipt = await (await fetch(`${base}/api/receipt`, { method: "POST", headers: authedPost, body: "{}" })).json();
      expect(receipt.ok).toBe(true);
      expect(receipt.order_list).toMatchObject({ id: "ol_1", status: "received" });
      expect(receipt.results).toHaveLength(2);

      // The posted receipt carried the correct order_list_id + both dispositions.
      const receiptCall = fetchImpl.calls.find((c) => c.url.endsWith("/satellite/order/receipt"));
      const posted = JSON.parse(receiptCall!.body) as { order_list_id: string; observations: OrderObservation[] };
      expect(posted.order_list_id).toBe("ol_1");
      expect(posted.observations.map((o) => `${o.item_id}:${o.disposition}`).sort()).toEqual(["eggs:unavailable", "milk:carted"]);
    });
  });

  it("mark-placed re-posts { mark_placed: true } with no observations", async () => {
    await withServer(async (base, _helper, fetchImpl) => {
      await fetch(`${base}/api/list`, { method: "POST", headers: authedPost, body: "{}" });
      const res = await (await fetch(`${base}/api/mark-placed`, { method: "POST", headers: authedPost, body: "{}" })).json();
      expect(res.ok).toBe(true);
      const call = fetchImpl.calls.find((c) => c.url.endsWith("/satellite/order/receipt"));
      const posted = JSON.parse(call!.body) as { order_list_id: string; mark_placed?: boolean; observations?: unknown[] };
      expect(posted).toMatchObject({ order_list_id: "ol_1", mark_placed: true });
      expect(posted.observations).toBeUndefined();
    });
  });

  it("fill without a prior list, and receipt before review, return structured errors", async () => {
    await withServer(async (base) => {
      const fill = await (await fetch(`${base}/api/fill`, { method: "POST", headers: authedPost, body: "{}" })).json();
      expect(fill).toMatchObject({ ok: false, error: { code: "no_list" } });
      await fetch(`${base}/api/list`, { method: "POST", headers: authedPost, body: "{}" });
      const receipt = await (await fetch(`${base}/api/receipt`, { method: "POST", headers: authedPost, body: "{}" })).json();
      expect(receipt).toMatchObject({ ok: false, error: { code: "not_ready" } });
    });
  });
});

describe("helper server — drive lifecycle (browser stays open for checkout, no leaks)", () => {
  /** A helper whose openPage tracks each page's close SPY, so we can assert when the browser closes. */
  function buildLifecycle(adapterFactory: unknown = fakeAdapterFactory): { helper: Helper; pages: { close: ReturnType<typeof vi.fn> }[] } {
    const pages: { close: ReturnType<typeof vi.fn> }[] = [];
    const helper = createHelper({
      store: { store: "target", adapter: "target" },
      config: { connector_url: "https://mcp.example", sources: [] },
      connectorUrl: "https://mcp.example",
      ingestKey: "ingest-123",
      session: null,
      adapterFactory: adapterFactory as never,
      openPage: async () => {
        const close = vi.fn(async () => {});
        pages.push({ close });
        return { page: {} as never, close };
      },
      fetchImpl: fakeFetch(),
      clientOptions: { baseDelayMs: 0, sleep: () => Promise.resolve() },
      log: { info() {}, warn() {}, error() {} },
      tokens: { session: SESSION, csrf: CSRF },
    });
    return { helper, pages };
  }

  /** Drive the fake adapter through its milk checkpoint to review-ready. */
  async function driveToReview(base: string): Promise<void> {
    await fetch(`${base}/api/list`, { method: "POST", headers: authedPost, body: "{}" });
    await fetch(`${base}/api/fill`, { method: "POST", headers: authedPost, body: "{}" });
    const withCp = await waitFor(
      async () => (await (await fetch(`${base}/api/fill/status`, { headers: authed })).json()).drive,
      (d: { checkpoint: { checkpoint_id: string } | null }) => d.checkpoint !== null,
    );
    await fetch(`${base}/api/checkpoint/resolve`, {
      method: "POST",
      headers: authedPost,
      body: JSON.stringify({ checkpoint_id: withCp.checkpoint!.checkpoint_id, resolution: { pick: { productId: "p1" } } }),
    });
    await waitFor(
      async () => (await (await fetch(`${base}/api/fill/status`, { headers: authed })).json()).drive,
      (d: { phase: string }) => d.phase === "review-ready",
    );
  }

  it("keeps the browser OPEN at review-ready; /api/fill/stop closes it and allows a fresh fill", async () => {
    const { helper, pages } = buildLifecycle();
    const { url } = await helper.listen("127.0.0.1", 0);
    try {
      await driveToReview(url);
      expect(pages[0].close).not.toHaveBeenCalled();

      const stop = await (await fetch(`${url}/api/fill/stop`, { method: "POST", headers: authedPost, body: "{}" })).json();
      expect(stop.ok).toBe(true);
      expect(pages[0].close).toHaveBeenCalledTimes(1);

      // A fresh fill is allowed after a stop — it opens a new page.
      const refill = await fetch(`${url}/api/fill`, { method: "POST", headers: authedPost, body: "{}" });
      expect(refill.status).toBe(202);
      expect(pages.length).toBe(2);
    } finally {
      await helper.close();
    }
  });

  it("a new /api/fill after review-ready supersedes the prior drive and closes its open page", async () => {
    const { helper, pages } = buildLifecycle();
    const { url } = await helper.listen("127.0.0.1", 0);
    try {
      await driveToReview(url);
      expect(pages[0].close).not.toHaveBeenCalled();
      const refill = await fetch(`${url}/api/fill`, { method: "POST", headers: authedPost, body: "{}" });
      expect(refill.status).toBe(202);
      expect(pages[0].close).toHaveBeenCalledTimes(1);
      expect(pages.length).toBe(2);
    } finally {
      await helper.close();
    }
  });

  it("a refresh (/api/list) closes an open drive's page and resets the drive", async () => {
    const { helper, pages } = buildLifecycle();
    const { url } = await helper.listen("127.0.0.1", 0);
    try {
      await driveToReview(url);
      expect(pages[0].close).not.toHaveBeenCalled();
      await fetch(`${url}/api/list`, { method: "POST", headers: authedPost, body: "{}" });
      expect(pages[0].close).toHaveBeenCalledTimes(1);
      const status = await (await fetch(`${url}/api/fill/status`, { headers: authed })).json();
      expect(status.drive.phase).toBe("none");
    } finally {
      await helper.close();
    }
  });

  it("helper shutdown (close) closes an open drive's page", async () => {
    const { helper, pages } = buildLifecycle();
    const { url } = await helper.listen("127.0.0.1", 0);
    await driveToReview(url);
    expect(pages[0].close).not.toHaveBeenCalled();
    await helper.close();
    expect(pages[0].close).toHaveBeenCalledTimes(1);
  });

  it("a fill FAILURE closes the page", async () => {
    const failFactory = () => ({ id: "e", async fill() { return { error: "session expired" }; } });
    const { helper, pages } = buildLifecycle(failFactory);
    const { url } = await helper.listen("127.0.0.1", 0);
    try {
      await fetch(`${url}/api/list`, { method: "POST", headers: authedPost, body: "{}" });
      await fetch(`${url}/api/fill`, { method: "POST", headers: authedPost, body: "{}" });
      await waitFor(
        async () => (await (await fetch(`${url}/api/fill/status`, { headers: authed })).json()).drive,
        (d: { phase: string }) => d.phase === "error",
      );
      expect(pages[0].close).toHaveBeenCalledTimes(1);
    } finally {
      await helper.close();
    }
  });
});
