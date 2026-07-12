// @vitest-environment jsdom
// The cook-mode write controller's fake-bridge harness (recipe-card-cook-mode, D18/D19). A fake
// CookBridge records every channel call in order. Two layers are asserted:
//   • the bridge ADAPTER (`createCookBridgeAdapter`): each write is a pure backend call returning a
//     landed/not-landed boolean; a throw-free `isError` is a failure just like a rejection;
//     syncContext/announce are capability-gated and best-effort.
//   • the CONTROLLER (`useCookController`, via renderHook): a favorite tap fires callServerTool AND
//     a full-state context push and NO message; a log fires callServerTool AND context AND message;
//     completion fires a message only; a failed write pushes nothing and rolls the favorite back;
//     rapid favorite taps are seq-guarded (latest wins); the best-effort tail never rejects.
// Plus the capability ladder + version gate (`resolveCookCapabilities`) and the boot re-hydrate
// parse (`parseReadRecipeFavorite`).
import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  createCookBridgeAdapter,
  parseReadRecipeFavorite,
  resolveCookCapabilities,
  useCookController,
  type CookBridge,
  type CookCapabilities,
} from "./cook-controller";
import type { BridgeToolResult } from "./propose-controller";

const flush = () => new Promise((r) => setTimeout(r, 0));

const WRITE_CAPS: CookCapabilities = {
  readOnly: false,
  canWrite: true,
  canSyncContext: true,
  messageMode: "message",
};

/** A fake ext-apps bridge recording the ordered channel log. `deferFav` holds the toggle_favorite
 *  promises so overlapping taps can resolve out of order; `failContext`/`failMessage` reject the
 *  best-effort pushes to prove they never reject the interaction. */
function makeBridge(
  opts: {
    favIsError?: boolean;
    logIsError?: boolean;
    deferFav?: boolean;
    failContext?: boolean;
    failMessage?: boolean;
  } = {},
) {
  const calls: string[] = [];
  const toolCalls: { name: string; arguments: Record<string, unknown> }[] = [];
  const contexts: Record<string, unknown>[] = [];
  const messages: { text: string }[] = [];
  const pendingFav: Array<(v: BridgeToolResult) => void> = [];
  const bridge: CookBridge = {
    callServerTool(p): Promise<BridgeToolResult> {
      calls.push(`tool:${p.name}`);
      toolCalls.push(p);
      if (p.name === "toggle_favorite") {
        if (opts.deferFav) return new Promise((resolve) => pendingFav.push(resolve));
        return Promise.resolve(opts.favIsError ? { isError: true, content: [{ type: "text", text: "not_found" }] } : {});
      }
      if (p.name === "log_cooked") {
        return Promise.resolve(opts.logIsError ? { isError: true, content: [{ type: "text", text: "not_found" }] } : {});
      }
      return Promise.resolve({});
    },
    async updateModelContext(p) {
      calls.push("context");
      contexts.push(p.structuredContent ?? {});
      if (opts.failContext) throw new Error("context blip");
      return {};
    },
    async sendMessage(p) {
      calls.push("message");
      messages.push({ text: p.content.map((c) => c.text).join("") });
      if (opts.failMessage) throw new Error("message blip");
      return {};
    },
  };
  const resolveFav = (i: number, result: BridgeToolResult) => pendingFav[i](result);
  return { bridge, calls, toolCalls, contexts, messages, resolveFav };
}

