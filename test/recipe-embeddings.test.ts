import { describe, it, expect } from "vitest";
import {
  reconcileEmbeddings,
  hashText,
  type EmbedDeps,
  type RecipeDescription,
} from "../src/recipe-embeddings.js";

// A stored embedding in the in-memory fake.
interface Stored {
  embedding: number[];
  description_hash: string;
}

// Build an EmbedDeps backed by in-memory maps. embedTexts returns a deterministic
// one-element vector per text ([length]) so upserted vectors are checkable and we can
// assert the chunk→slug alignment. `embedCalls` records each AI call's input array.
function makeDeps(
  recipes: RecipeDescription[],
  stored: Record<string, Stored> = {},
  opts: { maxPerTick?: number; inputBatch?: number } = {},
) {
  const embeddings = new Map<string, Stored>(Object.entries(stored));
  const embedCalls: string[][] = [];
  const deps: EmbedDeps = {
    loadDescriptions: async () => recipes.map((r) => ({ ...r })),
    loadEmbeddingHashes: async () =>
      [...embeddings.entries()].map(([slug, v]) => ({ slug, description_hash: v.description_hash })),
    pruneOrphans: async () => {
      const live = new Set(recipes.map((r) => r.slug));
      let n = 0;
      for (const slug of [...embeddings.keys()]) {
        if (!live.has(slug)) {
          embeddings.delete(slug);
          n++;
        }
      }
      return n;
    },
    embedTexts: async (texts) => {
      embedCalls.push(texts);
      return texts.map((t) => [t.length]);
    },
    upsertEmbeddings: async (rows) => {
      for (const r of rows) embeddings.set(r.slug, { embedding: r.embedding, description_hash: r.description_hash });
    },
    maxPerTick: opts.maxPerTick ?? 100,
    inputBatch: opts.inputBatch ?? 25,
    kv: {} as never,
    now: () => 0,
  };
  return { deps, embeddings, embedCalls };
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

describe("reconcileEmbeddings", () => {
  it("cold-embeds every described recipe and stores its hash", async () => {
    const { deps, embeddings } = makeDeps([
      { slug: "a", description: "alpha" },
      { slug: "b", description: "betas" },
    ]);
    const r = await reconcileEmbeddings(deps);
    expect(r).toEqual({ embedded: 2, pruned: 0, pending: 0 });
    expect(embeddings.get("a")).toEqual({ embedding: [5], description_hash: hashText("alpha") });
    expect(embeddings.get("b")).toEqual({ embedding: [5], description_hash: hashText("betas") });
  });

  it("does nothing when every description is already embedded (change-driven)", async () => {
    const { deps, embedCalls } = makeDeps(
      [{ slug: "a", description: "alpha" }],
      { a: { embedding: [5], description_hash: hashText("alpha") } },
    );
    const r = await reconcileEmbeddings(deps);
    expect(r.embedded).toBe(0);
    expect(embedCalls).toEqual([]); // no AI subrequest at steady state
  });

  it("re-embeds only the recipe whose description changed", async () => {
    const { deps, embeddings, embedCalls } = makeDeps(
      [
        { slug: "a", description: "alpha CHANGED" },
        { slug: "b", description: "beta" },
      ],
      {
        a: { embedding: [5], description_hash: hashText("alpha") },
        b: { embedding: [4], description_hash: hashText("beta") },
      },
    );
    const r = await reconcileEmbeddings(deps);
    expect(r.embedded).toBe(1);
    expect(embedCalls).toEqual([["alpha CHANGED"]]);
    expect(embeddings.get("a")).toEqual({ embedding: [13], description_hash: hashText("alpha CHANGED") });
    expect(embeddings.get("b")?.embedding).toEqual([4]); // untouched
  });

  it("prunes an embedding whose recipe no longer has a description", async () => {
    const { deps, embeddings } = makeDeps(
      [{ slug: "a", description: "alpha" }],
      {
        a: { embedding: [5], description_hash: hashText("alpha") },
        gone: { embedding: [9], description_hash: "deadbeef" },
      },
    );
    const r = await reconcileEmbeddings(deps);
    expect(r.pruned).toBe(1);
    expect(r.embedded).toBe(0);
    expect(embeddings.has("gone")).toBe(false);
  });

  it("bounds embeds per tick and defers the rest as pending", async () => {
    const recipes = ["a", "b", "c", "d", "e"].map((s) => ({ slug: s, description: s }));
    const { deps, embeddings } = makeDeps(recipes, {}, { maxPerTick: 2 });
    const first = await reconcileEmbeddings(deps);
    expect(first).toEqual({ embedded: 2, pruned: 0, pending: 3 });
    expect(embeddings.size).toBe(2);
    // A second tick continues from where the first stopped.
    const second = await reconcileEmbeddings(deps);
    expect(second).toEqual({ embedded: 2, pruned: 0, pending: 1 });
    expect(embeddings.size).toBe(4);
  });

  it("chunks the embed batch by inputBatch, keeping vector↔slug alignment", async () => {
    const recipes = [
      { slug: "a", description: "a" },
      { slug: "b", description: "bb" },
      { slug: "c", description: "ccc" },
    ];
    const { deps, embeddings, embedCalls } = makeDeps(recipes, {}, { inputBatch: 2 });
    const r = await reconcileEmbeddings(deps);
    expect(r.embedded).toBe(3);
    expect(embedCalls).toEqual([["a", "bb"], ["ccc"]]); // two AI calls
    expect(embeddings.get("a")?.embedding).toEqual([1]);
    expect(embeddings.get("b")?.embedding).toEqual([2]);
    expect(embeddings.get("c")?.embedding).toEqual([3]);
  });
});
