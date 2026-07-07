// runProposeMealPlan — the shared propose op (member-app-propose): per-slot facet pins
// (D2), recipe pins + alternates (D3), freeform/override/protein nudges (D4), the
// cache-gated embed batch (D5), weather-category legibility (D9), and the D10
// determinism invariant ("same choices in, same week out") across every new param.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  runProposeMealPlan,
  FREEFORM_NUDGE_WEIGHT,
  type ProposeDeps,
  type ProposeInput,
} from "../src/meal-plan-proposal-tool.js";
import { EMBED_DIM, embedCacheKey } from "../src/embedding.js";
import { emptyIngredientContext } from "../src/corpus-db.js";
import type { Overlay } from "../src/overlay.js";
import type { Env } from "../src/env.js";
import type { Tenant } from "../src/tenant.js";
import { fakeD1 } from "./fake-d1.js";

const TENANT: Tenant = { id: "casey" };

/** An EMBED_DIM one-hot (plus small leakage components) — synthetic, deterministic vectors
 *  whose cosine ordering the tests control exactly. */
function axis(...on: [number, number][]): number[] {
  const v = new Array<number>(EMBED_DIM).fill(0);
  for (const [i, w] of on) v[i] = w;
  return v;
}

interface RecipeFixture {
  slug: string;
  title: string;
  protein: string;
  cuisine: string;
  time_total: number;
  vec: number[];
}

// A small corpus with distinct axes: the "seafood" direction is axis 0/3, "comfort" 1/2.
const CORPUS: RecipeFixture[] = [
  { slug: "salmon-rice", title: "Salmon Rice", protein: "fish", cuisine: "japanese", time_total: 30, vec: axis([0, 1]) },
  { slug: "fish-tacos", title: "Fish Tacos", protein: "fish", cuisine: "mexican", time_total: 20, vec: axis([3, 1], [0, 0.2]) },
  { slug: "chicken-soup", title: "Chicken Soup", protein: "chicken", cuisine: "american", time_total: 30, vec: axis([1, 1]) },
  { slug: "beef-ragu", title: "Beef Ragu", protein: "beef", cuisine: "italian", time_total: 60, vec: axis([2, 1], [1, 0.2]) },
  { slug: "veggie-curry", title: "Veggie Curry", protein: "vegetarian", cuisine: "indian", time_total: 45, vec: axis([4, 1]) },
];

function recipeRows() {
  return CORPUS.map((r) => ({
    slug: r.slug,
    title: r.title,
    protein: r.protein,
    cuisine: r.cuisine,
    time_total: r.time_total,
    ingredients_key: null,
    source_url: null,
    tags: null,
    course: null,
    season: null,
    dietary: null,
    pairs_with: null,
    perishable_ingredients: null,
    requires_equipment: null,
    extra: null,
    discovered_at: null,
  }));
}
function derivedRows() {
  return CORPUS.map((r) => ({ slug: r.slug, embedding: JSON.stringify(r.vec), description: null }));
}

/** In-memory KV (the embed cache). */
function memKv() {
  const store = new Map<string, string>();
  return {
    store,
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
  };
}

interface Vibe {
  id: string;
  vibe: string;
  facets?: Record<string, unknown>;
  vec?: number[];
}

/** Assemble the op's env: fakeD1 domain tables + embed-cache KV + a spy AI binding that
 *  embeds by a fixed phrase→vector table (throwing on anything unexpected keeps the
 *  zero-AI-call assertions honest). */
