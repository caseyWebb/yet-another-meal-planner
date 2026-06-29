import { describe, it, expect } from "vitest";
import { fakeD1 } from "./fake-d1.js";
import {
  readAliases,
  addAliases,
  deleteAlias,
  readSkuCache,
  upsertSkuMappings,
  readFlyerTerms,
  addFlyerTerms,
  deleteFlyerTerm,
  readFeeds,
  addFeedRows,
  deleteFeed,
  readAllowlist,
  addSourceRows,
  deleteSender,
  deleteMember,
  readDiscoveryInbox,
  insertDiscoveryCandidate,
  readDiscoveryRejections,
  addDiscoveryRejection,
} from "../src/corpus-db.js";

describe("aliases (D1)", () => {
  it("reads variant→canonical and upserts by variant", async () => {
    const { env, tables } = fakeD1({ tables: { aliases: [{ variant: "EVOO", canonical: "olive oil" }] } });
    expect(await readAliases(env)).toEqual({ EVOO: "olive oil" });

    const n = await addAliases(env, [
      { variant: "EVOO", canonical: "extra virgin olive oil" }, // upsert
      { variant: "chx", canonical: "chicken" },
      { variant: "", canonical: "skip" }, // skipped (empty variant)
    ]);
    expect(n).toBe(2);
    expect(await readAliases(env)).toEqual({ EVOO: "extra virgin olive oil", chx: "chicken" });
    expect(tables.aliases).toHaveLength(2);
  });

  it("deletes an alias by variant, reporting whether a row went", async () => {
    const { env, tables } = fakeD1({ tables: { aliases: [{ variant: "EVOO", canonical: "olive oil" }] } });
    expect(await deleteAlias(env, "EVOO")).toBe(true);
    expect(await deleteAlias(env, "EVOO")).toBe(false); // already gone
    expect(tables.aliases).toHaveLength(0);
  });
});

describe("sku_cache (D1)", () => {
  it("reads as CachedMapping[] with '' location → absent", async () => {
    const { env } = fakeD1({
      tables: {
        sku_cache: [
          { ingredient: "milk", location_id: "", sku: "111", brand: "Kroger", size: "1 gal" },
          { ingredient: "salmon", location_id: "035", sku: "222", brand: null, size: null },
        ],
      },
    });
    const cache = await readSkuCache(env);
    expect(cache).toContainEqual({ ingredient: "milk", sku: "111", brand: "Kroger", size: "1 gal" });
    expect(cache).toContainEqual({ ingredient: "salmon", sku: "222", locationId: "035" });
  });

  it("upserts keyed (ingredient, location_id)", async () => {
    const { env, tables } = fakeD1({ tables: { sku_cache: [] } });
    await upsertSkuMappings(env, [
      { ingredient: "milk", sku: "111", locationId: "035", last_used: "2026-06-01" },
      { ingredient: "milk", sku: "999", locationId: "035", last_used: "2026-06-02" }, // overwrite
      { ingredient: "milk", sku: "111", locationId: "", last_used: "2026-06-01" }, // distinct key
    ]);
    expect(tables.sku_cache).toHaveLength(2);
    const at035 = tables.sku_cache.find((r) => r.location_id === "035");
    expect(at035?.sku).toBe("999");
  });
});

describe("flyer terms / feeds (D1)", () => {
  it("reads flyer terms", async () => {
    const { env } = fakeD1({ tables: { flyer_terms: [{ term: "fruit" }, { term: "cheese" }] } });
    expect((await readFlyerTerms(env)).sort()).toEqual(["cheese", "fruit"]);
  });

  it("adds flyer terms (trim, dedup) and deletes by term", async () => {
    const { env, tables } = fakeD1({ tables: { flyer_terms: [{ term: "fruit" }] } });
    const added = await addFlyerTerms(env, ["fruit", "  cheese  ", "", "cheese"]); // dup + trim + empty skip
    expect(added).toBe(1);
    expect((await readFlyerTerms(env)).sort()).toEqual(["cheese", "fruit"]);
    expect(await deleteFlyerTerm(env, "fruit")).toBe(true);
    expect(await deleteFlyerTerm(env, "fruit")).toBe(false);
    expect(tables.flyer_terms.map((r) => r.term)).toEqual(["cheese"]);
  });

  it("reads feeds and add-only-dedups by url", async () => {
    const { env } = fakeD1({
      tables: { feeds: [{ url: "https://a.com", name: "A", weight: 1, tags: '["x"]' }] },
    });
    const feeds = await readFeeds(env);
    expect(feeds[0]).toEqual({ url: "https://a.com", name: "A", weight: 1, tags: ["x"] });
    const added = await addFeedRows(env, [
      { url: "https://a.com" }, // dup → skipped
      { url: "https://b.com", tags: ["y"] },
    ]);
    expect(added).toBe(1);
    expect((await readFeeds(env)).map((f) => f.url).sort()).toEqual(["https://a.com", "https://b.com"]);
  });

  it("deletes a feed by url", async () => {
    const { env, tables } = fakeD1({ tables: { feeds: [{ url: "https://a.com", name: "A", weight: 1, tags: null }] } });
    expect(await deleteFeed(env, "https://a.com")).toBe(true);
    expect(await deleteFeed(env, "https://a.com")).toBe(false);
    expect(tables.feeds).toHaveLength(0);
  });

  it("rejects a non-public feed url at write time, storing nothing (outbound-fetch-safety)", async () => {
    for (const bad of [
      "http://127.0.0.1/feed.xml",
      "http://169.254.169.254/",
      "file:///etc/passwd",
      "http://admin:pw@example.com/feed",
      "http://localhost:8080/rss",
    ]) {
      const { env, tables } = fakeD1({ tables: { feeds: [] } });
      // Atomic: a good url in the same batch is NOT stored when another is rejected.
      await expect(addFeedRows(env, [{ url: "https://good.example/rss" }, { url: bad }])).rejects.toMatchObject({
        code: "validation_failed",
      });
      expect(tables.feeds).toHaveLength(0);
    }
  });

  it("stores a valid public feed url", async () => {
    const { env } = fakeD1({ tables: { feeds: [] } });
    expect(await addFeedRows(env, [{ url: "https://fresh.example/rss" }])).toBe(1);
    expect((await readFeeds(env)).map((f) => f.url)).toEqual(["https://fresh.example/rss"]);
  });
});

