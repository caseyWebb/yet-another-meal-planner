import { describe, it, expect } from "vitest";
import { auditAliases, type AliasAuditDeps } from "../src/ingredient-alias-audit.js";
import type { AliasAuditRow, IdentitySourceRow, Resolution } from "../src/corpus-db.js";
import type { IdentityConfirm, ScoredCandidate } from "../src/ingredient-classify.js";
import { ToolError } from "../src/errors.js";

type Harness = {
  deps: AliasAuditDeps;
  committed: Resolution[];
  merges: { loser: string; survivor: string }[];
  stamped: string[];
  confirmCalls: number;
  embedCalls: number;
  lastCandidates: ScoredCandidate[];
};

function harness(opts: {
  batch: AliasAuditRow[];
  /** The FULL alias table (defaults to the batch — every mapping under audit). */
  aliases?: AliasAuditRow[];
  identities?: IdentitySourceRow[];
  vectors?: { id: string; embedding: number[] }[];
  knownIds?: string[];
  confirm?: (term: string, candidates: ScoredCandidate[]) => Promise<IdentityConfirm>;
  maxPerTick?: number;
}): Harness {
  const h = {
    committed: [] as Resolution[],
    merges: [] as { loser: string; survivor: string }[],
    stamped: [] as string[],
    confirmCalls: 0,
    embedCalls: 0,
    lastCandidates: [] as ScoredCandidate[],
  } as Harness;
  h.deps = {
    loadBatch: async (limit) => opts.batch.slice(0, limit),
    aliasTargets: async () => (opts.aliases ?? opts.batch).map((a) => ({ ...a })),
    identities: async () => (opts.identities ?? []).map((i) => ({ ...i })),
    identityEmbeddings: async () => (opts.vectors ?? []).map((v) => ({ ...v })),
    knownIds: async () =>
      new Set([
        ...(opts.knownIds ?? []),
        ...(opts.identities ?? []).map((i) => i.id),
        ...(opts.aliases ?? opts.batch).map((a) => a.variant),
      ]),
    embed: async (texts) => {
      h.embedCalls++;
      return texts.map(() => [1, 0, 0]); // every variant embeds to the same unit vector
    },
    confirm: async (term, candidates) => {
      h.confirmCalls++;
      h.lastCandidates = candidates;
      if (!opts.confirm) throw new Error("confirm not expected");
      return opts.confirm(term, candidates);
    },
    commit: async (r) => {
      h.committed.push(r);
    },
    merge: async (loser, survivor) => {
      h.merges.push({ loser, survivor });
    },
    stamp: async (variant) => {
      h.stamped.push(variant);
    },
    now: () => 1000,
    maxPerTick: opts.maxPerTick ?? 20,
    confirmMin: 0.72,
    topK: 10,
  };
  return h;
}

const confirm = (o: Partial<IdentityConfirm>): IdentityConfirm => ({
  outcome: "novel",
  match: null,
  detail: null,
  canonical: null,
  concrete: true,
  edges: [],
  reason: "",
  ...o,
});

const auto = (id: string, representative: string | null = null): IdentitySourceRow => ({
  id,
  representative,
  source: "auto",
});

