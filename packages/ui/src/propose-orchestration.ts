import type { ProposeSlotView, SlotPanel } from "./components/propose";

export interface ProposeSession {
  seed: number;
  nights: number;
  variety: number;
  proteinWants: string[];
  freeform: string;
  locked: Record<string, string>;
  overrides: Record<string, string>;
  excluded: string[];
  slotProtein: Record<string, string>;
  slotCuisine: Record<string, string>;
  slotMaxTime: Record<string, number | null>;
  slotVibe: Record<string, string>;
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
  nights: number;
  seed: number;
  exclude?: string[];
  nudges?: { variety?: number; freeform?: string; proteins?: string[] };
  slots?: ProposeRequestSlot[];
}

export interface ProposeSessionRequest {
  seed: number;
  nights: number;
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
  return {
    seed,
    nights: Math.min(6, Math.max(2, nights)),
    variety: 0.4,
    proteinWants: [],
    freeform: "",
    locked: {},
    overrides: {},
    excluded: [],
    slotProtein: {},
    slotCuisine: {},
    slotMaxTime: {},
    slotVibe: {},
  };
}

export function proposeSessionFromRequest(req: ProposeSessionRequest): ProposeSession {
  const session: ProposeSession = {
    seed: req.seed,
    nights: req.nights,
    variety: req.variety,
    proteinWants: req.proteins,
    freeform: req.freeform,
    locked: {},
    overrides: {},
    excluded: req.exclude,
    slotProtein: {},
    slotCuisine: {},
    slotMaxTime: {},
    slotVibe: {},
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
  const request: ProposeRequest = { nights: session.nights, seed: session.seed, nudges };
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
    sides: slot.sides.map((side) => side.title),
    flags,
    alternates: slot.alternates,
    altSimilar: slot.alt_similar,
    altDifferent: slot.alt_different,
  };
}