function proposeEnv(vibes: Vibe[], opts: { phraseVecs?: Record<string, number[]>; profile?: Record<string, unknown> } = {}) {
  const d1 = fakeD1({
    tables: {
      recipes: recipeRows(),
      recipe_derived: derivedRows(),
      night_vibes: vibes.map((v) => ({
        tenant: TENANT.id,
        id: v.id,
        vibe: v.vibe,
        facets: v.facets ? JSON.stringify(v.facets) : null,
        cadence_days: null,
        pinned: 0,
        base_weight: null,
        weather_affinity: null,
        weather_antipathy: null,
        season: null,
        created_at: null,
      })),
      night_vibe_derived: vibes
        .filter((v) => v.vec)
        .map((v) => ({ tenant: TENANT.id, id: v.id, embedding: JSON.stringify(v.vec) })),
      profile: opts.profile ? [{ tenant: TENANT.id, ...opts.profile }] : [],
      brand_prefs: [],
      pantry: [],
      cooking_log: [],
    },
  });
  const kv = memKv();
  const ai = vi.fn(async (_model: string, input: { text: string | string[] }) => {
    const texts = Array.isArray(input.text) ? input.text : [input.text];
    return {
      data: texts.map((t) => {
        const vec = opts.phraseVecs?.[t];
        if (!vec) throw new Error(`unexpected embed of "${t}"`);
        return vec;
      }),
    };
  });
  const env = { ...(d1.env as object), KROGER_KV: kv, AI: { run: ai } } as unknown as Env;
  return { env, ai, kv, d1 };
}

function stubDeps(env: Env, over: { overlay?: Overlay } = {}): ProposeDeps {
  return {
    getOverlay: async () => over.overlay ?? {},
    getLastCookedMap: async () => new Map(),
    getOwnedEquipment: async () => [],
    getIngredientContext: async () => emptyIngredientContext(env),
  };
}

/** The two-vibe fixture most tests use: a seafood night + a comfort night, no facets. */
const SEAFOOD: Vibe = { id: "seafood-night", vibe: "something from the sea", vec: axis([0, 1], [3, 0.6]) };
const COMFORT: Vibe = { id: "comfort-night", vibe: "cozy comfort food", vec: axis([1, 1], [2, 0.6]) };

const BASE: ProposeInput = { nights: 2, seed: 7 };

/** The default forecast stub: upstream down → no weather signal (all-flex week). */
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 503 })));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function slotOf(result: Awaited<ReturnType<typeof runProposeMealPlan>>, vibeId: string) {
  const slot = result.plan.find((s) => s.vibe_id === vibeId);
  expect(slot, `slot for ${vibeId}`).toBeDefined();
  return slot!;
}

describe("runProposeMealPlan — baseline", () => {
  it("fills the week with ZERO AI calls, deterministically; empty new-param forms are no-ops", async () => {
    const { env, ai } = proposeEnv([SEAFOOD, COMFORT]);
    const deps = stubDeps(env);
    const r1 = await runProposeMealPlan(env, TENANT, BASE, deps);
    const r2 = await runProposeMealPlan(env, TENANT, BASE, deps);
    expect(ai).not.toHaveBeenCalled(); // no freeform/override text ⇒ no Workers AI request
    expect(r1).toEqual(r2);
    expect(r1.diagnostics.filled).toBe(2);
    // The additive params' EMPTY forms change nothing (absence ≡ empty).
    const r3 = await runProposeMealPlan(env, TENANT, { ...BASE, slots: [], nudges: {} }, deps);
    expect(r3).toEqual(r1);
    // Pin the fixture's mains so an accidental reorder of the unchanged pipeline shows up.
    expect(r1.plan.map((s) => s.main?.slug).sort()).toEqual(["chicken-soup", "salmon-rice"]);
  });

  it("returns alternates from each slot's ranked pool: week-deduped, bounded, gate-honest", async () => {
    const { env } = proposeEnv([SEAFOOD, COMFORT]);
    const r = await runProposeMealPlan(env, TENANT, BASE, stubDeps(env));
    const mains = new Set(r.plan.map((s) => s.main?.slug));
    for (const slot of r.plan) {
      expect(slot.alternates.length).toBeLessThanOrEqual(6);
      for (const alt of slot.alternates) {
        expect(mains.has(alt.slug)).toBe(false); // never a recipe already used by the week
        expect(alt).toEqual({
          slug: alt.slug,
          title: expect.any(String),
          protein: expect.any(String),
          cuisine: expect.any(String),
          time_total: expect.any(Number),
        });
      }
      // alt_similar / alt_different come from the same remaining pool.
      const remaining = new Set(slot.alternates.map((a) => a.slug));
      if (slot.alt_similar) expect(remaining.has(slot.alt_similar.slug)).toBe(true);
      if (slot.alt_different) {
        expect(slot.alt_different.cuisine).not.toBe(slot.main?.cuisine);
      }
    }
  });

  it("a rejected recipe appears in no pool, main, or alternate", async () => {
    const { env } = proposeEnv([SEAFOOD, COMFORT]);
    const r = await runProposeMealPlan(env, TENANT, BASE, stubDeps(env, { overlay: { "beef-ragu": { reject: true } } }));
    for (const slot of r.plan) {
      expect(slot.main?.slug).not.toBe("beef-ragu");
      expect(slot.alternates.map((a) => a.slug)).not.toContain("beef-ragu");
      expect(slot.alt_similar?.slug).not.toBe("beef-ragu");
      expect(slot.alt_different?.slug).not.toBe("beef-ragu");
    }
  });
});