describe("auditAliases", () => {
  it("stamps a SELF-alias deterministically — no embedding, no classifier, no log", async () => {
    const h = harness({ batch: [{ variant: "olive oil", id: "olive oil" }] });
    const s = await auditAliases(h.deps);
    expect(h.stamped).toEqual(["olive oil"]);
    expect(h.embedCalls).toBe(0);
    expect(h.confirmCalls).toBe(0);
    expect(h.committed).toHaveLength(0);
    expect(s).toMatchObject({ audited: 1, self_stamped: 1, kept: 0, skipped: 0 });
  });

  it("re-points a HIGH-cosine distinct-product alias via the classifier (the sesame-seeds class)", async () => {
    // 'sesame seeds' → toasted sesame seeds::toast cosines at 1.0 here — far above the guard —
    // and must STILL be re-audited: the pre-filter stamps self-aliases only.
    const h = harness({
      batch: [{ variant: "sesame seeds", id: "toasted sesame seeds::toast" }],
      aliases: [
        { variant: "sesame seeds", id: "toasted sesame seeds::toast" },
        { variant: "toasted sesame seeds", id: "toasted sesame seeds::toast" }, // node keeps a real alias
      ],
      identities: [auto("toasted sesame seeds::toast")],
      vectors: [{ id: "toasted sesame seeds::toast", embedding: [1, 0, 0] }],
      confirm: async () => confirm({ outcome: "novel", canonical: "sesame seeds" }),
    });
    const s = await auditAliases(h.deps);
    expect(h.confirmCalls).toBe(1);
    const r = h.committed[0];
    expect(r.id).toBe("sesame seeds"); // minted under the classifier's canonical
    expect(r.node).toBeTruthy();
    expect(r.log).toMatchObject({
      outcome: "novel",
      detail: { audit: "alias", previous_id: "toasted sesame seeds::toast" },
    });
    // The old node keeps another alias → NOT merged away.
    expect(h.merges).toHaveLength(0);
    expect(s).toMatchObject({ audited: 1, minted: 1, merged: 0 });
  });

  it("guard-rejects a distant pick to a verbatim mint AND merges the stranded wrong-mint node", async () => {
    // The flagship fixture: even if the classifier repeats its old pick, the distance guard
    // rejects it (cosine 0 < 0.72), the variant mints verbatim, and the junk node — now
    // alias-less — is merged into the re-decision's resolved node.
    const h = harness({
      batch: [{ variant: "flaky sea salt", id: "fish sauce::type-sea-salt" }],
      identities: [auto("fish sauce::type-sea-salt"), auto("fish sauce")],
      vectors: [
        { id: "fish sauce::type-sea-salt", embedding: [0, 1, 0] }, // cosine 0 to the variant
        { id: "fish sauce", embedding: [0, 1, 0] },
      ],
      confirm: async () => confirm({ outcome: "same", match: "fish sauce::type-sea-salt" }),
    });
    const s = await auditAliases(h.deps);
    const r = h.committed[0];
    expect(r.id).toBe("flaky sea salt"); // verbatim NOVEL mint
    expect(r.log.detail).toMatchObject({
      audit: "alias",
      previous_id: "fish sauce::type-sea-salt",
      note: "confirm_below_min",
      rejected: { outcome: "same", match: "fish sauce::type-sea-salt", score: 0 },
    });
    expect(h.merges).toEqual([{ loser: "fish sauce::type-sea-salt", survivor: "flaky sea salt" }]);
    expect(s).toMatchObject({ audited: 1, minted: 1, merged: 1 });
  });

  it("re-points to an existing node on `same` (above guard) and merges the stranded spec node", async () => {
    const h = harness({
      batch: [{ variant: "salmon fillets skin-on", id: "salmon fillets, skin-on::species-atlantic" }],
      identities: [auto("salmon fillets, skin-on::species-atlantic"), auto("salmon fillets, skin-on")],
      vectors: [
        { id: "salmon fillets, skin-on::species-atlantic", embedding: [1, 0, 0] },
        { id: "salmon fillets, skin-on", embedding: [1, 0, 0] },
      ],
      confirm: async () => confirm({ outcome: "same", match: "salmon fillets, skin-on" }),
    });
    const s = await auditAliases(h.deps);
    const r = h.committed[0];
    expect(r.id).toBe("salmon fillets, skin-on");
    expect(r.node).toBeUndefined(); // a re-point, not a mint
    expect(h.merges).toEqual([
      { loser: "salmon fillets, skin-on::species-atlantic", survivor: "salmon fillets, skin-on" },
    ]);
    expect(s).toMatchObject({ audited: 1, repointed: 1, merged: 1 });
  });

  it("keeps a mapping the classifier re-affirms (same on the current survivor) — no merge", async () => {
    const h = harness({
      batch: [{ variant: "scallions", id: "green onion" }],
      identities: [auto("green onion")],
      vectors: [{ id: "green onion", embedding: [1, 0, 0] }],
      confirm: async () => confirm({ outcome: "same", match: "green onion" }),
    });
    const s = await auditAliases(h.deps);
    expect(h.committed[0].id).toBe("green onion"); // re-committed = kept + born-stamped
    expect(h.merges).toHaveLength(0);
    expect(s).toMatchObject({ audited: 1, kept: 1, repointed: 0, merged: 0 });
  });

  it("mints a specialization under the matched base (above guard)", async () => {
    const h = harness({
      batch: [{ variant: "80/20 ground beef", id: "lean ground beef" }],
      identities: [auto("lean ground beef"), auto("ground beef")],
      vectors: [
        { id: "lean ground beef", embedding: [1, 0, 0] },
        { id: "ground beef", embedding: [1, 0, 0] },
      ],
      confirm: async () => confirm({ outcome: "specialization", match: "ground beef", detail: "fat-80-20" }),
    });
    const s = await auditAliases(h.deps);
    expect(h.committed[0].id).toBe("ground beef::fat-80-20");
    expect(h.committed[0].node).toBeTruthy();
    expect(s).toMatchObject({ audited: 1, minted: 1 });
  });

  it("never orphan-merges a HUMAN node, even when the re-point strands it", async () => {
    const h = harness({
      batch: [{ variant: "flaky sea salt", id: "fish sauce::type-sea-salt" }],
      identities: [{ id: "fish sauce::type-sea-salt", representative: null, source: "human" }],
      vectors: [{ id: "fish sauce::type-sea-salt", embedding: [0, 1, 0] }],
      confirm: async () => confirm({ outcome: "novel", canonical: "flaky sea salt" }),
    });
    const s = await auditAliases(h.deps);
    expect(h.committed[0].id).toBe("flaky sea salt");
    expect(h.merges).toHaveLength(0); // human node stays, orphaned or not
    expect(s).toMatchObject({ minted: 1, merged: 0 });
  });

  it("always shows the currently-mapped survivor to the confirm, unscored when unembedded", async () => {
    const h = harness({
      batch: [{ variant: "canned salmon", id: "salmon fillets, skin-on::form-canned" }],
      identities: [auto("salmon fillets, skin-on::form-canned"), auto("tuna in water")],
      // The mapped node has NO stored embedding → it can't rank; it must still be a candidate.
      vectors: [{ id: "tuna in water", embedding: [1, 0, 0] }],
      confirm: async () => confirm({ outcome: "novel", canonical: "canned salmon" }),
    });
    await auditAliases(h.deps);
    expect(h.lastCandidates).toContainEqual({ id: "salmon fillets, skin-on::form-canned" }); // unscored
    expect(h.lastCandidates.some((c) => c.id === "tuna in water" && c.score === 1)).toBe(true);
  });

  it("KEEPS the standing mapping and stamps it on a contract-invalid confirm (never destroy on undecidable)", async () => {
    const h = harness({
      batch: [{ variant: "dried medjool dates", id: "dried fruit blend::type-medjool-dates" }],
      identities: [auto("dried fruit blend::type-medjool-dates")],
      vectors: [{ id: "dried fruit blend::type-medjool-dates", embedding: [1, 0, 0] }],
      confirm: async () => {
        throw new ToolError("validation_failed", "bad output");
      },
    });
    const s = await auditAliases(h.deps);
    const r = h.committed[0];
    expect(r.id).toBe("dried fruit blend::type-medjool-dates"); // the keep = re-commit of the same mapping
    expect(r.node).toBeUndefined();
    expect(r.log.detail).toMatchObject({ audit: "alias", note: "confirm_failed_safe" });
    expect(h.merges).toHaveLength(0);
    expect(s).toMatchObject({ audited: 1, kept: 1, skipped: 0 });
  });

  it("skips a row un-stamped on a transient error (retried next tick), nothing written", async () => {
    const h = harness({
      batch: [{ variant: "mystery", id: "olive oil" }],
      identities: [auto("olive oil")],
      vectors: [{ id: "olive oil", embedding: [1, 0, 0] }],
      confirm: async () => {
        throw new ToolError("storage_error", "AI down");
      },
    });
    const s = await auditAliases(h.deps);
    expect(h.committed).toHaveLength(0);
    expect(h.stamped).toHaveLength(0); // un-stamped IS the retry state
    expect(s).toMatchObject({ audited: 0, skipped: 1 });
  });

  it("bounds the batch per tick", async () => {
    const h = harness({
      batch: [
        { variant: "a", id: "a" },
        { variant: "b", id: "b" },
        { variant: "c", id: "c" },
      ],
      maxPerTick: 2,
    });
    const s = await auditAliases(h.deps);
    expect(s.audited).toBe(2); // the third row waits for the next tick
    expect(h.stamped).toEqual(["a", "b"]);
  });

  it("self-quiesces to a no-op with no model calls when nothing is eligible", async () => {
    const h = harness({ batch: [] });
    const s = await auditAliases(h.deps);
    expect(h.embedCalls).toBe(0);
    expect(h.confirmCalls).toBe(0);
    expect(s).toMatchObject({ audited: 0, self_stamped: 0, skipped: 0 });
  });

  it("lets a later row in the same tick see an earlier row's mint and orphan merge", async () => {
    // Two wrong aliases onto the same junk node: the first re-decision mints + would strand the
    // node — but the second alias still resolves there, so no merge until IT re-points too.
    const calls: string[] = [];
    const h = harness({
      batch: [
        { variant: "flaky sea salt", id: "fish sauce::type-sea-salt" },
        { variant: "sea salt flakes", id: "fish sauce::type-sea-salt" },
      ],
      identities: [auto("fish sauce::type-sea-salt")],
      vectors: [{ id: "fish sauce::type-sea-salt", embedding: [0, 1, 0] }],
      confirm: async (term, candidates) => {
        calls.push(term);
        if (term === "flaky sea salt") return confirm({ outcome: "novel", canonical: "flaky sea salt" });
        // The second variant retrieves the FIRST row's fresh mint as a candidate this same tick.
        expect(candidates.some((c) => c.id === "flaky sea salt")).toBe(true);
        return confirm({ outcome: "same", match: "flaky sea salt" });
      },
    });
    const s = await auditAliases(h.deps);
    expect(calls).toEqual(["flaky sea salt", "sea salt flakes"]);
    // Only after the SECOND re-point does the junk node lose its last alias → exactly one merge.
    expect(h.merges).toEqual([{ loser: "fish sauce::type-sea-salt", survivor: "flaky sea salt" }]);
    expect(s).toMatchObject({ audited: 2, minted: 1, repointed: 1, merged: 1 });
  });
});

