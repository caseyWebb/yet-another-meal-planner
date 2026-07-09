import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeD1 } from "./fake-d1.js";

// Deterministic embed fake keyed by phrase (vi.hoisted so the mock factory can close over it).
// Registered phrases return their assigned axis (dims 0-19); any unregistered phrase gets a fresh
// orthogonal one-hot (dims 30+), so two distinct unseen phrases never collide (cosine 0 < 0.85).
const { embedRegistry } = vi.hoisted(() => ({ embedRegistry: new Map<string, number[]>() }));
const DIM = 64;
function axis(i: number): number[] {
  const v = new Array<number>(DIM).fill(0);
  v[i] = 1;
  return v;
}

vi.mock("../src/embedding.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../src/embedding.js")>();
  let next = 30;
  const idxByPhrase = new Map<string, number>();
  return {
    ...mod,
    embedTextsCached: vi.fn(async (_env: unknown, texts: string[]) =>
      texts.map((t) => {
        const reg = embedRegistry.get(t);
        if (reg) return reg;
        if (!idxByPhrase.has(t)) idxByPhrase.set(t, next++);
        return axis(idxByPhrase.get(t)!);
      }),
    ),
  };
});

vi.mock("../src/night-vibe-naming.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../src/night-vibe-naming.js")>();
  return {
    ...mod,
    nameCluster: vi.fn(async () => null),
    starterVibesFromTaste: vi.fn(async () => [] as { id: string; vibe: string }[]),
  };
});

import { runDerivation } from "../src/night-vibe-suggest.js";
import { nameCluster, starterVibesFromTaste } from "../src/night-vibe-naming.js";
import { proposalId } from "../src/reconcile-db.js";

function proposalIdOf(id: string): string {
  return proposalId("add_vibe", id);
}

function pendingRow(id: string, vibe: string, created_at: string, tenant = "casey") {
  return {
    tenant,
    id,
    kind: "add_vibe",
    target: id,
    payload: JSON.stringify({ id, vibe }),
    rationale: "add it?",
    evidence: JSON.stringify({ member_slugs: [], size: 0 }),
    status: "pending",
    producer: "edge",
    created_at,
    resolved_at: null,
  };
}

beforeEach(() => {
  embedRegistry.clear();
  vi.mocked(nameCluster).mockClear();
  vi.mocked(starterVibesFromTaste).mockClear().mockResolvedValue([]);
});

describe("runDerivation — queue convergence sweep", () => {
  it("collapses accumulated paraphrases onto the earliest, superseding the rest with resolved_at", async () => {
    // Three chicken-stir-fry paraphrases (same axis) accumulated across successive runs, empty palette.
    for (const v of ["a quick chicken stir-fry", "a hearty chicken stir-fry", "a mild chicken stir-fry"]) {
      embedRegistry.set(v, axis(1));
    }
    const d1 = fakeD1({
      tables: {
        pending_proposals: [
          pendingRow("p-late", "a mild chicken stir-fry", "2026-07-05T00:00:00Z"),
          pendingRow("p-early", "a quick chicken stir-fry", "2026-07-01T00:00:00Z"),
          pendingRow("p-mid", "a hearty chicken stir-fry", "2026-07-03T00:00:00Z"),
        ],
        night_vibes: [], // empty palette
      },
    });
    const res = await runDerivation(d1.env, "casey", 20260709);
    expect(res.superseded).toBe(2);
    expect(res.source).toBe("none"); // starter mock returns nothing
    const rows = d1.tables.pending_proposals;
    const survivor = rows.find((r) => r.status === "pending");
    expect(survivor?.id).toBe("p-early"); // earliest created_at survives
    const superseded = rows.filter((r) => r.status === "superseded");
    expect(superseded.map((r) => r.id).sort()).toEqual(["p-late", "p-mid"]);
    for (const r of superseded) expect(r.resolved_at).toBeTruthy();
  });

  it("supersedes a pending proposal covered by the palette, never touching a rejected row", async () => {
    embedRegistry.set("a flavorful seafood dinner", axis(0)); // palette phrase
    embedRegistry.set("a quick seafood dinner", axis(0)); // pending near palette
    embedRegistry.set("a spicy seafood skillet", axis(2)); // rejected (must stay untouched)
    const d1 = fakeD1({
      tables: {
        night_vibes: [{ tenant: "casey", id: "a-flavorful-seafood-dinner", vibe: "a flavorful seafood dinner" }],
        night_vibe_derived: [
          { tenant: "casey", id: "a-flavorful-seafood-dinner", embedding: JSON.stringify(axis(0)) },
        ],
        pending_proposals: [
          pendingRow("p-seafood", "a quick seafood dinner", "2026-07-02T00:00:00Z"),
          {
            ...pendingRow("r-skillet", "a spicy seafood skillet", "2026-07-01T00:00:00Z"),
            status: "rejected",
            resolved_at: "2026-07-01T12:00:00Z",
          },
        ],
      },
    });
    const res = await runDerivation(d1.env, "casey", 20260709);
    expect(res.superseded).toBe(1);
    expect(d1.tables.pending_proposals.find((r) => r.id === "p-seafood")?.status).toBe("superseded");
    const rejected = d1.tables.pending_proposals.find((r) => r.id === "r-skillet");
    expect(rejected?.status).toBe("rejected");
    expect(rejected?.resolved_at).toBe("2026-07-01T12:00:00Z"); // never rewritten
  });
});