describe("discovery allowlist + inbox (D1)", () => {
  it("reads allowlist and add-dedups normalized addresses", async () => {
    const { env } = fakeD1({ tables: { discovery_members: [{ address: "me@x.com" }], discovery_senders: [] } });
    const al = await readAllowlist(env);
    expect(al.members.has("me@x.com")).toBe(true);
    const added = await addSourceRows(env, {
      members: [{ address: "Me@X.com" }, { address: "you@x.com" }], // first is dup after normalize
      senders: [{ address: "n@news.com", name: "News" }, { address: "notanaddress" }],
    });
    expect(added).toEqual({ members: 1, senders: 1 });
    const al2 = await readAllowlist(env);
    expect([...al2.members].sort()).toEqual(["me@x.com", "you@x.com"]);
    expect(al2.senders.has("n@news.com")).toBe(true);
  });

  it("deletes a member/sender by address, normalizing the key to match storage", async () => {
    const { env, tables } = fakeD1({
      tables: { discovery_members: [{ address: "me@x.com" }], discovery_senders: [{ address: "n@news.com", name: "News" }] },
    });
    // The stored row is normalized; a mixed-case/whitespace delete key must still hit it.
    expect(await deleteMember(env, "  Me@X.com ")).toBe(true);
    expect(await deleteMember(env, "me@x.com")).toBe(false);
    expect(await deleteSender(env, "N@News.com")).toBe(true);
    expect(tables.discovery_members).toHaveLength(0);
    expect(tables.discovery_senders).toHaveLength(0);
  });

  it("inserts inbox candidates deduped by UNIQUE url", async () => {
    const { env } = fakeD1({ tables: { discovery_candidates: [] } });
    const cand = { url: "u1", from: "a@x.com", subject: "hi", body: "find recipes", received_at: "2026-06-11" };
    expect(await insertDiscoveryCandidate(env, cand)).toBe(true);
    expect(await insertDiscoveryCandidate(env, cand)).toBe(false); // dup url → not written
    const inbox = await readDiscoveryInbox(env);
    expect(inbox).toEqual([
      { from: "a@x.com", subject: "hi", received_at: "2026-06-11", body: "find recipes" },
    ]);
  });

  it("suppresses group-rejected candidates from the inbox (canonical match)", async () => {
    const { env, tables } = fakeD1({ tables: { discovery_candidates: [], discovery_rejections: [] } });
    await insertDiscoveryCandidate(env, {
      url: "https://seriouseats.com/recipe?utm=x", // tracker-wrapped
      from: "a@x.com",
      subject: "junk",
      body: "b1",
      received_at: "2026-06-11",
    });
    await insertDiscoveryCandidate(env, {
      url: "https://good.com/keep",
      from: "b@x.com",
      subject: "keep",
      body: "b2",
      received_at: "2026-06-12",
    });
    // Reject the CANONICAL form; the tracker-wrapped candidate must still be dropped.
    await addDiscoveryRejection(env, {
      url: "https://seriouseats.com/recipe",
      reason: "not a recipe",
      rejectedBy: "alice",
      rejectedAt: "2026-06-13",
    });
    expect([...(await readDiscoveryRejections(env))]).toEqual(["https://seriouseats.com/recipe"]);
    const inbox = await readDiscoveryInbox(env);
    expect(inbox.map((e) => e.subject)).toEqual(["keep"]);
    expect(tables.discovery_rejections).toHaveLength(1);
  });

  it("upserts a rejection idempotently on the canonical url", async () => {
    const { env, tables } = fakeD1({ tables: { discovery_rejections: [] } });
    await addDiscoveryRejection(env, { url: "https://x.com/r", reason: "junk", rejectedBy: "a", rejectedAt: "2026-06-01" });
    await addDiscoveryRejection(env, { url: "https://x.com/r", reason: "dup", rejectedBy: "b", rejectedAt: "2026-06-02" });
    expect(tables.discovery_rejections).toHaveLength(1);
    expect(tables.discovery_rejections[0].reason).toBe("dup");
    expect(tables.discovery_rejections[0].rejected_by).toBe("b");
  });
});