describe("auditAliases — calibration guards (normalization-audit-calibration)", () => {
  const PREFIX = "salmon fillets, skin-on::species-atlantic-sockeye";

  it("keeps the standing mapping when a specialization only re-derives it (the sockeye reproduction)", async () => {
    // Production defect A: the confirm re-decided the alias as SPECIALIZATION(match = the
    // already-detailed standing node, detail = that node's own detail) and the unguarded
    // `${match}::${detail}` minted a 3-segment id. The segment guard demotes to SAME → a keep.
    const h = harness({
      batch: [{ variant: "atlantic sockeye salmon fillets", id: PREFIX }],
      identities: [auto(PREFIX), auto("salmon fillets, skin-on")],
      vectors: [
        { id: PREFIX, embedding: [1, 0, 0] },
        { id: "salmon fillets, skin-on", embedding: [1, 0, 0] },
      ],
      confirm: async () => confirm({ outcome: "specialization", match: PREFIX, detail: "species-atlantic-sockeye" }),
    });
    const s = await auditAliases(h.deps);
    const r = h.committed[0];
    expect(r.id).toBe(PREFIX); // never `${PREFIX}::species-atlantic-sockeye`
    expect(r.node).toBeUndefined();
    expect(r.log).toMatchObject({
      outcome: "same",
      detail: { audit: "alias", previous_id: PREFIX, note: "specialization_demoted" },
    });
    expect(h.merges).toHaveLength(0);
    expect(s).toMatchObject({ audited: 1, kept: 1, minted: 0, repointed: 0 });
  });

  it("keeps the standing mapping when a NOVEL canonical resolves to it (no verbatim shadow mint)", async () => {
    // Without the guard, the canonical collides with the standing id in `knownIds` and
    // buildResolution falls back to minting the VARIANT verbatim — a duplicate node whose only
    // effect is shadowing the standing mapping.
    const h = harness({
      batch: [{ variant: "atlantic sockeye salmon fillets", id: PREFIX }],
      identities: [auto(PREFIX)],
      vectors: [{ id: PREFIX, embedding: [1, 0, 0] }],
      confirm: async () => confirm({ outcome: "novel", canonical: PREFIX }),
    });
    const s = await auditAliases(h.deps);
    const r = h.committed[0];
    expect(r.id).toBe(PREFIX);
    expect(r.node).toBeUndefined();
    expect(r.log.detail).toMatchObject({ audit: "alias", previous_id: PREFIX, note: "canonical_is_standing" });
    expect(s).toMatchObject({ audited: 1, kept: 1, minted: 0 });
  });

  it("resolves a punctuation-variant alias deterministically — no confirm call, junk node merged", async () => {
    const h = harness({
      batch: [{ variant: "salmon fillets skin-on", id: "junk node" }],
      identities: [auto("junk node"), auto("salmon fillets, skin-on")],
      vectors: [],
      confirm: async () => {
        throw new Error("no confirm expected — the lexical fast path decides");
      },
    });
    const s = await auditAliases(h.deps);
    expect(h.confirmCalls).toBe(0);
    expect(h.committed[0]).toMatchObject({ id: "salmon fillets, skin-on" });
    expect(h.committed[0].log).toMatchObject({
      outcome: "same",
      model: null,
      detail: { audit: "alias", previous_id: "junk node", note: "lexical_match" },
    });
    expect(h.merges).toEqual([{ loser: "junk node", survivor: "salmon fillets, skin-on" }]);
    expect(s).toMatchObject({ audited: 1, repointed: 1, merged: 1 });
  });
});

