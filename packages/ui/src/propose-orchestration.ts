import type { ProposeSlotView, SlotPanel } from "./components/propose";

/** Per-meal slot counts — the request's `meals` map (D20 per-meal steppers). */
export interface ProposeMeals {
  breakfast: number;
  lunch: number;
  dinner: number;
}

/** Week-level attendance (D29-final). ROUND-TRIP ONLY here: carried from an agent-authored
 *  request and replayed verbatim. The member surface offers NO attendance mutator — the web
 *  control is deferred behind a Claude Design pass (D29-final), so this is plumbing only. */
export interface ProposeAttendance {
  away: string[];
  only: string[];
}

/** The persisted client session schema version (member-app localStorage). Bumped when the shape
 *  changes so a stale localStorage blob is discarded rather than mis-read. */
export const PROPOSE_SESSION_VERSION = 4;

export interface ProposeSession {
  /** Schema version — a persisted session from an older shape is dropped on load. */
  v: number;
  seed: number;
  /** Dinner-count alias, kept === `meals.dinner` for the localStorage guard + the deprecation
   *  window; `meals` is authoritative for the request. */
  nights: number;
  /** Per-meal slot counts (the retained per-meal steppers). */
  meals: ProposeMeals;
  /** Attendance — round-trip only (no member mutator); see `ProposeAttendance`. */
  attendance: ProposeAttendance;
  /** D8-cut nudges: carried for round-trip fidelity of an agent-authored request; the shared
   *  surface exposes NO mutator (adventurousness / protein-wants / freeform were cut). */
  variety: number;
  proteinWants: string[];
  freeform: string;
  /** D8-cut per-slot pins: carried for round-trip; the shared surface exposes NO mutator
   *  (per-slot lock + exclude were cut). */
  locked: Record<string, string>;
  excluded: string[];
  /** Retained per-slot refinements — the D20 shared control set. */
  overrides: Record<string, string>;
  slotProtein: Record<string, string>;
  slotCuisine: Record<string, string>;
  slotMaxTime: Record<string, number | null>;
  slotVibe: Record<string, string>;
  /** Sides editing (D20): per-slot side-title overrides. Absent = use the proposed sides. A local
   *  refinement of the already-proposed week — surfaced to the host model via context, NOT a
   *  re-query (decision 1, the D4 inverse). */
  slotSides: Record<string, string[]>;
}

export interface ProposeRequestSlot {
  vibe_id: string;
  protein?: string;
  cuisine?: string;
  max_time_total?: number | null;
  vibe?: string;
  recipe?: string;
}

export interface ProposeRequest {
  /** The per-meal slot counts (supersedes the retired top-level `nights`, which the op still
   *  accepts as the dinner alias but IGNORES when `meals` is present). */
  meals: ProposeMeals;
  /** Attendance, echoed only when supplied (exactly one of away/only). */
  attendance?: { away?: string[]; only?: string[] };
  seed: number;
  exclude?: string[];
  nudges?: { variety?: number; freeform?: string; proteins?: string[] };
  slots?: ProposeRequestSlot[];
}

/** The palette-flow subset the widget's `request` echo / the member `POST /api/propose` session
 *  serializes — the shape `proposeSessionFromRequest` hydrates back into a session. */
export interface ProposeSessionRequest {
  seed: number;
  nights: number;
  meals?: { breakfast?: number; lunch?: number; dinner?: number };
  attendance?: { away?: string[]; only?: string[] };
  variety: number;
  proteins: string[];
  freeform: string;
  exclude: string[];
  slots: ProposeRequestSlot[];
}

type ProposeSlotLike = {
  vibe_id: string | null;
  reason?: string;
  main: ProposeSlotView["main"];
  empty_reason?: string;
  weather_category?: string | null;
  sides: Array<{ title: string }>;
  flags: {
    waste?: string[];
    meal_prep?: boolean;
    no_corpus_side?: boolean;
  };
  why: string[];
  alternates: ProposeSlotView["alternates"];
  alt_similar: ProposeSlotView["altSimilar"];
  alt_different: ProposeSlotView["altDifferent"];
};

export function dateSeed(from = new Date()): number {
  return Number(from.toISOString().slice(0, 10).replace(/-/g, ""));
}

export function defaultProposeSession(nights: number, seed = dateSeed()): ProposeSession {
  const dinner = Math.min(6, Math.max(2, nights));
  return {
    v: PROPOSE_SESSION_VERSION,
    seed,
    nights: dinner,
    meals: { breakfast: 0, lunch: 0, dinner },
    attendance: { away: [], only: [] },
    variety: 0.4,
    proteinWants: [],
    freeform: "",
    locked: {},
    excluded: [],
    overrides: {},
    slotProtein: {},
    slotCuisine: {},
    slotMaxTime: {},
    slotVibe: {},
    slotSides: {},
  };
}