describe("createCookBridgeAdapter — the bridge channels", () => {
  it("setFavorite calls toggle_favorite and reports the landed write", async () => {
    const { bridge, calls, toolCalls } = makeBridge();
    const adapter = createCookBridgeAdapter(bridge, { capabilities: WRITE_CAPS });
    expect(await adapter.setFavorite("soup", true)).toBe(true);
    expect(calls).toEqual(["tool:toggle_favorite"]);
    expect(toolCalls[0].arguments).toEqual({ slug: "soup", favorite: true });
  });

  it("treats a throw-free isError as a failure (worker tools resolve, not reject)", async () => {
    const { bridge } = makeBridge({ favIsError: true });
    const adapter = createCookBridgeAdapter(bridge, { capabilities: WRITE_CAPS });
    expect(await adapter.setFavorite("soup", true)).toBe(false);
  });

  it("treats a rejection as a failure too", async () => {
    const { bridge } = makeBridge();
    bridge.callServerTool = () => Promise.reject(new Error("blip"));
    const adapter = createCookBridgeAdapter(bridge, { capabilities: WRITE_CAPS });
    expect(await adapter.setFavorite("soup", true)).toBe(false);
    expect(await adapter.logCooked({ slug: "soup", date: "2026-07-12" })).toBe(false);
  });

  it("logCooked calls log_cooked with a recipe entry; isError → not landed", async () => {
    const ok = makeBridge();
    const okAdapter = createCookBridgeAdapter(ok.bridge, { capabilities: WRITE_CAPS });
    expect(await okAdapter.logCooked({ slug: "soup", date: "2026-07-12", meal: "dinner" })).toBe(true);
    expect(ok.toolCalls[0]).toMatchObject({
      name: "log_cooked",
      arguments: { type: "recipe", recipe: "soup", date: "2026-07-12", meal: "dinner" },
    });
    const bad = makeBridge({ logIsError: true });
    const badAdapter = createCookBridgeAdapter(bad.bridge, { capabilities: WRITE_CAPS });
    expect(await badAdapter.logCooked({ slug: "soup", date: "2026-07-12" })).toBe(false);
  });

  it("gates every write on canWrite (no tool call when the host cannot write)", async () => {
    const { bridge, calls } = makeBridge();
    const adapter = createCookBridgeAdapter(bridge, {
      capabilities: { readOnly: false, canWrite: false, canSyncContext: false, messageMode: "none" },
    });
    expect(await adapter.setFavorite("soup", true)).toBe(false);
    expect(await adapter.logCooked({ slug: "soup", date: "2026-07-12" })).toBe(false);
    expect(calls).toEqual([]);
  });

  it("syncContext pushes only when canSyncContext; announce only when messageMode is message", async () => {
    const on = makeBridge();
    const onAdapter = createCookBridgeAdapter(on.bridge, { capabilities: WRITE_CAPS });
    await onAdapter.syncContext!({ slug: "soup", title: "Soup", favorite: true });
    await onAdapter.announce!("hi");
    expect(on.calls).toEqual(["context", "message"]);

    const off = makeBridge();
    const offAdapter = createCookBridgeAdapter(off.bridge, {
      capabilities: { readOnly: false, canWrite: true, canSyncContext: false, messageMode: "none" },
    });
    await offAdapter.syncContext!({ slug: "soup", title: "Soup", favorite: true });
    await offAdapter.announce!("hi");
    expect(off.calls).toEqual([]);
  });
});

