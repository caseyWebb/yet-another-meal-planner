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
  readAliasAuditBatch,
  stampAliasAudited,
  readAliasTargets,
  readIdentitySources,
  readEdgeAuditBatch,
  readAllEdges,
  deleteIngredientEdge,
  stampEdgeAudited,
  appendNormalizationLog,
  readCoResolutionRejections,
  upsertCoResolutionRejection,
  repairSegmentOverflow,
  applyDisjunctionRepair,
  readConceptIds,
  insertAuditedEdge,
  readUnreplayedEdgeDrops,
  markEdgeDropReplayed,
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

  it("commitResolution born-stamps audited_at on the alias + edge rows it writes", async () => {
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
      node: { base: "ground beef", detail: "fat-80-20", search_term: "80/20 ground beef", concrete: true, embedding: [0.1] },
      edges: [{ from: "ground beef::fat-80-20", to: "ground beef", kind: "general" }],
      log: { term: "80/20 ground beef", outcome: "specialization", resolved_id: "ground beef::fat-80-20" },
    });
    // Born-audited: post-hardening decisions never enter the re-audit backlog.
    expect(typeof tables.ingredient_alias[0].audited_at).toBe("number");
    expect(typeof tables.ingredient_edge[0].audited_at).toBe("number");
  });

  it("commitReconfirmEdges born-stamps audited_at on the edges it inserts", async () => {
    const { env, tables } = fakeD1({
      tables: {
        ingredient_identity: [
          { id: "kielbasa", base: "kielbasa", representative: null },
          { id: "sausage", base: "sausage", representative: null },
        ],
        ingredient_edge: [],
        ingredient_normalization_log: [],
      },
    });
    await commitReconfirmEdges(env, {
      edges: [{ from: "kielbasa", to: "sausage", kind: "general" }],
      log: { term: "kielbasa", outcome: "novel", resolved_id: "kielbasa", isReconfirm: true },
    });
    expect(typeof tables.ingredient_edge[0].audited_at).toBe("number");
  });

  it("readAliasAuditBatch selects only auto + un-stamped mappings, oldest decided first, bounded", async () => {
    const { env } = fakeD1({
      tables: {
        ingredient_alias: [
          { variant: "flaky sea salt", id: "fish sauce::type-sea-salt", source: "auto", decided_at: 30, audited_at: null },
          { variant: "sesame seeds", id: "toasted sesame seeds::toast", source: "auto", decided_at: 10, audited_at: null },
          // excluded: human mapping (authoritative — never re-audited)
          { variant: "evoo", id: "olive oil", source: "human", decided_at: 5, audited_at: null },
          // excluded: already stamped (born-audited or a previous audit tick)
          { variant: "scallions", id: "green onion", source: "auto", decided_at: 1, audited_at: 999 },
        ],
      },
    });
    const batch = await readAliasAuditBatch(env, 10);
    // The fake D1 returns whole rows (no column projection) — compare the selected fields.
    expect(batch.map((r) => ({ variant: r.variant, id: r.id }))).toEqual([
      { variant: "sesame seeds", id: "toasted sesame seeds::toast" },
      { variant: "flaky sea salt", id: "fish sauce::type-sea-salt" },
    ]);
    expect(await readAliasAuditBatch(env, 1)).toHaveLength(1);
  });

  it("stampAliasAudited stamps exactly the given variant; readAliasTargets sees every mapping", async () => {
    const { env, tables } = fakeD1({
      tables: {
        ingredient_alias: [
          { variant: "a", id: "x", source: "auto", decided_at: 1, audited_at: null },
          { variant: "b", id: "y", source: "human", decided_at: 2, audited_at: null },
        ],
      },
    });
    await stampAliasAudited(env, "a", 777);
    expect(tables.ingredient_alias.find((r) => r.variant === "a")?.audited_at).toBe(777);
    expect(tables.ingredient_alias.find((r) => r.variant === "b")?.audited_at).toBeNull();
    expect((await readAliasTargets(env)).map((r) => ({ variant: r.variant, id: r.id }))).toEqual([
      { variant: "a", id: "x" },
      { variant: "b", id: "y" },
    ]);
  });

  it("readIdentitySources normalizes source; readEdgeAuditBatch/readAllEdges cover the edge audit reads", async () => {
    const { env } = fakeD1({
      tables: {
        ingredient_identity: [
          { id: "zucchini", base: "zucchini", representative: null, source: "human" },
          { id: "courgette", base: "courgette", representative: "zucchini", source: null }, // null → auto
        ],
        ingredient_edge: [
          { from_id: "a", to_id: "b", kind: "general", source: "auto", decided_at: 20, audited_at: null },
          { from_id: "c", to_id: "d", kind: "containment", source: "auto", decided_at: 10, audited_at: null },
          // excluded from the batch: human edge + stamped edge (both still in readAllEdges)
          { from_id: "e", to_id: "f", kind: "general", source: "human", decided_at: 1, audited_at: null },
          { from_id: "g", to_id: "h", kind: "general", source: "auto", decided_at: 2, audited_at: 111 },
        ],
      },
    });
    expect(await readIdentitySources(env)).toEqual([
      { id: "zucchini", representative: null, source: "human" },
      { id: "courgette", representative: "zucchini", source: "auto" },
    ]);
    expect((await readEdgeAuditBatch(env, 10)).map((e) => e.from_id)).toEqual(["c", "a"]);
    expect((await readEdgeAuditBatch(env, 1)).map((e) => e.from_id)).toEqual(["c"]);
    expect(await readAllEdges(env)).toHaveLength(4);
    expect((await readAllEdges(env)).find((e) => e.from_id === "e")?.source).toBe("human");
  });

  it("deleteIngredientEdge/stampEdgeAudited address exactly one composite-PK row", async () => {
    const { env, tables } = fakeD1({
      tables: {
        ingredient_edge: [
          { from_id: "a", to_id: "b", kind: "general", source: "auto", audited_at: null },
          { from_id: "a", to_id: "b", kind: "containment", source: "auto", audited_at: null }, // same pair, other kind
          { from_id: "b", to_id: "a", kind: "general", source: "auto", audited_at: null }, // the reverse
        ],
      },
    });
    await deleteIngredientEdge(env, "a", "b", "general");
    expect(tables.ingredient_edge).toHaveLength(2); // only the exact (from,to,kind) row went
    await stampEdgeAudited(env, "b", "a", "general", 555);
    expect(tables.ingredient_edge.find((r) => r.from_id === "b")?.audited_at).toBe(555);
    expect(tables.ingredient_edge.find((r) => r.kind === "containment")?.audited_at).toBeNull();
  });

  it("appendNormalizationLog writes a standalone (edge-audit-shaped) decision row", async () => {
    const { env, tables } = fakeD1({ tables: { ingredient_normalization_log: [] } });
    await appendNormalizationLog(env, {
      term: "spaghetti -[general]-> rigatoni",
      outcome: "edge_drop",
      model: "m",
      detail: { audit: "edge", direction: "neither" },
    });
    expect(tables.ingredient_normalization_log).toHaveLength(1);
    expect(tables.ingredient_normalization_log[0]).toMatchObject({ outcome: "edge_drop", model: "m" });
    expect(JSON.parse(String(tables.ingredient_normalization_log[0].detail))).toEqual({
      audit: "edge",
      direction: "neither",
    });
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

  it("mergeIdentities refuses a merge that would close a representative cycle, logging the skip", async () => {
    // Direct: an older merge already points scallion at green onion; merging green onion INTO
    // scallion would close the cycle — the choke point every pass uses refuses and logs instead.
    const direct = fakeD1({
      tables: {
        ingredient_identity: [
          { id: "scallion", base: "scallion", representative: "green onion" },
          { id: "green onion", base: "green onion", representative: null },
        ],
        ingredient_normalization_log: [],
      },
    });
    await mergeIdentities(direct.env, "green onion", "scallion");
    expect(direct.tables.ingredient_identity.find((r) => r.id === "green onion")?.representative).toBeNull();
    expect(direct.tables.ingredient_normalization_log).toHaveLength(1);
    expect(direct.tables.ingredient_normalization_log[0]).toMatchObject({
      term: "green onion",
      outcome: "merge",
      resolved_id: "scallion",
    });
    expect(JSON.parse(String(direct.tables.ingredient_normalization_log[0].detail))).toMatchObject({
      note: "merge_cycle_skip",
    });

    // Transitive: a → b → c; merging c into a would spin the chain — refused the same way.
    const transitive = fakeD1({
      tables: {
        ingredient_identity: [
          { id: "a", base: "a", representative: "b" },
          { id: "b", base: "b", representative: "c" },
          { id: "c", base: "c", representative: null },
        ],
        ingredient_normalization_log: [],
      },
    });
    await mergeIdentities(transitive.env, "c", "a");
    expect(transitive.tables.ingredient_identity.find((r) => r.id === "c")?.representative).toBeNull();
    expect(
      JSON.parse(String(transitive.tables.ingredient_normalization_log[0].detail)),
    ).toMatchObject({ note: "merge_cycle_skip" });
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
      {
        a: "courgette",
        b: "zucchini",
        sku: "SKU-A",
        aSource: "human",
        bSource: "auto",
        aConcrete: true,
        bConcrete: true,
        aTerm: "courgette",
      },
    ]);
  });

  it("readSkuCoResolutionPairs carries each survivor's concrete flag (the concept–concrete guard's input)", async () => {
    const { env } = fakeD1({
      tables: {
        ingredient_identity: [
          { id: "jalapenos", base: "jalapenos", representative: null, source: "auto", search_term: null, concrete: 1 },
          {
            id: "white or yellow onion",
            base: "white or yellow onion",
            representative: null,
            source: "auto",
            search_term: "white onion",
            concrete: 0,
          },
        ],
        sku_cache: [
          { ingredient: "jalapenos", location_id: "035", sku: "SKU-B" },
          { ingredient: "white or yellow onion", location_id: "035", sku: "SKU-B" },
        ],
      },
    });
    const pairs = await readSkuCoResolutionPairs(env, 10);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ aConcrete: true, bConcrete: false });
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