describe("per-slot facet pins (D2)", () => {
  it("a protein pin narrows ONE night's gate; the other slot is unaffected", async () => {
    const { env } = proposeEnv([SEAFOOD, COMFORT]);
    const deps = stubDeps(env);
    const base = await runProposeMealPlan(env, TENANT, BASE, deps);
    const pinned = await runProposeMealPlan(
      env,
      TENANT,
      { ...BASE, slots: [{ vibe_id: COMFORT.id, protein: "fish" }] },
      deps,
    );
    const comfort = slotOf(pinned, COMFORT.id);
    expect(comfort.main?.protein).toBe("fish");
    for (const alt of comfort.alternates) expect(alt.protein).toBe("fish");
    // The un-pinned slot picks what the baseline picked (its pool is untouched)...
    const seafoodBase = slotOf(base, SEAFOOD.id);
    const seafoodPinned = slotOf(pinned, SEAFOOD.id);
    expect(seafoodPinned.main?.slug).toBe(seafoodBase.main?.slug);
    // ...and its ALTERNATES still span proteins (no leak of the other slot's pin).
    expect(new Set(seafoodPinned.alternates.map((a) => a.protein)).size).toBeGreaterThan(1);
  });

  it("time-cap precedence: slot pin > global nudge > vibe facet; null LIFTS the vibe's cap", async () => {
    const timed: Vibe = { ...COMFORT, facets: { max_time_total: 30 } };
    const { env } = proposeEnv([SEAFOOD, timed]);
    const deps = stubDeps(env);
    const reachable = (r: Awaited<ReturnType<typeof runProposeMealPlan>>, vibeId: string) => {
      const s = slotOf(r, vibeId);
      return [s.main?.slug, ...s.alternates.map((a) => a.slug)].filter(Boolean) as string[];
    };

    // Vibe facet alone: the 60-minute ragu is gated out of the comfort slot.
    const base = await runProposeMealPlan(env, TENANT, BASE, deps);
    expect(reachable(base, timed.id)).not.toContain("beef-ragu");

    // Global nudge tightens BOTH slots below the vibe's own cap.
    const global = await runProposeMealPlan(env, TENANT, { ...BASE, nudges: { max_time_total: 25 } }, deps);
    for (const slug of [...reachable(global, timed.id), ...reachable(global, SEAFOOD.id)]) {
      expect(CORPUS.find((r) => r.slug === slug)!.time_total).toBeLessThanOrEqual(25);
    }

    // A slot pin OVERRIDES the global nudge for that night only.
    const slotWins = await runProposeMealPlan(
      env,
      TENANT,
      { ...BASE, nudges: { max_time_total: 25 }, slots: [{ vibe_id: timed.id, max_time_total: 45 }] },
      deps,
    );
    const upTo45 = reachable(slotWins, timed.id).map((s) => CORPUS.find((r) => r.slug === s)!.time_total);
    expect(Math.max(...upTo45)).toBeGreaterThan(25); // the 45-minute tier is reachable again
    for (const slug of reachable(slotWins, SEAFOOD.id)) {
      expect(CORPUS.find((r) => r.slug === slug)!.time_total).toBeLessThanOrEqual(25); // other slot: global holds
    }

    // An EXPLICIT null lifts the vibe's own cap entirely (absence cannot express this).
    const lifted = await runProposeMealPlan(
      env,
      TENANT,
      { ...BASE, slots: [{ vibe_id: timed.id, max_time_total: null }] },
      deps,
    );
    expect(reachable(lifted, timed.id)).toContain("beef-ragu");
  });

  it("an over-constrained pin surfaces an explicit empty slot (with its pool's alternates as the escape hatch)", async () => {
    const { env } = proposeEnv([SEAFOOD, COMFORT]);
    const r = await runProposeMealPlan(
      env,
      TENANT,
      { ...BASE, slots: [{ vibe_id: COMFORT.id, protein: "shellfish" }] }, // no shellfish in the corpus
      stubDeps(env),
    );
    const slot = slotOf(r, COMFORT.id);
    expect(slot.main).toBeNull();
    expect(slot.empty_reason).toMatch(/no retrievable candidate/);
    expect(slot.alternates).toEqual([]); // the pool itself is empty — nothing to escape to
    expect(r.diagnostics.empty).toBe(1); // the rest of the week is still proposed
  });

  it("constraints for an unsampled vibe are INERT — same week, no error, no embed", async () => {
    const { env, ai } = proposeEnv([SEAFOOD, COMFORT]);
    const deps = stubDeps(env);
    const base = await runProposeMealPlan(env, TENANT, BASE, deps);
    const withGhost = await runProposeMealPlan(
      env,
      TENANT,
      { ...BASE, slots: [{ vibe_id: "ghost-vibe", protein: "fish", vibe: "never embedded", recipe: "salmon-rice" }] },
      deps,
    );
    expect(withGhost).toEqual(base);
    expect(ai).not.toHaveBeenCalled(); // the unsampled override phrase is never embedded
  });
});

