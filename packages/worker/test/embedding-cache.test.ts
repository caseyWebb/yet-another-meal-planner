// The request-time query-embedding cache (member-app-propose D5): content-addressed
// KV over `KROGER_KV`, model-welded SHA-256 keys, one batched embed for the misses,
// fail-open on every KV/parse failure.
import { describe, it, expect, vi } from "vitest";
import {
  EMBED_CACHE_TTL_S,
  EMBED_DIM,
  EMBED_MODEL,
  embedCacheKey,
  embedTextsCached,
  normalizeEmbedText,
} from "../src/embedding.js";
import type { Env } from "../src/env.js";

/** A deterministic fake vector per text: EMBED_DIM floats keyed off the text length. */
function fakeVec(text: string): number[] {
  const v = new Array(EMBED_DIM).fill(0);
  v[text.length % EMBED_DIM] = 1;
  v[0] = text.length;
  return v;
}

/** In-memory KV whose get/put can be made to throw (the fail-open cases). */
function memKv(opts: { failGet?: boolean; failPut?: boolean } = {}) {
  const store = new Map<string, string>();
  const puts: { key: string; value: string; ttl?: number }[] = [];
  return {
    store,
    puts,
    async get(key: string) {
      if (opts.failGet) throw new Error("kv read down");
      return store.get(key) ?? null;
    },
    async put(key: string, value: string, o?: { expirationTtl?: number }) {
      if (opts.failPut) throw new Error("kv write down");
      puts.push({ key, value, ttl: o?.expirationTtl });
      store.set(key, value);
    },
  };
}

/** An env with a spy AI binding (batched bge shape) + the fake KROGER_KV. */
function cacheEnv(kv = memKv()) {
  const ai = vi.fn(async (_model: string, input: { text: string | string[] }) => {
    const texts = Array.isArray(input.text) ? input.text : [input.text];
    return { data: texts.map(fakeVec) };
  });
  const env = { AI: { run: ai }, KROGER_KV: kv } as unknown as Env;
  return { env, ai, kv };
}

describe("normalizeEmbedText / embedCacheKey", () => {
  it("collapses case and whitespace to one key", async () => {
    expect(normalizeEmbedText("  Cozy   Soup \n")).toBe("cozy soup");
    expect(await embedCacheKey("Cozy   Soup")).toBe(await embedCacheKey("cozy soup"));
  });

  it("distinct texts get distinct keys, prefixed embed:", async () => {
    const a = await embedCacheKey("cozy soup");
    const b = await embedCacheKey("bright salad");
    expect(a).not.toBe(b);
    expect(a).toMatch(/^embed:[0-9a-f]{64}$/);
  });

  it("the key binds the model id — a model change orphans old entries", async () => {
    const current = await embedCacheKey("cozy soup");
    const other = await embedCacheKey("cozy soup", "@cf/other/model");
    expect(current).toBe(await embedCacheKey("cozy soup", EMBED_MODEL));
    expect(other).not.toBe(current);
  });
});

describe("embedTextsCached", () => {
  it("cold cache: one batched embed call + a TTL'd put per text", async () => {
    const { env, ai, kv } = cacheEnv();
    const out = await embedTextsCached(env, ["cozy soup", "bright salad"]);
    expect(ai).toHaveBeenCalledTimes(1);
    expect((ai.mock.calls[0][1] as { text: string[] }).text).toEqual(["cozy soup", "bright salad"]);
    expect(out).toEqual([fakeVec("cozy soup"), fakeVec("bright salad")]);
    expect(kv.puts).toHaveLength(2);
    for (const p of kv.puts) expect(p.ttl).toBe(EMBED_CACHE_TTL_S);
    expect(kv.puts[0].key).toBe(await embedCacheKey("cozy soup"));
    expect(JSON.parse(kv.puts[0].value)).toEqual(fakeVec("cozy soup"));
  });

  it("warm cache: zero AI calls, the byte-identical stored vector", async () => {
    const kv = memKv();
    kv.store.set(await embedCacheKey("cozy soup"), JSON.stringify(fakeVec("stored!")));
    const { env, ai } = cacheEnv(kv);
    const out = await embedTextsCached(env, ["Cozy  Soup"]); // hits modulo case/whitespace
    expect(ai).not.toHaveBeenCalled();
    expect(out).toEqual([fakeVec("stored!")]);
  });

  it("mixed batch: embeds ONLY the misses in one call, preserving input order", async () => {
    const kv = memKv();
    kv.store.set(await embedCacheKey("cached phrase"), JSON.stringify(fakeVec("cached phrase")));
    const { env, ai } = cacheEnv(kv);
    const out = await embedTextsCached(env, ["miss one", "cached phrase", "miss two"]);
    expect(ai).toHaveBeenCalledTimes(1);
    expect((ai.mock.calls[0][1] as { text: string[] }).text).toEqual(["miss one", "miss two"]);
    expect(out).toEqual([fakeVec("miss one"), fakeVec("cached phrase"), fakeVec("miss two")]);
  });

  it("two texts differing only in case/whitespace share one key and one embed row", async () => {
    const { env, ai, kv } = cacheEnv();
    const out = await embedTextsCached(env, ["Cozy Soup", "cozy   soup"]);
    // One deduped miss (the first occurrence's original text), applied to both rows.
    expect((ai.mock.calls[0][1] as { text: string[] }).text).toEqual(["Cozy Soup"]);
    expect(out[0]).toEqual(out[1]);
    expect(kv.puts).toHaveLength(1);
  });

  it("fails open on a KV read failure (plain embed, request succeeds)", async () => {
    const { env, ai } = cacheEnv(memKv({ failGet: true }));
    const out = await embedTextsCached(env, ["cozy soup"]);
    expect(ai).toHaveBeenCalledTimes(1);
    expect(out).toEqual([fakeVec("cozy soup")]);
  });

  it("fails open on a KV write failure (vector still returned)", async () => {
    const { env } = cacheEnv(memKv({ failPut: true }));
    const out = await embedTextsCached(env, ["cozy soup"]);
    expect(out).toEqual([fakeVec("cozy soup")]);
  });

  it("treats a malformed cached value (bad JSON / wrong length) as a miss and re-embeds", async () => {
    const kv = memKv();
    kv.store.set(await embedCacheKey("bad json"), "{nope");
    kv.store.set(await embedCacheKey("short vec"), JSON.stringify([1, 2, 3]));
    const { env, ai } = cacheEnv(kv);
    const out = await embedTextsCached(env, ["bad json", "short vec"]);
    expect(ai).toHaveBeenCalledTimes(1);
    expect((ai.mock.calls[0][1] as { text: string[] }).text).toEqual(["bad json", "short vec"]);
    expect(out).toEqual([fakeVec("bad json"), fakeVec("short vec")]);
    // The malformed entries were overwritten with the fresh full-precision vectors.
    expect(JSON.parse(kv.store.get(await embedCacheKey("short vec"))!)).toEqual(fakeVec("short vec"));
  });

  it("an empty input makes no KV or AI touch", async () => {
    const { env, ai, kv } = cacheEnv();
    expect(await embedTextsCached(env, [])).toEqual([]);
    expect(ai).not.toHaveBeenCalled();
    expect(kv.puts).toHaveLength(0);
  });
});