describe("useCookController — D18 channel discipline", () => {
  function mount(bridge: CookBridge, initialFavorite = false) {
    const adapter = createCookBridgeAdapter(bridge, { capabilities: WRITE_CAPS });
    return renderHook(() => useCookController({ adapter, slug: "soup", title: "Soup", initialFavorite }));
  }

  it("a favorite tap fires toggle_favorite AND a full-state context push, NOT a message", async () => {
    const b = makeBridge();
    const { result } = mount(b.bridge);
    await act(async () => {
      await result.current.setFavorite(true);
    });
    expect(result.current.favorite).toBe(true);
    expect(b.calls).toEqual(["tool:toggle_favorite", "context"]);
    expect(b.messages).toHaveLength(0);
    expect(b.contexts[0]).toMatchObject({ slug: "soup", title: "Soup", favorite: true });
  });

  it("a failed favorite write rolls back and pushes no context / no message", async () => {
    const b = makeBridge({ favIsError: true });
    const { result } = mount(b.bridge, false);
    await act(async () => {
      await result.current.setFavorite(true);
    });
    expect(result.current.favorite).toBe(false); // rolled back to the pre-tap value
    expect(b.calls).toEqual(["tool:toggle_favorite"]);
    expect(b.contexts).toHaveLength(0);
    expect(b.messages).toHaveLength(0);
  });

  it("rapid favorite taps are seq-guarded: a slow earlier reply cannot clobber the latest", async () => {
    const b = makeBridge({ deferFav: true });
    const { result } = mount(b.bridge, false);
    await act(async () => {
      void result.current.setFavorite(true);
      void result.current.setFavorite(false);
      await flush();
    });
    expect(result.current.favorite).toBe(false); // the latest optimistic value
    // Resolve the NEWER tap first, then the OLDER late — the older must not repopulate context.
    await act(async () => {
      b.resolveFav(1, {});
      await flush();
    });
    await act(async () => {
      b.resolveFav(0, {});
      await flush();
    });
    expect(result.current.favorite).toBe(false);
    expect(b.contexts).toHaveLength(1); // only the latest tap pushed context
    expect(b.contexts[0]).toMatchObject({ favorite: false });
  });

  it("a log fires log_cooked AND context AND a provenance message with the local date", async () => {
    const b = makeBridge();
    const { result } = mount(b.bridge);
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.logCooked({ date: "2026-07-12" });
    });
    expect(ok).toBe(true);
    expect(b.calls).toEqual(["tool:log_cooked", "context", "message"]);
    expect(b.toolCalls[0]).toMatchObject({ name: "log_cooked", arguments: { type: "recipe", recipe: "soup", date: "2026-07-12" } });
    expect(b.messages[0].text).toBe("I logged Soup as cooked on 2026-07-12.");
  });

  it("a failed log pushes no context and sends no message", async () => {
    const b = makeBridge({ logIsError: true });
    const { result } = mount(b.bridge);
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.logCooked({ date: "2026-07-12" });
    });
    expect(ok).toBe(false);
    expect(b.calls).toEqual(["tool:log_cooked"]);
    expect(b.contexts).toHaveLength(0);
    expect(b.messages).toHaveLength(0);
  });

  it("completion announces a message only — no write, no context", async () => {
    const b = makeBridge();
    const { result } = mount(b.bridge);
    await act(async () => {
      await result.current.finishCooking();
    });
    expect(b.calls).toEqual(["message"]);
    expect(b.messages[0].text).toBe("I finished cooking Soup.");
  });

  it("the best-effort tail never rejects the interaction (context/message pushes fail)", async () => {
    const b = makeBridge({ failContext: true, failMessage: true });
    const { result } = mount(b.bridge);
    let ok: boolean | undefined;
    await expect(
      (async () => {
        await act(async () => {
          ok = await result.current.logCooked({ date: "2026-07-12" });
        });
      })(),
    ).resolves.toBeUndefined();
    expect(ok).toBe(true); // the durable write landed; the failing tail is swallowed
  });
});

describe("resolveCookCapabilities — the ladder + version gate", () => {
  const known = 2;
  const full = { knownVersion: known, hostServerTools: true, hostUpdateModelContext: true, hostMessage: true };

  it("an unknown-newer contract_version degrades to the read-only card (no writes)", () => {
    expect(resolveCookCapabilities({ ...full, contractVersion: 3 })).toEqual({
      readOnly: true,
      canWrite: false,
      canSyncContext: false,
      messageMode: "none",
    });
  });

  it("a known payload with full host capabilities enables writes + context + message", () => {
    expect(resolveCookCapabilities({ ...full, contractVersion: 2 })).toEqual({
      readOnly: false,
      canWrite: true,
      canSyncContext: true,
      messageMode: "message",
    });
  });

  it("no serverTools keeps cook mode (not read-only) but disables writes", () => {
    const caps = resolveCookCapabilities({ ...full, hostServerTools: false });
    expect(caps).toMatchObject({ readOnly: false, canWrite: false });
  });

  it("messageMode follows host message support; an undefined contract_version reads as 1", () => {
    expect(resolveCookCapabilities({ ...full, hostMessage: false }).messageMode).toBe("none");
    expect(resolveCookCapabilities({ ...full, contractVersion: undefined }).canWrite).toBe(true);
  });
});

describe("parseReadRecipeFavorite — the boot re-hydrate parse", () => {
  it("reads the overlay-merged favorite from structuredContent or the text fallback", () => {
    expect(parseReadRecipeFavorite({ structuredContent: { frontmatter: { favorite: true } } })).toBe(true);
    expect(parseReadRecipeFavorite({ content: [{ type: "text", text: JSON.stringify({ frontmatter: { favorite: true } }) }] })).toBe(true);
    expect(parseReadRecipeFavorite({ structuredContent: { frontmatter: {} } })).toBe(false);
  });

  it("returns null on a failed read (isError or unparseable) so the widget degrades to read-only", () => {
    expect(parseReadRecipeFavorite({ isError: true })).toBeNull();
    expect(parseReadRecipeFavorite({ content: [{ type: "text", text: "not json" }] })).toBeNull();
    expect(parseReadRecipeFavorite({})).toBeNull();
  });
});