describe("normalization audit calibration (D1)", () => {
  it("upsertCoResolutionRejection inserts, refreshes on conflict, and reads back", async () => {
    const { env, tables } = fakeD1({ tables: { ingredient_coresolution_rejection: [] } });
    await upsertCoResolutionRejection(env, "parmesan", "pecorino romano", 1000);
    expect(await readCoResolutionRejections(env)).toEqual([
      { a: "parmesan", b: "pecorino romano", decided_at: 1000 },
    ]);
    await upsertCoResolutionRejection(env, "parmesan", "pecorino romano", 2000); // refresh
    expect(tables.ingredient_coresolution_rejection).toHaveLength(1);
    expect(tables.ingredient_coresolution_rejection[0].decided_at).toBe(2000);
  });

  it("repairSegmentOverflow REROOT clears the prefix's representative and points the overflow, logged", async () => {
    const OV = "salmon fillets, skin-on::species-atlantic-sockeye::species-atlantic-sockeye";
    const PREFIX = "salmon fillets, skin-on::species-atlantic-sockeye";
    const { env, tables } = fakeD1({
      tables: {
        ingredient_identity: [
          { id: OV, base: "salmon fillets, skin-on", representative: null, source: "auto" },
          { id: PREFIX, base: "salmon fillets, skin-on", representative: OV, source: "auto" },
        ],
        ingredient_normalization_log: [],
      },
    });
    await repairSegmentOverflow(env, { overflow: OV, prefix: PREFIX, shape: "reroot" });
    const byId = new Map(tables.ingredient_identity.map((r) => [r.id, r]));
    expect(byId.get(PREFIX)?.representative).toBeNull();
    expect(byId.get(OV)?.representative).toBe(PREFIX);
    const log = tables.ingredient_normalization_log[0];
    expect(log).toMatchObject({ term: OV, outcome: "merge", resolved_id: PREFIX });
    expect(JSON.parse(String(log.detail))).toMatchObject({ note: "segment_overflow", reroot: true });
  });

  it("repairSegmentOverflow MINT inserts the missing prefix (embedding NULL) and points the overflow", async () => {
    const OV = "a::b::c";
    const { env, tables } = fakeD1({
      tables: {
        ingredient_identity: [{ id: OV, base: "a", representative: null, source: "auto" }],
        ingredient_normalization_log: [],
      },
    });
    await repairSegmentOverflow(env, {
      overflow: OV,
      prefix: "a::b",
      shape: "mint",
      prefixNode: { base: "a", detail: "b", search_term: "a b", concrete: true },
    });
    const prefix = tables.ingredient_identity.find((r) => r.id === "a::b");
    expect(prefix).toMatchObject({ base: "a", detail: "b", search_term: "a b", concrete: 1, source: "auto" });
    expect(prefix?.embedding ?? null).toBeNull(); // the capture backfill embeds it
    expect(tables.ingredient_identity.find((r) => r.id === OV)?.representative).toBe("a::b");
    expect(JSON.parse(String(tables.ingredient_normalization_log[0].detail))).toMatchObject({
      note: "segment_overflow",
      minted_prefix: true,
    });
  });

  it("applyDisjunctionRepair FLIP turns a concrete disjunction node abstract with a member search_term, logged reshape", async () => {
    const { env, tables } = fakeD1({
      tables: {
        ingredient_identity: [
          { id: "white or yellow onion", base: "white or yellow onion", representative: null, source: "auto", concrete: 1, search_term: "white or yellow onion" },
        ],
        ingredient_normalization_log: [],
      },
    });
    await applyDisjunctionRepair(env, {
      base: "white or yellow onion",
      searchTerm: "white onion",
      mintBase: false,
      reroot: false,
      flip: true,
      children: [],
    });
    expect(tables.ingredient_identity[0]).toMatchObject({ concrete: 0, search_term: "white onion" });
    const log = tables.ingredient_normalization_log[0];
    expect(log).toMatchObject({ term: "white or yellow onion", outcome: "reshape", resolved_id: "white or yellow onion" });
    expect(JSON.parse(String(log.detail))).toMatchObject({ note: "disjunction_flip", search_term: "white onion" });
  });

  it("applyDisjunctionRepair FOLD flips the base and points the child at it, logged merge", async () => {
    const BASE = "anaheim or cubanelle peppers";
    const CHILD = "anaheim or cubanelle peppers::form-roasted";
    const { env, tables } = fakeD1({
      tables: {
        ingredient_identity: [
          { id: BASE, base: BASE, representative: null, source: "auto", concrete: 1 },
          { id: CHILD, base: BASE, representative: null, source: "auto", concrete: 1 },
        ],
        ingredient_normalization_log: [],
      },
    });
    await applyDisjunctionRepair(env, {
      base: BASE,
      searchTerm: "anaheim peppers",
      mintBase: false,
      reroot: false,
      flip: true,
      children: [CHILD],
    });
    const byId = new Map(tables.ingredient_identity.map((r) => [r.id, r]));
    expect(byId.get(BASE)).toMatchObject({ concrete: 0, search_term: "anaheim peppers", representative: null });
    expect(byId.get(CHILD)?.representative).toBe(BASE);
    expect(tables.ingredient_normalization_log.map((l) => l.outcome)).toEqual(["reshape", "merge"]);
    const fold = tables.ingredient_normalization_log[1];
    expect(fold).toMatchObject({ term: CHILD, outcome: "merge", resolved_id: BASE });
    expect(JSON.parse(String(fold.detail))).toMatchObject({ note: "disjunction_child_fold" });
  });

  it("applyDisjunctionRepair REROOT re-roots the inverted serrano family at the abstract base", async () => {
    const BASE = "serrano or jalapeño peppers";
    const CHILD = "serrano or jalapeño peppers::form-diced";
    const { env, tables } = fakeD1({
      tables: {
        ingredient_identity: [
          { id: BASE, base: BASE, representative: CHILD, source: "auto", concrete: 1, search_term: BASE },
          { id: CHILD, base: BASE, representative: null, source: "auto", concrete: 1, search_term: "diced jalapeños" },
        ],
        ingredient_normalization_log: [],
      },
    });
    await applyDisjunctionRepair(env, {
      base: BASE,
      searchTerm: "serrano peppers",
      mintBase: false,
      reroot: true,
      flip: true,
      children: [CHILD],
    });
    const byId = new Map(tables.ingredient_identity.map((r) => [r.id, r]));
    expect(byId.get(BASE)).toMatchObject({ representative: null, concrete: 0, search_term: "serrano peppers" });
    expect(byId.get(CHILD)?.representative).toBe(BASE);
    const reshape = tables.ingredient_normalization_log[0];
    expect(JSON.parse(String(reshape.detail))).toMatchObject({ note: "disjunction_flip", reroot: true });
    expect(tables.ingredient_normalization_log.map((l) => l.outcome)).toEqual(["reshape", "merge"]);
  });

  it("applyDisjunctionRepair MINT-BASE inserts the abstract base (embedding NULL) and points the orphan child", async () => {
    const BASE = "serrano or jalapeño peppers";
    const CHILD = "serrano or jalapeño peppers::form-diced";
    const { env, tables } = fakeD1({
      tables: {
        ingredient_identity: [{ id: CHILD, base: BASE, representative: null, source: "auto", concrete: 1 }],
        ingredient_normalization_log: [],
      },
    });
    await applyDisjunctionRepair(env, {
      base: BASE,
      searchTerm: "serrano peppers",
      mintBase: true,
      reroot: false,
      flip: false,
      children: [CHILD],
    });
    const minted = tables.ingredient_identity.find((r) => r.id === BASE);
    expect(minted).toMatchObject({ base: BASE, search_term: "serrano peppers", concrete: 0, source: "auto" });
    expect(minted?.embedding ?? null).toBeNull(); // the capture backfill embeds it
    expect(tables.ingredient_identity.find((r) => r.id === CHILD)?.representative).toBe(BASE);
    const fold = tables.ingredient_normalization_log[0];
    expect(fold).toMatchObject({ term: CHILD, outcome: "merge", resolved_id: BASE });
    expect(JSON.parse(String(fold.detail))).toMatchObject({ note: "disjunction_child_fold", minted_base: true });
  });

  it("applyDisjunctionRepair FOLD + membership edge: the folded family's member edge lands born-stamped", async () => {
    const BASE = "white or yellow onion";
    const { env, tables } = fakeD1({
      tables: {
        ingredient_identity: [
          { id: BASE, base: BASE, representative: null, source: "auto", concrete: 1 },
          { id: "white onion", base: "white onion", representative: null, source: "auto", concrete: 1 },
        ],
        ingredient_edge: [],
        ingredient_normalization_log: [],
      },
    });
    await applyDisjunctionRepair(env, { base: BASE, searchTerm: "white onion", mintBase: false, reroot: false, flip: true, children: [] });
    await insertAuditedEdge(env, "white onion", BASE, "membership");
    expect(tables.ingredient_edge).toHaveLength(1);
    expect(tables.ingredient_edge[0]).toMatchObject({ from_id: "white onion", to_id: BASE, kind: "membership", source: "auto" });
    expect(tables.ingredient_edge[0].audited_at).not.toBeNull(); // born-stamped, never enters the audit backlog
  });

  it("readConceptIds returns exactly the concrete=0 ids", async () => {
    const { env } = fakeD1({
      tables: {
        ingredient_identity: [
          { id: "white or yellow onion", base: "white or yellow onion", representative: null, source: "auto", concrete: 0 },
          { id: "peppers", base: "peppers", representative: null, source: "auto", concrete: 0 },
          { id: "jalapenos", base: "jalapenos", representative: null, source: "auto", concrete: 1 },
          { id: "onions", base: "onions", representative: null, source: "auto" },
        ],
      },
    });
    expect(await readConceptIds(env)).toEqual(new Set(["white or yellow onion", "peppers"]));
  });

  it("insertAuditedEdge born-stamps, is insert-or-ignore, and can mint a missing base", async () => {
    const { env, tables } = fakeD1({
      tables: { ingredient_edge: [], ingredient_identity: [] },
    });
    await insertAuditedEdge(env, "rotel (original)::heat-mild", "rotel (original)", "general", {
      mintBase: { id: "rotel (original)" },
    });
    expect(tables.ingredient_edge).toHaveLength(1);
    expect(tables.ingredient_edge[0]).toMatchObject({
      from_id: "rotel (original)::heat-mild",
      to_id: "rotel (original)",
      kind: "general",
      source: "auto",
    });
    expect(tables.ingredient_edge[0].audited_at).not.toBeNull(); // born-stamped
    expect(tables.ingredient_identity[0]).toMatchObject({ id: "rotel (original)", base: "rotel (original)", concrete: 1 });
    // Idempotent: a re-insert (and a re-mint) is ignored.
    await insertAuditedEdge(env, "rotel (original)::heat-mild", "rotel (original)", "general");
    expect(tables.ingredient_edge).toHaveLength(1);
  });

  it("readUnreplayedEdgeDrops selects only un-marked edge_drop rows, oldest first, bounded", async () => {
    const { env } = fakeD1({
      tables: {
        ingredient_normalization_log: [
          { id: 3, term: "c -[general]-> d", outcome: "edge_drop", detail: JSON.stringify({ direction: "neither" }) },
          { id: 1, term: "a -[general]-> b", outcome: "edge_drop", detail: JSON.stringify({ note: "self_loop" }) },
          { id: 2, term: "x -[general]-> y", outcome: "edge_drop", detail: JSON.stringify({ replayed_at: 500 }) }, // marked
          { id: 4, term: "kept", outcome: "edge_keep", detail: null }, // wrong outcome
          { id: 5, term: "e -[membership]-> f", outcome: "edge_drop", detail: null }, // no detail = un-marked
        ],
      },
    });
    const rows = await readUnreplayedEdgeDrops(env, 10);
    expect(rows.map((r) => r.id)).toEqual([1, 3, 5]);
    expect(rows[0].detail).toEqual({ note: "self_loop" });
    expect(rows[2].detail).toBeNull();
    expect((await readUnreplayedEdgeDrops(env, 2)).map((r) => r.id)).toEqual([1, 3]); // bounded
  });

  it("markEdgeDropReplayed rewrites exactly the addressed row's detail", async () => {
    const { env, tables } = fakeD1({
      tables: {
        ingredient_normalization_log: [
          { id: 1, term: "a -[general]-> b", outcome: "edge_drop", detail: JSON.stringify({ direction: "neither" }) },
          { id: 2, term: "c -[general]-> d", outcome: "edge_drop", detail: null },
        ],
      },
    });
    await markEdgeDropReplayed(env, 1, { direction: "neither", replayed_at: 1000, replay: "stands" });
    expect(JSON.parse(String(tables.ingredient_normalization_log[0].detail))).toEqual({
      direction: "neither",
      replayed_at: 1000,
      replay: "stands",
    });
    expect(tables.ingredient_normalization_log[1].detail).toBeNull(); // untouched
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
