import { describe, it, expect } from "vitest";
import {
  reconcileNightVibeVectors,
  vibeHash,
  type NightVibeVectorDeps,
  type NightVibeText,
  type NightVibeDerivedRow,
} from "../src/night-vibe-vector.js";

function harness(texts: NightVibeText[], stored: NightVibeDerivedRow[]) {
  const upserts: { tenant: string; id: string; hash: string }[] = [];
  const pruned: { tenant: string; id: string }[] = [];
  let embedCalls = 0;
  const deps: NightVibeVectorDeps = {
    loadTexts: async () => texts,
    loadStored: async () => stored,
    embed: async () => {
      embedCalls++;
      return [0.1, 0.2, 0.3];
    },
    upsert: async (tenant, id, hash) => {
      upserts.push({ tenant, id, hash });
    },
    prune: async (keys) => {
      pruned.push(...keys);
      return keys.length;
    },
  };
  return { deps, upserts, pruned, embeds: () => embedCalls };
}

describe("reconcileNightVibeVectors", () => {
  it("is a no-op when the hash is unchanged (steady state ≈ 0 work)", async () => {
    const h = harness(
      [{ tenant: "a", id: "pasta", vibe: "weeknight pasta" }],
      [{ tenant: "a", id: "pasta", vibe_hash: vibeHash("weeknight pasta") }],
    );
    const r = await reconcileNightVibeVectors(h.deps);
    expect(r.updated).toBe(0);
    expect(h.embeds()).toBe(0);
    expect(h.upserts).toHaveLength(0);
  });

  it("re-embeds when the vibe text changed", async () => {
    const h = harness(
      [{ tenant: "a", id: "pasta", vibe: "rich baked pasta" }],
      [{ tenant: "a", id: "pasta", vibe_hash: vibeHash("weeknight pasta") }],
    );
    const r = await reconcileNightVibeVectors(h.deps);
    expect(r.updated).toBe(1);
    expect(h.embeds()).toBe(1);
    expect(h.upserts[0]).toMatchObject({ tenant: "a", id: "pasta" });
  });

  it("embeds a brand-new vibe with no stored row", async () => {
    const h = harness([{ tenant: "a", id: "soup", vibe: "a warming soup" }], []);
    const r = await reconcileNightVibeVectors(h.deps);
    expect(r.updated).toBe(1);
  });

  it("prunes a derived row whose vibe no longer exists", async () => {
    const h = harness([], [{ tenant: "a", id: "gone", vibe_hash: "x" }]);
    const r = await reconcileNightVibeVectors(h.deps);
    expect(r.pruned).toBe(1);
    expect(h.pruned).toEqual([{ tenant: "a", id: "gone" }]);
  });

  it("prunes a spaced-tenant orphan by its real (tenant, id), not a mis-split of the key", async () => {
    // A tenant id containing a space would break a `split(" ")`-based key reversal; the prune
    // must target {tenant:"casey smith", id:"soup"}, never a mangled {tenant:"casey", id:"smith"}.
    const h = harness([], [{ tenant: "casey smith", id: "soup", vibe_hash: "x" }]);
    const r = await reconcileNightVibeVectors(h.deps);
    expect(r.pruned).toBe(1);
    expect(h.pruned).toEqual([{ tenant: "casey smith", id: "soup" }]);
  });

  it("handles a mixed pass (one new, one unchanged, one orphan)", async () => {
    const h = harness(
      [
        { tenant: "a", id: "pasta", vibe: "weeknight pasta" }, // unchanged
        { tenant: "a", id: "soup", vibe: "a warming soup" }, // new
      ],
      [
        { tenant: "a", id: "pasta", vibe_hash: vibeHash("weeknight pasta") },
        { tenant: "a", id: "old", vibe_hash: "x" }, // orphan → prune
      ],
    );
    const r = await reconcileNightVibeVectors(h.deps);
    expect(r.updated).toBe(1);
    expect(r.pruned).toBe(1);
    expect(h.pruned).toEqual([{ tenant: "a", id: "old" }]);
  });
});
