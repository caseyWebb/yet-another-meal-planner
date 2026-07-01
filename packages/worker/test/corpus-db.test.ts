import { describe, it, expect } from "vitest";
import { fakeD1 } from "./fake-d1.js";
import {
  readAliases,
  readResolver,
  addAliases,
  deleteAlias,
  enqueueNovelTerms,
  commitResolution,
  commitReconfirmEdges,
  readIdentityIds,
  readEmbeddinglessIds,
  writeIdentityEmbedding,
  readIdentityEmbeddings,
  mergeIdentities,
  readSkuCoResolutionPairs,
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

describe("ingredient identity / normalization (D1)", () => {
  it("reads variant→id and upserts into the identity + alias tables (lowercased, human)", async () => {
    const { env, tables } = fakeD1({
      tables: {
        ingredient_identity: [{ id: "olive oil", base: "olive oil", representative: null }],
        ingredient_alias: [{ variant: "evoo", id: "olive oil" }],
      },
    });
    expect(await readAliases(env)).toEqual({ evoo: "olive oil" });

    const n = await addAliases(env, [
      { variant: "EVOO", canonical: "extra virgin olive oil" }, // upsert, lowercased key
      { variant: "chx", canonical: "chicken" },
      { variant: "", canonical: "skip" }, // skipped (empty variant)
    ]);
    expect(n).toBe(2);
    expect(await readAliases(env)).toEqual({ evoo: "extra virgin olive oil", chx: "chicken" });
    // Both the front-door alias and the identity node are written, source='human'.
    expect(tables.ingredient_alias.map((r) => r.variant).sort()).toEqual(["chx", "evoo"]);
    expect(tables.ingredient_identity.some((r) => r.id === "chicken" && r.source === "human")).toBe(true);
  });

  it("resolves a variant through a representative (union-find) merge", async () => {
    const { env } = fakeD1({
      tables: {
        ingredient_identity: [
          { id: "scallion", base: "scallion", representative: "green onion" },
          { id: "green onion", base: "green onion", representative: null },
        ],
        ingredient_alias: [{ variant: "scallions", id: "scallion" }],
      },
    });
    const resolver = await readResolver(env);
    expect(resolver.toId["scallions"]).toBe("green onion"); // merged survivor
    expect(resolver.ids.has("green onion")).toBe(true);
    expect(resolver.ids.has("scallion")).toBe(false); // resolves away to its representative
  });

  it("deletes an alias by variant (case-insensitively), reporting whether a row went", async () => {
    const { env, tables } = fakeD1({
      tables: { ingredient_alias: [{ variant: "evoo", id: "olive oil" }] },
    });
    expect(await deleteAlias(env, "EVOO")).toBe(true);
    expect(await deleteAlias(env, "EVOO")).toBe(false); // already gone
    expect(tables.ingredient_alias).toHaveLength(0);
  });

  it("enqueues novel terms (insert-or-ignore, deduped, blanks dropped)", async () => {
    const { env, tables } = fakeD1({ tables: { novel_ingredient_terms: [] } });
    await enqueueNovelTerms(env, ["gochujang", "gochujang", "  "]);
    expect(tables.novel_ingredient_terms.map((r) => r.term)).toEqual(["gochujang"]);
    await enqueueNovelTerms(env, ["gochujang"]); // dup ignored
    expect(tables.novel_ingredient_terms).toHaveLength(1);
  });

  it("commitResolution mints a node + alias + edge, dequeues the term, and logs", async () => {
    const { env, tables } = fakeD1({
      tables: {
        ingredient_identity: [{ id: "ground beef", base: "ground beef", representative: null }],
        ingredient_alias: [],
        ingredient_edge: [],
        novel_ingredient_terms: [{ term: "80/20 ground beef", first_seen: 1 }],
        ingredient_normalization_log: [],
      },
    });
    await commitResolution(env, {
      term: "80/20 ground beef",
      id: "ground beef::fat-80-20",
      node: { base: "ground beef", detail: "fat-80-20", search_term: "80/20 ground beef", concrete: true, embedding: [0.1, 0.2] },
      edges: [{ from: "ground beef::fat-80-20", to: "ground beef", kind: "general" }],
      log: { term: "80/20 ground beef", outcome: "specialization", resolved_id: "ground beef::fat-80-20" },
    });
    expect(tables.ingredient_identity.some((r) => r.id === "ground beef::fat-80-20")).toBe(true);
    expect(tables.ingredient_alias).toContainEqual(
      expect.objectContaining({ variant: "80/20 ground beef", id: "ground beef::fat-80-20", source: "auto" }),
    );
    expect(tables.ingredient_edge).toHaveLength(1);
    expect(tables.novel_ingredient_terms).toHaveLength(0); // dequeued
    expect(tables.ingredient_normalization_log).toHaveLength(1);
    // The minted node is now resolvable and carries its Kroger search phrase.
    const resolver = await readResolver(env);
    expect(resolver.toId["80/20 ground beef"]).toBe("ground beef::fat-80-20");
    expect(resolver.searchTerms["ground beef::fat-80-20"]).toBe("80/20 ground beef");
  });

  it("commitResolution skips an edge whose REVERSE pair already exists (any kind), logging it", async () => {
    const { env, tables } = fakeD1({
      tables: {
        ingredient_identity: [
          { id: "whole cardamom pods", base: "whole cardamom pods", representative: null },
          { id: "ground cardamom", base: "ground cardamom", representative: null },
          { id: "cardamom", base: "cardamom", representative: null },
        ],
        ingredient_alias: [],
        ingredient_edge: [
          { from_id: "whole cardamom pods", to_id: "ground cardamom", kind: "containment" },
        ],
        novel_ingredient_terms: [{ term: "ground cardamom pods", first_seen: 1 }],
        ingredient_normalization_log: [],
      },
    });
    await commitResolution(env, {
      term: "ground cardamom pods",
      id: "ground cardamom",
      edges: [
        { from: "ground cardamom", to: "whole cardamom pods", kind: "general" }, // reverse of existing → skipped
        { from: "ground cardamom", to: "cardamom", kind: "general" }, // clean → kept
      ],
      log: { term: "ground cardamom pods", outcome: "same", resolved_id: "ground cardamom" },
    });
    expect(tables.ingredient_edge).toHaveLength(2); // the pre-existing edge + the one kept edge
    expect(tables.ingredient_edge).toContainEqual(
      expect.objectContaining({ from_id: "ground cardamom", to_id: "cardamom", kind: "general" }),
    );
    const detail = JSON.parse(String(tables.ingredient_normalization_log[0].detail));
    expect(detail.edges_skipped).toEqual([
      { from: "ground cardamom", to: "whole cardamom pods", kind: "general", reason: "reverse_exists" },
    ]);
  });

  it("commitResolution skips a same-batch reverse pair and a post-merge self-loop", async () => {
    const { env, tables } = fakeD1({
      tables: {
        ingredient_identity: [
          { id: "scallion", base: "scallion", representative: "green onion" }, // merged loser
          { id: "green onion", base: "green onion", representative: null },
          { id: "chive", base: "chive", representative: null },
        ],
        ingredient_alias: [],
        ingredient_edge: [],
        novel_ingredient_terms: [{ term: "spring onion", first_seen: 1 }],
        ingredient_normalization_log: [],
      },
    });
    await commitResolution(env, {
      term: "spring onion",
      id: "green onion",
      edges: [
        { from: "green onion", to: "chive", kind: "general" }, // kept
        { from: "chive", to: "green onion", kind: "membership" }, // reverse of the edge above → skipped
        { from: "scallion", to: "green onion", kind: "general" }, // scallion resolves to green onion → self-loop
      ],
      log: { term: "spring onion", outcome: "same", resolved_id: "green onion" },
    });
    expect(tables.ingredient_edge).toEqual([
      expect.objectContaining({ from_id: "green onion", to_id: "chive", kind: "general" }),
    ]);
    const detail = JSON.parse(String(tables.ingredient_normalization_log[0].detail));
    expect(detail.edges_skipped).toEqual([
      { from: "chive", to: "green onion", kind: "membership", reason: "reverse_exists" },
      { from: "scallion", to: "green onion", kind: "general", reason: "self_loop" },
    ]);
  });

  it("commitReconfirmEdges applies the same contradiction gate, folding skips into the log detail", async () => {
    const { env, tables } = fakeD1({
      tables: {
        ingredient_identity: [
          { id: "chicken::whole", base: "chicken", representative: null },
          { id: "chicken::thighs", base: "chicken", representative: null },
        ],
        ingredient_edge: [{ from_id: "chicken::whole", to_id: "chicken::thighs", kind: "containment" }],
        ingredient_normalization_log: [],
      },
    });
    await commitReconfirmEdges(env, {
      edges: [{ from: "chicken::thighs", to: "chicken::whole", kind: "general" }], // reverse → skipped
      log: { term: "chicken thighs", outcome: "novel", resolved_id: "chicken::thighs", isReconfirm: true },
    });
    expect(tables.ingredient_edge).toHaveLength(1); // nothing inserted
    const detail = JSON.parse(String(tables.ingredient_normalization_log[0].detail));
    expect(detail.edges_skipped).toEqual([
      { from: "chicken::thighs", to: "chicken::whole", kind: "general", reason: "reverse_exists" },
    ]);
  });

  it("readIdentityIds returns EVERY node id and alias variant (merged + unembedded included)", async () => {
    const { env } = fakeD1({
      tables: {
        ingredient_identity: [
          { id: "zucchini", base: "zucchini", representative: null, embedding: "[1]" },
          { id: "courgette", base: "courgette", representative: "zucchini" }, // merged loser
          { id: "saffron", base: "saffron", representative: null }, // no embedding
        ],
        // a standing variant→node row shadows any later node minted under the same name — it
        // must be in the collision set even though "scallion" is not itself a node id
        ingredient_alias: [{ variant: "scallion", id: "zucchini" }],
      },
    });
    expect(await readIdentityIds(env)).toEqual(new Set(["zucchini", "courgette", "saffron", "scallion"]));
  });

  it("readEmbeddinglessIds returns only unembedded SURVIVORS, oldest first, bounded", async () => {
    const { env } = fakeD1({
      tables: {
        ingredient_identity: [
          { id: "zucchini", base: "zucchini", representative: null, embedding: "[1]", decided_at: 1 },
          { id: "courgette", base: "courgette", representative: "zucchini", decided_at: 2 }, // merged → excluded
          { id: "saffron", base: "saffron", representative: null, decided_at: 4 },
          { id: "sumac", base: "sumac", representative: null, decided_at: 3 },
        ],
      },
    });
    expect(await readEmbeddinglessIds(env, 10)).toEqual(["sumac", "saffron"]); // oldest decided_at first
    expect(await readEmbeddinglessIds(env, 1)).toEqual(["sumac"]); // bounded
  });

  it("writeIdentityEmbedding stores the vector so the node joins the retrieval read", async () => {
    const { env, tables } = fakeD1({
      tables: {
        ingredient_identity: [{ id: "saffron", base: "saffron", representative: null, embedding: null }],
      },
    });
    await writeIdentityEmbedding(env, "saffron", [0.1, 0.2]);
    expect(tables.ingredient_identity[0].embedding).toBe("[0.1,0.2]");
    expect(await readIdentityEmbeddings(env)).toEqual([{ id: "saffron", embedding: [0.1, 0.2] }]);
  });

  it("mergeIdentities points the loser at the survivor (union-find), logging the merge", async () => {
    const { env, tables } = fakeD1({
      tables: {
        ingredient_identity: [
          { id: "courgette", base: "courgette", representative: null },
          { id: "zucchini", base: "zucchini", representative: null },
        ],
        ingredient_alias: [{ variant: "courgette", id: "courgette" }],
        ingredient_normalization_log: [],
      },
    });
    await mergeIdentities(env, "courgette", "zucchini");
    const resolver = await readResolver(env);
    expect(resolver.toId["courgette"]).toBe("zucchini"); // resolves through the representative pointer
    expect(tables.ingredient_normalization_log[0]).toMatchObject({ outcome: "merge", resolved_id: "zucchini" });
  });

  it("readSkuCoResolutionPairs groups distinct survivors sharing a SKU (with source + search_term)", async () => {
    const { env } = fakeD1({
      tables: {
        ingredient_identity: [
          { id: "courgette", base: "courgette", representative: null, source: "human", search_term: "courgette" },
          { id: "zucchini", base: "zucchini", representative: null, source: "auto", search_term: null },
        ],
        sku_cache: [
          { ingredient: "courgette", location_id: "035", sku: "SKU-A" },
          { ingredient: "zucchini", location_id: "070", sku: "SKU-A" }, // same SKU, different location → still a pair
        ],
      },
    });
    const pairs = await readSkuCoResolutionPairs(env, 10);
    expect(pairs).toEqual([
      { a: "courgette", b: "zucchini", sku: "SKU-A", aSource: "human", bSource: "auto", aTerm: "courgette" },
    ]);
  });

  it("readSkuCoResolutionPairs ignores a SKU mapped by only one id", async () => {
    const { env } = fakeD1({
      tables: {
        ingredient_identity: [{ id: "milk", base: "milk", representative: null, source: "auto", search_term: null }],
        sku_cache: [
          { ingredient: "milk", location_id: "035", sku: "SKU-A" },
          { ingredient: "milk", location_id: "070", sku: "SKU-A" }, // same id twice → not a pair
        ],
      },
    });
    expect(await readSkuCoResolutionPairs(env, 10)).toEqual([]);
  });

  it("readSkuCoResolutionPairs collapses already-merged ids to one survivor (not re-proposed)", async () => {
    const { env } = fakeD1({
      tables: {
        ingredient_identity: [
          { id: "scallion", base: "scallion", representative: "green onion", source: "auto", search_term: null },
          { id: "green onion", base: "green onion", representative: null, source: "auto", search_term: null },
        ],
        sku_cache: [
          { ingredient: "scallion", location_id: "035", sku: "SKU-A" },
          { ingredient: "green onion", location_id: "035", sku: "SKU-A" }, // both resolve to green onion
        ],
      },
    });
    // scallion resolves through its representative to green onion → one survivor → no pair.
    expect(await readSkuCoResolutionPairs(env, 10)).toEqual([]);
  });

  it("readSkuCoResolutionPairs caps the returned pairs at the limit", async () => {
    const { env } = fakeD1({
      tables: {
        ingredient_identity: [
          { id: "a", base: "a", representative: null, source: "auto", search_term: null },
          { id: "b", base: "b", representative: null, source: "auto", search_term: null },
          { id: "c", base: "c", representative: null, source: "auto", search_term: null },
        ],
        // Three distinct survivors on one SKU → three unordered pairs (a-b, a-c, b-c); cap at 2.
        sku_cache: [
          { ingredient: "a", location_id: "", sku: "SKU-A" },
          { ingredient: "b", location_id: "", sku: "SKU-A" },
          { ingredient: "c", location_id: "", sku: "SKU-A" },
        ],
      },
    });
    const pairs = await readSkuCoResolutionPairs(env, 2);
    expect(pairs).toHaveLength(2);
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