describe("auditAliases — home-derivable form collapse (home-derivable-form-collapse)", () => {
  it("re-points a home-derivable cut form to its base and merges the stranded detail node (the lime fixture)", async () => {
    // Issue #215: 'lime wedges' → lime::form-wedges was re-opened by the 0042 migration; the
    // hardened confirm answers SAME on the base. The alias re-points to `lime` (a re-commit,
    // fresh auto decided_at, born-stamped) and the detail node — its ONLY alias just moved —
    // is merged into `lime` via the representative pointer. The edge-audit pre-pass then
    // sweeps its structural edge as a self-loop (covered by ingredient-edge-audit.test.ts).
    const h = harness({
      batch: [{ variant: "lime wedges", id: "lime::form-wedges" }],
      identities: [auto("lime::form-wedges"), auto("lime")],
      vectors: [
        { id: "lime::form-wedges", embedding: [1, 0, 0] },
        { id: "lime", embedding: [1, 0, 0] }, // above the confirm-distance guard
      ],
      confirm: async () => confirm({ outcome: "same", match: "lime" }),
    });
    const s = await auditAliases(h.deps);
    expect(h.confirmCalls).toBe(1);
    const r = h.committed[0];
    expect(r.id).toBe("lime"); // the re-point — an alias upsert, not a mint
    expect(r.node).toBeUndefined();
    expect(r.log).toMatchObject({
      outcome: "same",
      resolved_id: "lime",
      detail: { audit: "alias", previous_id: "lime::form-wedges" },
    });
    expect(h.merges).toEqual([{ loser: "lime::form-wedges", survivor: "lime" }]);
    expect(s).toMatchObject({ audited: 1, repointed: 1, merged: 1, minted: 0, kept: 0 });
  });

  it("keeps a purchasable detail mapping the confirm re-derives — no churn, no merge", async () => {
    // The re-opened backlog is ~110 legitimate specializations; re-deriving the standing
    // mapping (SAME on the survivor) is a keep + re-stamp, never a re-point or merge.
    const h = harness({
      batch: [{ variant: "pickle chips", id: "pickles::form-chips" }],
      identities: [auto("pickles::form-chips"), auto("pickles")],
      vectors: [
        { id: "pickles::form-chips", embedding: [1, 0, 0] },
        { id: "pickles", embedding: [1, 0, 0] },
      ],
      confirm: async () => confirm({ outcome: "same", match: "pickles::form-chips" }),
    });
    const s = await auditAliases(h.deps);
    const r = h.committed[0];
    expect(r.id).toBe("pickles::form-chips"); // re-committed = kept + born-stamped
    expect(r.node).toBeUndefined();
    expect(h.merges).toHaveLength(0);
    expect(s).toMatchObject({ audited: 1, kept: 1, repointed: 0, minted: 0, merged: 0 });
  });
});

