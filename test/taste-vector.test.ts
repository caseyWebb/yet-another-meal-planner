import { describe, it, expect } from "vitest";
import { reconcileTasteVectors, tasteHash, type TasteDeps } from "../src/taste-vector.js";

/** A fake TasteDeps over in-memory maps; records embeds + upserts + prunes. */
function makeDeps(
  texts: { tenant: string; taste: string | null }[],
  stored: { tenant: string; taste_hash: string | null }[],
) {
  const rows = new Map(stored.map((r) => [r.tenant, r.taste_hash]));
  const calls = { embedded: [] as string[], upserted: [] as string[], pruned: [] as string[] };
  const deps: TasteDeps = {
    loadTasteTexts: async () => texts,
    loadStored: async () => stored,
    embed: async (text) => {
      calls.embedded.push(text);
      return [0.1, 0.2, 0.3];
    },
    upsert: async (tenant, hash) => {
      calls.upserted.push(tenant);
      rows.set(tenant, hash);
    },
    prune: async (tenants) => {
      calls.pruned.push(...tenants);
      return tenants.length;
    },
  };
  return { deps, calls };
}

describe("reconcileTasteVectors", () => {
  it("embeds a new member's taste text", async () => {
    const { deps, calls } = makeDeps([{ tenant: "casey", taste: "bright, acidic, Sichuan heat" }], []);
    const r = await reconcileTasteVectors(deps);
    expect(r).toEqual({ updated: 1, pruned: 0 });
    expect(calls.embedded).toEqual(["bright, acidic, Sichuan heat"]);
    expect(calls.upserted).toEqual(["casey"]);
  });

  it("is a no-op when the stored hash matches (steady state)", async () => {
    const taste = "bright, acidic";
    const { deps, calls } = makeDeps(
      [{ tenant: "casey", taste }],
      [{ tenant: "casey", taste_hash: tasteHash(taste) }],
    );
    const r = await reconcileTasteVectors(deps);
    expect(r).toEqual({ updated: 0, pruned: 0 });
    expect(calls.embedded).toEqual([]);
  });

  it("re-embeds when the taste text changed", async () => {
    const { deps, calls } = makeDeps(
      [{ tenant: "casey", taste: "now I love smoky and rich" }],
      [{ tenant: "casey", taste_hash: tasteHash("old taste") }],
    );
    const r = await reconcileTasteVectors(deps);
    expect(r.updated).toBe(1);
    expect(calls.embedded).toEqual(["now I love smoky and rich"]);
  });

  it("prunes a stored row whose member no longer has taste text", async () => {
    const { deps, calls } = makeDeps(
      [{ tenant: "casey", taste: "" }],
      [{ tenant: "casey", taste_hash: "abc" }],
    );
    const r = await reconcileTasteVectors(deps);
    expect(r).toEqual({ updated: 0, pruned: 1 });
    expect(calls.pruned).toEqual(["casey"]);
  });

  it("ignores a member with no taste text and no stored row", async () => {
    const { deps, calls } = makeDeps([{ tenant: "new", taste: null }], []);
    const r = await reconcileTasteVectors(deps);
    expect(r).toEqual({ updated: 0, pruned: 0 });
    expect(calls.embedded).toEqual([]);
  });
});
