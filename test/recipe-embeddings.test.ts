import { describe, it, expect } from "vitest";
import {
  reconcileRecipeDerived,
  hashText,
  type DerivedDeps,
  type DerivedRow,
  type FacetRow,
} from "../src/recipe-embeddings.js";
import { contentHash, type RecipeFacets } from "../src/description.js";

// A FacetRow with sensible empty defaults; override what a test cares about.
function facet(slug: string, over: Partial<RecipeFacets> = {}): FacetRow {
  return {
    slug,
    title: over.title ?? slug,
    ingredients_key: over.ingredients_key ?? [],
    course: over.course ?? [],
    protein: over.protein ?? null,
    cuisine: over.cuisine ?? null,
    time_total: over.time_total ?? null,
    dietary: over.dietary ?? [],
    season: over.season ?? [],
  };
}

// The fake's stored derived state: the change-detection row plus the (separately stored) vector.
interface StoredDerived {
  content_hash: string | null;
  description: string | null;
  description_hash: string | null;
  embedding?: number[];
}

// Build DerivedDeps over in-memory maps. `describe` returns a deterministic `desc:<title>` so
// outputs are checkable; `embedTexts` returns a one-element [length] vector per text so vectors
// are checkable and chunk→slug alignment is assertable. Records describe/embed AI calls.
function makeDeps(
  facets: FacetRow[],
  stored: Record<string, StoredDerived> = {},
  opts: { describeMax?: number; embedMax?: number; inputBatch?: number } = {},
) {
  const derived = new Map<string, DerivedRow>();
  const vectors = new Map<string, number[]>();
  for (const [slug, s] of Object.entries(stored)) {
    derived.set(slug, {
      slug,
      content_hash: s.content_hash,
      description: s.description,
      description_hash: s.description_hash,
    });
    if (s.embedding) vectors.set(slug, s.embedding);
  }
  const describeCalls: string[] = [];
  const embedCalls: string[][] = [];

  const deps: DerivedDeps = {
    loadFacets: async () => facets.map((f) => ({ ...f })),
    loadDerived: async () => [...derived.values()].map((d) => ({ ...d })),
    describe: async (f) => {
      describeCalls.push(f.title);
      return `desc:${f.title}`;
    },
    upsertDescription: async (slug, description, content_hash) => {
      const prev = derived.get(slug);
      derived.set(slug, { slug, description, content_hash, description_hash: prev?.description_hash ?? null });
    },
    embedTexts: async (texts) => {
      embedCalls.push(texts);
      return texts.map((t) => [t.length]);
    },
    upsertEmbeddings: async (rows) => {
      for (const r of rows) {
        const prev = derived.get(r.slug);
        derived.set(r.slug, {
          slug: r.slug,
          content_hash: prev?.content_hash ?? null,
          description: prev?.description ?? null,
          description_hash: r.description_hash,
        });
        vectors.set(r.slug, r.embedding);
      }
    },
    pruneOrphans: async () => {
      const live = new Set(facets.map((f) => f.slug));
      let n = 0;
      for (const slug of [...derived.keys()]) {
        if (!live.has(slug)) {
          derived.delete(slug);
          vectors.delete(slug);
          n++;
        }
      }
      return n;
    },
    describeMaxPerTick: opts.describeMax ?? 100,
    embedMaxPerTick: opts.embedMax ?? 100,
    inputBatch: opts.inputBatch ?? 25,
    kv: {} as never,
    now: () => 0,
  };
  return { deps, derived, vectors, describeCalls, embedCalls };
}

describe("hashText", () => {
  it("is deterministic and 8-char hex", () => {
    expect(hashText("alpha")).toBe(hashText("alpha"));
    expect(hashText("alpha")).toMatch(/^[0-9a-f]{8}$/);
  });

  it("changes when the text changes", () => {
    expect(hashText("alpha")).not.toBe(hashText("alpha "));
    expect(hashText("")).not.toBe(hashText("a"));
  });
});