describe("auditAliases — disjunctive variant disposal (disjunctive-term-modeling)", () => {
  it("re-points a disjunctive variant to a freshly-minted disjunction concept with NO confirm call", async () => {
    const h = harness({
      batch: [{ variant: "white or yellow onion", id: "onions" }],
      aliases: [
        { variant: "white or yellow onion", id: "onions" },
        { variant: "onions", id: "onions" }, // keeps the previous target referenced (no orphan merge)
      ],
      identities: [auto("onions")],
      vectors: [{ id: "onions", embedding: [1, 0, 0] }],
    });
    const s = await auditAliases(h.deps);
    expect(h.confirmCalls).toBe(0);
    expect(h.committed).toHaveLength(1);
    const r = h.committed[0];
    expect(r.id).toBe("white or yellow onion");
    expect(r.node).toMatchObject({ concrete: false, search_term: "white onion" });
    expect(r.log.detail).toMatchObject({ audit: "alias", previous_id: "onions", note: "disjunction_concept" });
    expect(h.merges).toEqual([]); // "onions" still holds its own alias
    expect(s).toMatchObject({ audited: 1, minted: 1, kept: 0, repointed: 0 });
  });

  it("a disjunctive variant lexically matching the standing concept keeps it (lexical runs first)", async () => {
    const h = harness({
      batch: [{ variant: "white or yellow onion!", id: "white or yellow onion" }],
      aliases: [
        { variant: "white or yellow onion!", id: "white or yellow onion" },
        { variant: "white or yellow onion", id: "white or yellow onion" },
      ],
      identities: [auto("white or yellow onion")],
      vectors: [],
    });
    const s = await auditAliases(h.deps);
    expect(h.confirmCalls).toBe(0);
    expect(h.committed[0]).toMatchObject({ id: "white or yellow onion" });
    expect(h.committed[0].node).toBeUndefined(); // lexical keep, no second concept
    expect(s).toMatchObject({ audited: 1, kept: 1 });
  });
});