describe("recipe pins (D3)", () => {
  it("fills the slot with vibe identity intact and diversifies the rest of the week away", async () => {
    const { env } = proposeEnv([SEAFOOD, COMFORT]);
    // Pin the recipe the OTHER slot would otherwise pick, case-insensitively.
    const r = await runProposeMealPlan(
      env,
      TENANT,
      { ...BASE, slots: [{ vibe_id: COMFORT.id, recipe: "Salmon-Rice" }] },
      stubDeps(env),
    );
    const comfort = slotOf(r, COMFORT.id);
    expect(comfort.main?.slug).toBe("salmon-rice");
    expect(comfort.vibe_id).toBe(COMFORT.id); // identity preserved — NOT detached to a lock
    expect(comfort.recipe_pinned).toBe(true);
    expect(comfort.why[0]).toBe("your pick");
    expect(["pinned", "overdue", "sampled"]).toContain(comfort.reason);
    // The pinned recipe is admitted up-front: the seafood slot diversifies away from it.
    const seafood = slotOf(r, SEAFOOD.id);
    expect(seafood.main?.slug).not.toBe("salmon-rice");
    expect(seafood.alternates.map((a) => a.slug)).not.toContain("salmon-rice");
  });

  it("an unknown pin surfaces as an explicit empty slot that keeps its alternates", async () => {
    const { env } = proposeEnv([SEAFOOD, COMFORT]);
    const r = await runProposeMealPlan(
      env,
      TENANT,
      { ...BASE, slots: [{ vibe_id: COMFORT.id, recipe: "ghost-recipe" }] },
      stubDeps(env),
    );
    const slot = slotOf(r, COMFORT.id);
    expect(slot.main).toBeNull();
    expect(slot.empty_reason).toMatch(/pinned recipe 'ghost-recipe' is unavailable/);
    expect(slot.alternates.length).toBeGreaterThan(0); // the escape hatch stays open
  });

  it("exclude beats a recipe pin (and a rejected pin is refused the same way)", async () => {
    const { env } = proposeEnv([SEAFOOD, COMFORT]);
    const excluded = await runProposeMealPlan(
      env,
      TENANT,
      { ...BASE, exclude: ["salmon-rice"], slots: [{ vibe_id: COMFORT.id, recipe: "salmon-rice" }] },
      stubDeps(env),
    );
    const exSlot = slotOf(excluded, COMFORT.id);
    expect(exSlot.main).toBeNull();
    expect(exSlot.empty_reason).toMatch(/unavailable/);
    for (const slot of excluded.plan) {
      expect(slot.main?.slug).not.toBe("salmon-rice");
      expect(slot.alternates.map((a) => a.slug)).not.toContain("salmon-rice");
    }
    const rejected = await runProposeMealPlan(
      env,
      TENANT,
      { ...BASE, slots: [{ vibe_id: COMFORT.id, recipe: "beef-ragu" }] },
      stubDeps(env, { overlay: { "beef-ragu": { reject: true } } }),
    );
    const rejSlot = slotOf(rejected, COMFORT.id);
    expect(rejSlot.main).toBeNull();
    expect(rejSlot.empty_reason).toMatch(/unavailable/);
  });
});