describe("reconcileRecipeDerived", () => {
  it("cold: describes then embeds every recipe", async () => {
    const a = facet("a", { title: "A" });
    const b = facet("b", { title: "B" });
    const { deps, derived, vectors, describeCalls, embedCalls } = makeDeps([a, b]);

    const r = await reconcileRecipeDerived(deps);

    expect(r).toEqual({ described: 2, describePending: 0, embedded: 2, pruned: 0, pending: 0 });
    expect(describeCalls).toEqual(["A", "B"]);
    expect(embedCalls).toEqual([["desc:A", "desc:B"]]);
    expect(derived.get("a")).toEqual({
      slug: "a",
      content_hash: contentHash(a),
      description: "desc:A",
      description_hash: hashText("desc:A"),
    });
    expect(vectors.get("a")).toEqual(["desc:A".length]);
  });

  it("steady: no describe and no embed when content + description hashes are current", async () => {
    const a = facet("a", { title: "A" });
    const { deps, describeCalls, embedCalls } = makeDeps([a], {
      a: {
        content_hash: contentHash(a),
        description: "desc:A",
        description_hash: hashText("desc:A"),
        embedding: [6],
      },
    });
    const r = await reconcileRecipeDerived(deps);
    expect(r.described).toBe(0);
    expect(r.embedded).toBe(0);
    expect(describeCalls).toEqual([]);
    expect(embedCalls).toEqual([]);
  });

  it("re-describes (then re-embeds) only the recipe whose facets changed", async () => {
    const aOld = facet("a", { title: "A" });
    const aNew = facet("a", { title: "A2" }); // facet changed → content_hash differs
    const b = facet("b", { title: "B" });
    const { deps, derived, describeCalls, embedCalls } = makeDeps([aNew, b], {
      a: { content_hash: contentHash(aOld), description: "desc:A", description_hash: hashText("desc:A"), embedding: [6] },
      b: { content_hash: contentHash(b), description: "desc:B", description_hash: hashText("desc:B"), embedding: [6] },
    });

    const r = await reconcileRecipeDerived(deps);

    expect(r.described).toBe(1);
    expect(r.embedded).toBe(1);
    expect(describeCalls).toEqual(["A2"]);
    expect(embedCalls).toEqual([["desc:A2"]]);
    expect(derived.get("a")).toEqual({
      slug: "a",
      content_hash: contentHash(aNew),
      description: "desc:A2",
      description_hash: hashText("desc:A2"),
    });
    expect(derived.get("b")?.description_hash).toBe(hashText("desc:B")); // untouched
  });

  it("embeds a current description whose vector is missing (no re-describe)", async () => {
    const a = facet("a", { title: "A" });
    const { deps, describeCalls, embedCalls, vectors } = makeDeps([a], {
      a: { content_hash: contentHash(a), description: "desc:A", description_hash: null }, // described, not embedded
    });
    const r = await reconcileRecipeDerived(deps);
    expect(r.described).toBe(0);
    expect(r.embedded).toBe(1);
    expect(describeCalls).toEqual([]);
    expect(embedCalls).toEqual([["desc:A"]]);
    expect(vectors.get("a")).toEqual(["desc:A".length]);
  });

  it("prunes a derived row whose recipe no longer exists", async () => {
    const a = facet("a", { title: "A" });
    const { deps, derived } = makeDeps([a], {
      a: { content_hash: contentHash(a), description: "desc:A", description_hash: hashText("desc:A"), embedding: [6] },
      gone: { content_hash: "x", description: "d", description_hash: "y", embedding: [9] },
    });
    const r = await reconcileRecipeDerived(deps);
    expect(r.pruned).toBe(1);
    expect(r.described).toBe(0);
    expect(r.embedded).toBe(0);
    expect(derived.has("gone")).toBe(false);
  });

  it("bounds describes per tick and resumes on the next", async () => {
    const facets = ["a", "b", "c", "d", "e"].map((s) => facet(s, { title: s.toUpperCase() }));
    const { deps, derived } = makeDeps(facets, {}, { describeMax: 2 });

    const first = await reconcileRecipeDerived(deps);
    // 2 described this tick; those same 2 then embed (embed cap is the default 100).
    expect(first).toEqual({ described: 2, describePending: 3, embedded: 2, pruned: 0, pending: 0 });
    expect([...derived.values()].filter((d) => d.description).length).toBe(2);

    const second = await reconcileRecipeDerived(deps);
    expect(second.described).toBe(2);
    expect(second.describePending).toBe(1);
  });

  it("bounds embeds per tick and defers the rest as pending", async () => {
    const facets = ["a", "b", "c"].map((s) => facet(s, { title: s }));
    // All already described+current, none embedded → only the embed pass runs.
    const stored: Record<string, StoredDerived> = {};
    for (const f of facets) stored[f.slug] = { content_hash: contentHash(f), description: `desc:${f.title}`, description_hash: null };
    const { deps } = makeDeps(facets, stored, { embedMax: 2 });
    const r = await reconcileRecipeDerived(deps);
    expect(r).toEqual({ described: 0, describePending: 0, embedded: 2, pruned: 0, pending: 1 });
  });

  it("chunks the embed batch by inputBatch, keeping vector↔slug alignment", async () => {
    const facets = [facet("a", { title: "A" }), facet("b", { title: "BB" }), facet("c", { title: "CCC" })];
    const { deps, vectors, embedCalls } = makeDeps(facets, {}, { inputBatch: 2 });
    const r = await reconcileRecipeDerived(deps);
    expect(r.embedded).toBe(3);
    expect(embedCalls).toEqual([["desc:A", "desc:BB"], ["desc:CCC"]]); // two AI calls
    expect(vectors.get("a")).toEqual(["desc:A".length]);
    expect(vectors.get("b")).toEqual(["desc:BB".length]);
    expect(vectors.get("c")).toEqual(["desc:CCC".length]);
  });
});
