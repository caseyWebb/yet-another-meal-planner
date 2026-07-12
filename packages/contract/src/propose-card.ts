// The propose-widget's wire shape (meal-plan-widget). The `display_meal_plan` MCP tool
// populates a `ProposeCardData` from `runProposeMealPlan`'s result and returns it as the
// tool result's `structuredContent`; the bespoke `ui://plan/propose` widget hydrates its
// interactive render from the SAME shape. Kept here in the runtime-agnostic contract so the
// Worker (workerd) that produces it and the browser widget that consumes it share ONE
// definition and cannot drift — the recipe-card precedent (recipe-card.ts).
//
// The result-portion fields (`plan`/`variety`/`uncovered_at_risk`/`diagnostics`/`note`)
// mirror `propose_meal_plan`'s own `ProposeResult` exactly, so the widget parses BOTH the
// initial payload AND a dial-triggered `propose_meal_plan` re-invocation (proxied through the
// host, `App.callServerTool`) with one shape. The `request` + render-context fields
// (`vibeLabels`/`palettePresets`/`proteins`/`cuisines`) are the extra state the widget's dials
// need to replay an adjusted request client-side and populate the facet/vibe pickers.
//
// A `type` (not `interface`), like `RecipeCardData`, so the Worker can pass it directly as an
// MCP tool result's `structuredContent` (a typed `Record<string, unknown>`) — an object-literal
// type alias is assignable to an index-signature target; a named interface is not.

/** The ProposeCardData contract version this build understands (D19). A monotonic int, starting
 *  at 1; additive-only within a major. A widget hydrating a payload whose `contract_version`
 *  exceeds this renders READ-ONLY rather than mis-parsing a newer shape. Versioned INDEPENDENTLY
 *  of `RecipeCardData` (recipe-card.ts). Bump when a field is added/changed. */
export const KNOWN_PROPOSE_CONTRACT_VERSION = 1;

/** A compact swap candidate (one row of a slot's ranked pool). */
export type ProposeCardAlt = {
  slug: string;
  title: string;
  protein: string | null;
  cuisine: string | null;
  time_total: number | null;
};

/** The chosen main for a slot (the compact fields the card renders). */
export type ProposeCardMain = {
  slug: string;
  title: string;
  description: string | null;
  protein: string | null;
  cuisine: string | null;
  time_total: number | null;
  score: number;
};

/** A curated corpus side attached to a main (`pairs_with`). */
export type ProposeCardSide = { slug: string; title: string };

/** One shaped-and-filled slot — `main: null` is an EXPLICIT empty slot (never dropped). Mirrors
 *  the propose op's `ProposedSlot` field-for-field so a re-invocation result hydrates identically. */
export type ProposeCardSlot = {
  vibe_id: string | null;
  /** Which meal this slot fills — the plan is FLAT and meal-ordered (breakfast →
   *  lunch → dinner, position-stable within each meal). */
  meal: "breakfast" | "lunch" | "dinner";
  reason: "pinned" | "new_for_me" | "overdue" | "sampled" | "locked";
  main: ProposeCardMain | null;
  empty_reason?: string;
  alternates: ProposeCardAlt[];
  alt_similar: ProposeCardAlt | null;
  alt_different: ProposeCardAlt | null;
  /** Present (true) when this slot's query vector came from a `slots[].vibe` override. */
  vibe_override?: true;
  /** Present (true) when the main was pinned via `slots[].recipe`. */
  recipe_pinned?: true;
  /** The non-`mild` weather-category quota that placed this slot, when any. */
  weather_category?: string;
  sides: ProposeCardSide[];
  /** The at-risk items this main actually claimed (holistic use-it-up). */
  uses_perishables: string[];
  flags: {
    waste?: string[];
    meal_prep?: boolean;
    novel?: boolean;
    no_corpus_side?: boolean;
  };
  why: string[];
};

/** The week's cross-slot diversity summary (the variety bar). */
export type ProposeCardVariety = {
  distinct_proteins: number;
  distinct_cuisines: number;
  mean_pairwise_sim: number;
  max_pairwise_sim: number;
};

/** One per-vibe-slot constraint in the replayed request (mirrors the op's `slots[]` entry). */
export type ProposeCardRequestSlot = {
  vibe_id: string;
  protein?: string;
  cuisine?: string;
  max_time_total?: number | null;
  vibe?: string;
  recipe?: string;
};

/** The request that produced `plan` — the widget seeds its client session from this and replays
 *  an adjusted copy against the stateless propose op on every dial change (no model turn). The
 *  palette-flow subset the member web app's `POST /api/propose` session serializes. */
export type ProposeCardRequest = {
  /** Deprecation-window alias of `meals.dinner` (the widget's dial replay still keys on it). */
  nights: number;
  /** The per-meal slot counts the request resolved to. */
  meals?: { breakfast?: number; lunch?: number; dinner?: number };
  /** The attendance input, echoed when supplied (exactly one of away/only). */
  attendance?: { away?: string[]; only?: string[] };
  seed: number;
  /** `nudges.variety` (0–1); the adventurousness slider. */
  variety: number;
  proteins: string[];
  freeform: string;
  exclude: string[];
  slots: ProposeCardRequestSlot[];
};

export type ProposeCardData = {
  /** The payload's contract version (D19), stamped by the Worker. `undefined` reads as 1. A
   *  widget on an older build renders READ-ONLY when this exceeds its `KNOWN_PROPOSE_CONTRACT_VERSION`. */
  contract_version?: number;
  /** The proposed slots (one card per night). */
  plan: ProposeCardSlot[];
  variety: ProposeCardVariety;
  /** At-risk items the plan could NOT cover (residual demand) — the honest "still going bad" list. */
  uncovered_at_risk: string[];
  diagnostics: {
    seed: number;
    lambda: number;
    /** The dinner alias of `meals.dinner.requested` (one deprecation window). */
    nights: number;
    filled: number;
    empty: number;
    rolled_over?: string[];
    /** Per-meal requested/filled/empty. */
    meals?: Record<string, { requested: number; filled: number; empty: number }>;
    /** The effective eating set + dropped unknown handles (D29-final), always present
     *  on the op's result. */
    attendance?: { effective: string[]; ignored: string[]; notes?: string[] };
  };
  /** Present only on the empty-palette short-circuit (an add-a-vibe nudge). */
  note?: string;
  /** Empty-meal escape nudges (e.g. a requested meal with no palette of its own). */
  notes?: string[];
  /** The request that produced `plan`; the widget's dials replay an adjusted copy. */
  request: ProposeCardRequest;
  /** vibe id → its phrase, so each slot renders its vibe name (the result carries only the id). */
  vibeLabels: Record<string, string>;
  /** The palette's vibe phrases, for the per-night "pick one of your vibes" panel. */
  palettePresets: string[];
  /** The corpus protein facet universe, for the per-night protein pin picker. */
  proteins: string[];
  /** The corpus cuisine facet universe, for the per-night cuisine pin picker. */
  cuisines: string[];
};