describe("vibe overrides + nudges (D4/D5)", () => {
  it("a slots[].vibe override fills a NOT-YET-EMBEDDED vibe in one batched AI call and marks the slot", async () => {
    const fresh: Vibe = { id: "fresh-vibe", vibe: "brand new idea" }; // no derived vector
    const phrase = "big pot of soup";
    const { env, ai } = proposeEnv([SEAFOOD, fresh], { phraseVecs: { [phrase]: axis([1, 1]) } });
    const deps = stubDeps(env);

    const before = await runProposeMealPlan(env, TENANT, BASE, deps);
    const emptySlot = slotOf(before, fresh.id);
    expect(emptySlot.main).toBeNull();
    expect(emptySlot.empty_reason).toMatch(/no retrievable candidate/);

    const after = await runProposeMealPlan(
      env,
      TENANT,
      { ...BASE, slots: [{ vibe_id: fresh.id, vibe: phrase }] },
      deps,
    );
    const filled = slotOf(after, fresh.id);
    expect(filled.main).not.toBeNull();
    expect(filled.main?.slug).toBe("chicken-soup"); // the phrase vector points at the soup axis
    expect(filled.vibe_override).toBe(true);
    expect(ai).toHaveBeenCalledTimes(1); // ONE batched call for the one uncached phrase
  });

  it("freeform served from the WARM cache reshapes ranking with zero AI calls and explains itself", async () => {
    const phrase = "more fish dinners";
    // One vibe sitting exactly BETWEEN the salmon and soup axes — the freeform nudge is
    // the tiebreaker (bounded and subordinate, so the fixture makes the tie explicit).
    const dinner: Vibe = { id: "dinner", vibe: "something good", vec: axis([0, 1], [1, 1]) };
    const { env, ai, kv } = proposeEnv([dinner]);
    // Pre-warm the cache with the phrase's vector (pointing hard at the salmon axis).
    kv.store.set(await embedCacheKey(phrase), JSON.stringify(axis([0, 1])));
    const deps = stubDeps(env);
    const r = await runProposeMealPlan(env, TENANT, { nights: 1, seed: 7, nudges: { freeform: phrase } }, deps);
    expect(ai).not.toHaveBeenCalled(); // cache hit — the embed path ran without Workers AI
    const matched = r.plan.find((s) => s.main?.slug === "salmon-rice");
    expect(matched).toBeDefined();
    expect(matched!.why.join(" ")).toContain("matches your ask");
    expect(FREEFORM_NUDGE_WEIGHT).toBeCloseTo(0.15);
  });

  it("nudges.proteins soft-boosts (why included) without gating other proteins out of the pool", async () => {
    const { env } = proposeEnv([SEAFOOD, COMFORT]);
    const r = await runProposeMealPlan(env, TENANT, { ...BASE, nudges: { proteins: ["fish"] } }, stubDeps(env));
    const fishMain = r.plan.find((s) => s.main?.protein === "fish");
    expect(fishMain).toBeDefined();
    expect(fishMain!.why.join(" ")).toContain("the fish you asked for");
    // Soft, never a gate: non-fish candidates survive in the pools (alternates).
    const proteins = new Set(r.plan.flatMap((s) => s.alternates.map((a) => a.protein)));
    expect([...proteins].some((p) => p !== "fish")).toBe(true);
  });
});