export function proposeSessionFromRequest(req: ProposeSessionRequest): ProposeSession {
  const dinner = req.meals?.dinner ?? req.nights;
  const session: ProposeSession = {
    v: PROPOSE_SESSION_VERSION,
    seed: req.seed,
    nights: dinner,
    meals: {
      breakfast: req.meals?.breakfast ?? 0,
      lunch: req.meals?.lunch ?? 0,
      dinner,
    },
    attendance: { away: req.attendance?.away ?? [], only: req.attendance?.only ?? [] },
    variety: req.variety,
    proteinWants: req.proteins,
    freeform: req.freeform,
    locked: {},
    excluded: req.exclude,
    overrides: {},
    slotProtein: {},
    slotCuisine: {},
    slotMaxTime: {},
    slotVibe: {},
    slotSides: {},
  };
  for (const slot of req.slots) {
    if (slot.protein) session.slotProtein[slot.vibe_id] = slot.protein;
    if (slot.cuisine) session.slotCuisine[slot.vibe_id] = slot.cuisine;
    if (slot.max_time_total !== undefined) session.slotMaxTime[slot.vibe_id] = slot.max_time_total;
    if (slot.vibe) session.slotVibe[slot.vibe_id] = slot.vibe;
    if (slot.recipe) session.overrides[slot.vibe_id] = slot.recipe;
  }
  return session;
}

export function buildProposeRequest(session: ProposeSession): ProposeRequest {
  const ids = new Set<string>([
    ...Object.keys(session.locked),
    ...Object.keys(session.overrides),
    ...Object.keys(session.slotProtein),
    ...Object.keys(session.slotCuisine),
    ...Object.keys(session.slotMaxTime),
    ...Object.keys(session.slotVibe),
  ]);
  const slots: ProposeRequestSlot[] = [...ids].sort().map((id) => {
    const slot: ProposeRequestSlot = { vibe_id: id };
    if (session.slotProtein[id]) slot.protein = session.slotProtein[id];
    if (session.slotCuisine[id]) slot.cuisine = session.slotCuisine[id];
    if (id in session.slotMaxTime) slot.max_time_total = session.slotMaxTime[id];
    if (session.slotVibe[id]) slot.vibe = session.slotVibe[id];
    const pick = session.locked[id] ?? session.overrides[id];
    if (pick) slot.recipe = pick;
    return slot;
  });
  const nudges: ProposeRequest["nudges"] = { variety: session.variety };
  if (session.freeform.trim()) nudges.freeform = session.freeform.trim();
  if (session.proteinWants.length) nudges.proteins = [...session.proteinWants].sort();
  const request: ProposeRequest = {
    meals: {
      breakfast: session.meals.breakfast,
      lunch: session.meals.lunch,
      dinner: session.meals.dinner,
    },
    seed: session.seed,
    nudges,
  };
  const attendance: { away?: string[]; only?: string[] } = {};
  if (session.attendance.away.length) attendance.away = [...session.attendance.away].sort();
  if (session.attendance.only.length) attendance.only = [...session.attendance.only].sort();
  if (attendance.away || attendance.only) request.attendance = attendance;
  if (session.excluded.length) request.exclude = [...session.excluded].sort();
  if (slots.length) request.slots = slots;
  return request;
}

export function proposePanelOf(open: string | null, key: string): SlotPanel {
  if (!open || !open.startsWith(`${key}|`)) return null;
  return open.slice(key.length + 1) as SlotPanel;
}

export function proposeSlotToView(
  slot: ProposeSlotLike,
  index: number,
  session: ProposeSession,
  options: {
    vibeLabels?: Record<string, string>;
    getVibeLabel?: (vibeId: string) => string | undefined;
    nullVibeLabel?: (slot: ProposeSlotLike) => string;
  } = {},
): ProposeSlotView {
  const vibeId = slot.vibe_id as string;
  const override = session.slotVibe[vibeId];
  const flags: ProposeSlotView["flags"] = [];
  if (slot.flags.waste?.length) flags.push({ type: "waste", label: `Single-use: ${slot.flags.waste.join(", ")}` });
  if (slot.flags.meal_prep) flags.push({ type: "meal-prep", label: "Meal-preps well" });
  if (slot.flags.no_corpus_side) flags.push({ type: "side", label: "No corpus side — add your own" });

  let vibeLabel: string;
  if (override) {
    vibeLabel = override;
  } else if (slot.vibe_id) {
    vibeLabel = options.vibeLabels?.[slot.vibe_id] ?? options.getVibeLabel?.(slot.vibe_id) ?? slot.vibe_id;
  } else {
    vibeLabel = options.nullVibeLabel?.(slot) ?? "your pick";
  }

  // Sides editing (D20): an explicit per-slot override wins over the proposed sides.
  const sides = session.slotSides[vibeId] ?? slot.sides.map((side) => side.title);

  return {
    key: `${vibeId}:${index}`,
    vibeId,
    vibeLabel,
    vibeEdited: !!override,
    weatherCategory: slot.weather_category ?? null,
    main: slot.main,
    emptyReason: slot.empty_reason ?? null,
    locked: !!slot.main && session.locked[vibeId] === slot.main.slug,
    pinnedProtein: session.slotProtein[vibeId] ?? null,
    pinnedCuisine: session.slotCuisine[vibeId] ?? null,
    timePin: { explicit: vibeId in session.slotMaxTime, value: session.slotMaxTime[vibeId] ?? null },
    why: slot.why,
    sides,
    flags,
    alternates: slot.alternates,
    altSimilar: slot.alt_similar,
    altDifferent: slot.alt_different,
  };
}