describe("runDerivation — candidate dedup + cold-start gate", () => {
  it("does not enqueue a cold-start candidate near a pending or rejected phrase", async () => {
    embedRegistry.set("a quick chicken stir-fry", axis(1)); // existing pending representative
    embedRegistry.set("a spicy seafood skillet", axis(2)); // rejected
    embedRegistry.set("a mild asian stir-fry", axis(1)); // starter near pending → dropped
    embedRegistry.set("a fiery seafood dish", axis(2)); // starter near rejected → dropped
    embedRegistry.set("a fresh green salad", axis(10)); // novel starter → enqueued
    vi.mocked(starterVibesFromTaste).mockResolvedValue([
      { id: "a-mild-asian-stir-fry", vibe: "a mild asian stir-fry" },
      { id: "a-fiery-seafood-dish", vibe: "a fiery seafood dish" },
      { id: "a-fresh-green-salad", vibe: "a fresh green salad" },
    ]);
    const d1 = fakeD1({
      tables: {
        night_vibes: [], // empty palette → cold start runs
        pending_proposals: [
          pendingRow("p-stir", "a quick chicken stir-fry", "2026-07-01T00:00:00Z"),
          {
            ...pendingRow("r-skillet", "a spicy seafood skillet", "2026-07-01T00:00:00Z"),
            status: "rejected",
            resolved_at: "2026-07-01T12:00:00Z",
          },
        ],
      },
    });
    const res = await runDerivation(d1.env, "casey", 20260709);
    expect(res.source).toBe("cold_start");
    expect(res.enqueued).toBe(1); // only the salad
    expect(res.candidates.map((c) => c.id)).toEqual(["a-fresh-green-salad"]);
    const enqueuedIds = d1.tables.pending_proposals.filter((r) => r.status === "pending").map((r) => r.id).sort();
    expect(enqueuedIds).toContain(proposalIdOf("a-fresh-green-salad"));
    expect(d1.tables.pending_proposals.some((r) => r.payload && String(r.payload).includes("a mild asian stir-fry"))).toBe(false);
  });

  it("a palette-holding thin-history member gets source none and spends no naming call, but the sweep still runs", async () => {
    embedRegistry.set("a cozy braise", axis(3)); // palette
    embedRegistry.set("a quick chicken stir-fry", axis(1));
    embedRegistry.set("a mild chicken stir-fry", axis(1));
    const d1 = fakeD1({
      tables: {
        night_vibes: [{ tenant: "casey", id: "a-cozy-braise", vibe: "a cozy braise" }], // non-empty palette
        night_vibe_derived: [{ tenant: "casey", id: "a-cozy-braise", embedding: JSON.stringify(axis(3)) }],
        pending_proposals: [
          pendingRow("p-early", "a quick chicken stir-fry", "2026-07-01T00:00:00Z"),
          pendingRow("p-late", "a mild chicken stir-fry", "2026-07-05T00:00:00Z"),
        ],
      },
    });
    const res = await runDerivation(d1.env, "casey", 20260709);
    expect(res.source).toBe("none");
    expect(res.enqueued).toBe(0);
    expect(res.superseded).toBe(1); // the sweep still collapsed the stir-fry pair
    expect(vi.mocked(nameCluster)).not.toHaveBeenCalled();
    expect(vi.mocked(starterVibesFromTaste)).not.toHaveBeenCalled();
  });

  it("an empty-palette member still cold-starts and enqueues", async () => {
    embedRegistry.set("a bright grain bowl", axis(11));
    vi.mocked(starterVibesFromTaste).mockResolvedValue([{ id: "a-bright-grain-bowl", vibe: "a bright grain bowl" }]);
    const d1 = fakeD1({ tables: { night_vibes: [], pending_proposals: [] } });
    const res = await runDerivation(d1.env, "casey", 20260709);
    expect(res.source).toBe("cold_start");
    expect(res.enqueued).toBe(1);
    expect(vi.mocked(starterVibesFromTaste)).toHaveBeenCalledTimes(1);
  });
});