describe("weather-category legibility (D9)", () => {
  it("a slot placed by a non-mild quota carries weather_category and the weather-fit why", async () => {
    // A hot, dry week: every day derives to the `grill` category.
    const geocode = { results: [{ latitude: 39.1, longitude: -84.5, name: "Cincinnati", admin1: "Ohio" }] };
    const day = (d: string) => d;
    const forecast = {
      daily: {
        time: ["2026-07-06", "2026-07-07", "2026-07-08", "2026-07-09", "2026-07-10", "2026-07-11", "2026-07-12"].map(day),
        temperature_2m_max: new Array(7).fill(92),
        temperature_2m_min: new Array(7).fill(70),
        precipitation_probability_max: new Array(7).fill(5),
        weathercode: new Array(7).fill(0),
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) =>
        String(url).includes("geocoding-api")
          ? new Response(JSON.stringify(geocode), { status: 200 })
          : new Response(JSON.stringify(forecast), { status: 200 }),
      ),
    );
    const { env } = proposeEnv([SEAFOOD, COMFORT], { profile: { stores: JSON.stringify({ location_zip: "45208" }) } });
    const r = await runProposeMealPlan(env, TENANT, BASE, stubDeps(env));
    const withCategory = r.plan.filter((s) => s.weather_category === "grill");
    expect(withCategory.length).toBeGreaterThan(0);
    for (const slot of withCategory) {
      expect(slot.why).toContain("fits this window's grill weather");
    }
  });
});

describe("determinism across every new param (D10)", () => {
  it("the full request — pins, override, recipe pin, freeform, proteins, lock, exclude — run twice deep-equals", async () => {
    const phrase = "bright and fresh";
    const override = "slow sunday braise";
    const { env, ai } = proposeEnv([SEAFOOD, COMFORT, { id: "third-night", vibe: "whatever works", vec: axis([4, 1]) }], {
      phraseVecs: { [phrase]: axis([3, 1]), [override]: axis([2, 1]) },
    });
    const deps = stubDeps(env);
    const input: ProposeInput = {
      nights: 4, // one night locked + three sampled slots, so all three vibes are in play
      seed: 11,
      lock: ["Veggie-Curry"],
      exclude: ["chicken-soup"],
      boost_ingredients: ["salmon"],
      nudges: { max_time_total: 60, variety: 0.5, freeform: phrase, proteins: ["fish"] },
      slots: [
        { vibe_id: SEAFOOD.id, protein: "fish", max_time_total: null },
        { vibe_id: COMFORT.id, vibe: override },
        { vibe_id: "third-night", recipe: "Beef-Ragu" },
      ],
    };
    const r1 = await runProposeMealPlan(env, TENANT, input, deps); // cold cache — warms it
    const embedCallsAfterFirst = ai.mock.calls.length;
    expect(embedCallsAfterFirst).toBe(1); // ONE batched call covered freeform + override
    expect((ai.mock.calls[0][1] as { text: string[] }).text).toEqual([phrase, override]);

    const r2 = await runProposeMealPlan(env, TENANT, input, deps); // warm — byte-identical vectors
    const r3 = await runProposeMealPlan(env, TENANT, input, deps);
    expect(ai.mock.calls.length).toBe(embedCallsAfterFirst); // no further AI once cached
    expect(r2).toEqual(r1);
    expect(r3).toEqual(r1);

    // The new params actually took hold in the result being pinned.
    expect(r1.plan.find((s) => s.reason === "locked")?.main?.slug).toBe("veggie-curry");
    expect(slotOf(r1, "third-night").recipe_pinned).toBe(true);
    expect(slotOf(r1, COMFORT.id).vibe_override).toBe(true);
    expect(r1.plan.every((s) => s.main?.slug !== "chicken-soup")).toBe(true);
  });

  it("changing only the seed yields a different valid week (inputs, not state, drive the plan)", async () => {
    const { env } = proposeEnv([SEAFOOD, COMFORT, { id: "third-night", vibe: "whatever works", vec: axis([4, 1]) }]);
    const deps = stubDeps(env);
    const weeks = new Set<string>();
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const r = await runProposeMealPlan(env, TENANT, { nights: 2, seed }, deps);
      weeks.add(r.plan.map((s) => `${s.vibe_id}:${s.main?.slug}`).join("|"));
      expect(r.plan.filter((s) => s.main).length).toBeGreaterThan(0);
    }
    expect(weeks.size).toBeGreaterThan(1);
  });
});
