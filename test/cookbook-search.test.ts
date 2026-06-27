import { describe, it, expect } from "vitest";
import {
  DEFAULT_SIMILARITY_FLOOR,
  mergeCookbookResults,
  normalizeQuery,
  queryVectorCacheKey,
  type CookbookHit,
  type EmbeddedCandidate,
} from "../src/cookbook-search.js";
import { EMBED_MODEL } from "../src/embedding.js";
import { hashText } from "../src/hash.js";

function hit(slug: string, title = slug): CookbookHit {
  return { slug, title, description: null, protein: null, cuisine: null };
}
function cand(slug: string, embedding: number[], title = slug): EmbeddedCandidate {
  return { ...hit(slug, title), embedding };
}

describe("mergeCookbookResults", () => {
  it("orders substring hits ahead of semantic-only neighbours", () => {
    const out = mergeCookbookResults(
      [hit("tacos", "Tacos")],
      [cand("enchiladas", [1, 0]), cand("burrito", [1, 0])],
      [1, 0],
      0,
      10,
    );
    // substring first; the semantic tier is tie-broken on slug (burrito < enchiladas)
    expect(out.map((r) => r.slug)).toEqual(["tacos", "burrito", "enchiladas"]);
  });

  it("dedupes a both-tier match, keeping it in the substring tier only", () => {
    const out = mergeCookbookResults(
      [hit("tacos", "Tacos")],
      [cand("tacos", [1, 0], "Tacos"), cand("burrito", [1, 0])],
      [1, 0],
      0,
      10,
    );
    expect(out.filter((r) => r.slug === "tacos")).toHaveLength(1);
    expect(out.map((r) => r.slug)).toEqual(["tacos", "burrito"]);
  });

  it("excludes semantic candidates below the floor", () => {
    const out = mergeCookbookResults([], [cand("near", [1, 0]), cand("far", [0, 1])], [1, 0], 0.5, 10);
    expect(out.map((r) => r.slug)).toEqual(["near"]); // far has cosine 0 < 0.5
  });

  it("ranks the semantic tier best-first, tie-broken on slug", () => {
    const out = mergeCookbookResults(
      [],
      [cand("b", [3, 1]), cand("a", [3, 1]), cand("top", [1, 0])],
      [1, 0],
      0,
      10,
    );
    // top (cosine 1) first; then the a/b tie (cosine 3/√10) broken on slug
    expect(out.map((r) => r.slug)).toEqual(["top", "a", "b"]);
  });

  it("returns substring-only when there is no query vector (degradation)", () => {
    const out = mergeCookbookResults([hit("x")], [cand("y", [1, 0])], null, 0.5, 10);
    expect(out.map((r) => r.slug)).toEqual(["x"]); // candidates ignored without a vector
  });

  it("is empty-in / empty-out", () => {
    expect(mergeCookbookResults([], [], [1, 0], 0.5, 10)).toEqual([]);
    expect(mergeCookbookResults([], [], null, 0.5, 10)).toEqual([]);
  });

  it("caps the semantic tier at k but never the substring tier", () => {
    const subs = [hit("s1", "S1"), hit("s2", "S2"), hit("s3", "S3")];
    const cands = [cand("c1", [1, 0]), cand("c2", [1, 0]), cand("c3", [1, 0])];
    const out = mergeCookbookResults(subs, cands, [1, 0], 0, 1);
    expect(out.filter((r) => r.slug.startsWith("s"))).toHaveLength(3); // all substring shown
    expect(out.filter((r) => r.slug.startsWith("c"))).toHaveLength(1); // semantic capped at k=1
  });
});

describe("queryVectorCacheKey / normalizeQuery", () => {
  it("normalizes case and whitespace", () => {
    expect(normalizeQuery("  Chicken   Rice ")).toBe("chicken rice");
  });

  it("collapses equivalent queries to the same key", () => {
    expect(queryVectorCacheKey("Tacos")).toBe(queryVectorCacheKey("  tacos "));
  });

  it("gives distinct queries distinct keys", () => {
    expect(queryVectorCacheKey("tacos")).not.toBe(queryVectorCacheKey("burritos"));
  });

  it("binds the key to the embedding model, so a model change re-keys", () => {
    expect(queryVectorCacheKey("x")).toBe(`cookbook:qvec:${hashText(`${EMBED_MODEL}\nx`)}`);
    // hashing the query alone (no model) would differ — proves the model participates
    expect(queryVectorCacheKey("x")).not.toBe(`cookbook:qvec:${hashText("x")}`);
  });

  it("exposes a default floor inside (0, 1)", () => {
    expect(DEFAULT_SIMILARITY_FLOOR).toBeGreaterThan(0);
    expect(DEFAULT_SIMILARITY_FLOOR).toBeLessThan(1);
  });
});
