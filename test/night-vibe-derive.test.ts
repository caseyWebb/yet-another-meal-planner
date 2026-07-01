import { describe, it, expect } from "vitest";
import {
  kmeans,
  clusterTasteSpace,
  inferCadence,
  dedupeClusters,
  chooseK,
  deriveArchetypes,
  type TasteItem,
} from "../src/night-vibe-derive.js";
import { slugify } from "../src/discovery.js";

// Two tight groups in 3-space: an "italian-ish" blob near [1,0,0] and a "fish-ish" blob near [0,1,0].
const italianA: number[] = [1, 0.05, 0];
const italianB: number[] = [0.95, 0.1, 0.02];
const fishA: number[] = [0.03, 1, 0.02];
const fishB: number[] = [0, 0.96, 0.1];

function item(slug: string, embedding: number[], cookDates?: string[], description?: string): TasteItem {
  return { slug, embedding, cookDates, description };
}

describe("chooseK", () => {
  it("scales to the footprint and clamps", () => {
    expect(chooseK(1)).toBe(1);
    expect(chooseK(2)).toBe(2);
    expect(chooseK(8)).toBe(2); // round(sqrt(4)) = 2
    expect(chooseK(200)).toBe(8); // clamped to maxK
    expect(chooseK(3)).toBeGreaterThanOrEqual(2);
  });
});

describe("kmeans", () => {
  it("separates two tight groups and is deterministic for a fixed seed", () => {
    const vecs = [italianA, italianB, fishA, fishB];
    const a = kmeans(vecs, 2, 7);
    const b = kmeans(vecs, 2, 7);
    expect(a).toEqual(b); // deterministic
    // the two italians share a cluster; the two fish share the other
    expect(a[0]).toBe(a[1]);
    expect(a[2]).toBe(a[3]);
    expect(a[0]).not.toBe(a[2]);
  });

  it("returns each point as its own cluster when k >= n", () => {
    expect(kmeans([italianA, fishA], 5, 1)).toEqual([0, 1]);
  });

  it("returns empty for no vectors", () => {
    expect(kmeans([], 3, 1)).toEqual([]);
  });
});

describe("clusterTasteSpace", () => {
  it("produces one archetype per tight group with an inferred cadence, deterministically", () => {
    const items = [
      item("penne", italianA, ["2026-06-01", "2026-06-08", "2026-06-15"]), // cooked weekly
      item("ziti", italianB), // a favorite, never cooked → no dates
      item("cod", fishA, ["2026-06-02", "2026-07-02"]), // ~monthly
      item("salmon", fishB, ["2026-06-20"]),
    ];
    const clusters = clusterTasteSpace(items, 7, { k: 2, minClusterSize: 2 });
    expect(clusters).toHaveLength(2);
    // biggest-first, deterministic
    expect(clusterTasteSpace(items, 7, { k: 2, minClusterSize: 2 })).toEqual(clusters);
    // each cluster groups its two members
    const slugsPerCluster = clusters.map((c) => c.members.map((m) => m.slug).sort());
    expect(slugsPerCluster).toContainEqual(["penne", "ziti"]);
    expect(slugsPerCluster).toContainEqual(["cod", "salmon"]);
    // the italian cluster's pooled dates (weekly) infer a ~7-day cadence
    const italian = clusters.find((c) => c.members.some((m) => m.slug === "penne"))!;
    expect(italian.cadence_days).toBe(7);
  });

  it("drops clusters below minClusterSize and returns nothing for empty input", () => {
    expect(clusterTasteSpace([], 1)).toEqual([]);
    const oneEach = clusterTasteSpace([item("a", italianA), item("b", fishA)], 1, { k: 2, minClusterSize: 2 });
    expect(oneEach).toEqual([]); // both clusters are singletons → dropped
  });
});

describe("inferCadence", () => {
  it("is the median inter-cook gap, floored at 1, or null when too sparse", () => {
    expect(inferCadence(["2026-06-01", "2026-06-08", "2026-06-15"])).toBe(7);
    expect(inferCadence(["2026-06-01"])).toBeNull();
    expect(inferCadence([])).toBeNull();
    expect(inferCadence(["2026-06-01", "2026-06-01"])).toBeNull(); // one distinct date
    expect(inferCadence(["2026-06-01", "2026-07-01"])).toBe(30);
  });
});

describe("deriveArchetypes", () => {
  const items = [
    item("penne", italianA, undefined, "a simple weeknight italian pasta"),
    item("ziti", italianB, undefined, "baked italian pasta"),
    item("cod", fishA, undefined, "a bright quick fish dish"),
    item("salmon", fishB, undefined, "seared fish with herbs"),
  ];
  // Fake namer: name a cluster from its first description (deterministic, no model).
  const deps = {
    name: async ({ descriptions }: { descriptions: string[]; cadence_days: number | null }) =>
      descriptions.length ? { vibe: descriptions[0], cadence_days: null } : null,
  };

  it("names each surviving cluster into an add_vibe candidate", async () => {
    const out = await deriveArchetypes(items, [], 7, deps, { k: 2, minClusterSize: 2 });
    expect(out).toHaveLength(2);
    expect(out.map((a) => a.id)).toContain(slugify("a simple weeknight italian pasta"));
    expect(out.every((a) => a.evidence.size === 2)).toBe(true);
  });

  it("dedupes against the palette and caps the number of proposals", async () => {
    // A palette vibe on the italian blob removes that cluster; only the fish archetype remains.
    const deduped = await deriveArchetypes(items, [[1, 0, 0]], 7, deps, { k: 2, minClusterSize: 2, dedupThreshold: 0.9 });
    expect(deduped).toHaveLength(1);
    expect(deduped[0].vibe).toMatch(/fish/);
    // maxProposals caps the count.
    const capped = await deriveArchetypes(items, [], 7, deps, { k: 2, minClusterSize: 2, maxProposals: 1 });
    expect(capped).toHaveLength(1);
  });

  it("skips a cluster the namer declines", async () => {
    const nullNamer = { name: async () => null };
    expect(await deriveArchetypes(items, [], 7, nullNamer, { k: 2, minClusterSize: 2 })).toEqual([]);
  });

  it("threads a successful weather-bucket classification through to the candidate", async () => {
    const bucketedDeps = {
      name: async ({ descriptions }: { descriptions: string[]; cadence_days: number | null }) =>
        descriptions.length ? { vibe: descriptions[0], cadence_days: null, weather_affinity: ["grill" as const] } : null,
    };
    const out = await deriveArchetypes(items, [], 7, bucketedDeps, { k: 2, minClusterSize: 2 });
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((a) => a.weather_affinity !== undefined)).toBe(true);
    expect(out[0].weather_affinity).toEqual(["grill"]);
  });

  it("defaults to bucketless (no weather_affinity key) when the namer returns no classification", async () => {
    // `deps` above never returns weather_affinity — the default fail-soft/neutral path.
    const out = await deriveArchetypes(items, [], 7, deps, { k: 2, minClusterSize: 2 });
    expect(out.every((a) => a.weather_affinity === undefined)).toBe(true);
  });

  it("a bucket classification never affects the vibe phrase itself", async () => {
    const bucketedDeps = {
      name: async ({ descriptions }: { descriptions: string[]; cadence_days: number | null }) =>
        descriptions.length ? { vibe: descriptions[0], cadence_days: null, weather_affinity: ["wet" as const] } : null,
    };
    const withoutBucket = await deriveArchetypes(items, [], 7, deps, { k: 2, minClusterSize: 2 });
    const withBucket = await deriveArchetypes(items, [], 7, bucketedDeps, { k: 2, minClusterSize: 2 });
    expect(withBucket.map((a) => a.vibe)).toEqual(withoutBucket.map((a) => a.vibe));
    expect(withBucket.map((a) => a.id)).toEqual(withoutBucket.map((a) => a.id));
  });
});

describe("dedupeClusters", () => {
  it("drops a cluster already covered by an existing palette vibe", () => {
    const clusters = clusterTasteSpace(
      [item("penne", italianA), item("ziti", italianB), item("cod", fishA), item("salmon", fishB)],
      7,
      { k: 2, minClusterSize: 2 },
    );
    // A palette vibe sitting on the italian blob covers that cluster.
    const kept = dedupeClusters(clusters, [[1, 0, 0]], 0.9);
    expect(kept.every((c) => !c.members.some((m) => m.slug === "penne"))).toBe(true);
    // With no palette vectors, nothing is deduped.
    expect(dedupeClusters(clusters, [], 0.9)).toHaveLength(clusters.length);
  });
});
