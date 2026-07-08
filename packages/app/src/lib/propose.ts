// The client-side propose session (member-app-propose D7): the mock's option shape,
// persisted in localStorage and replayed as the FULL request body against the stateless
// `POST /api/propose` on every change — no server-side session state ever (the spec'd
// negative guarantee; the endpoint's determinism IS session resume). The TanStack query
// is keyed by the canonically-serialized request with `keepPreviousData`, so the current
// week stays rendered (dimmed) while a re-roll computes. The propose query is a
// read-shaped POST — never retried as a mutation, never queued offline (the D8
// exemption): a stale propose is just re-requested. Commit reuses P1's class (b)
// plan-ops mutation (`applyPlanOps`) with `from_vibe` provenance and client-assigned
// open dates (D8).
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { api, apiError } from "./api";
import type { PlannedRow } from "./data";

const SESSION_KEY = "cookbook:propose-session";

/** The mock's `proposeSession` shape, kept faithfully (D7). All keys are vibe ids. */
export interface ProposeSession {
  seed: number;
  nights: number;
  /** `nudges.variety` (0–1); the adventurousness slider's value. */
  variety: number;
  proteinWants: string[];
  freeform: string;
  /** Lock: keep THIS pick on THIS night (identity-preserving `slots[].recipe`). */
  locked: Record<string, string>;
  /** Swap/pick-list overrides — also `slots[].recipe`; `locked` wins when both exist. */
  overrides: Record<string, string>;
  excluded: string[];
  slotProtein: Record<string, string>;
  slotCuisine: Record<string, string>;
  /** Explicit per-night time cap; `null` = the member's "Any time" (lifts the vibe's cap). */
  slotMaxTime: Record<string, number | null>;
  /** Per-night typed phrase / palette preset (`slots[].vibe`). */
  slotVibe: Record<string, string>;
}

/** The default seed: today's date, matching the tool's own no-seed default. */
export function dateSeed(): number {
  return Number(new Date().toISOString().slice(0, 10).replace(/-/g, ""));
}

export function defaultSession(nights: number): ProposeSession {
  return {
    seed: dateSeed(),
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

export function loadSession(): ProposeSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as ProposeSession;
    return typeof s?.seed === "number" && typeof s?.nights === "number" ? s : null;
  } catch {
    return null;
  }
}

export function saveSession(session: ProposeSession | null): void {
  try {
    if (session === null) localStorage.removeItem(SESSION_KEY);
    else localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // private-mode storage failures are fine — the session just won't survive a reload
  }
}

/** One request-body slot constraint (mirrors the endpoint's `slots[]` shape). */
export interface RequestSlot {
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
  slots?: RequestSlot[];
}

/**
 * Serialize the session into the canonical request body (D7's request mapping): UI
 * lock / swap / pick-list → identity-preserving `slots[].recipe` (never the tool's
 * vibe-detaching `lock` array), facet chips → `slots[].{protein,cuisine,max_time_total}`,
 * the vibe panel → `slots[].vibe`, "not this one" → `exclude`, the slider →
 * `nudges.variety`, the phrase box → `nudges.freeform`. Slot ids are sorted so the
 * serialized request (the query key) is canonical for one set of choices.
 */
export function buildRequest(s: ProposeSession): ProposeRequest {
  const ids = new Set<string>([
    ...Object.keys(s.locked),
    ...Object.keys(s.overrides),
    ...Object.keys(s.slotProtein),
    ...Object.keys(s.slotCuisine),
    ...Object.keys(s.slotMaxTime),
    ...Object.keys(s.slotVibe),
  ]);
  const slots: RequestSlot[] = [...ids].sort().map((id) => {
    const slot: RequestSlot = { vibe_id: id };
    if (s.slotProtein[id]) slot.protein = s.slotProtein[id];
    if (s.slotCuisine[id]) slot.cuisine = s.slotCuisine[id];
    if (id in s.slotMaxTime) slot.max_time_total = s.slotMaxTime[id];
    if (s.slotVibe[id]) slot.vibe = s.slotVibe[id];
    const pick = s.locked[id] ?? s.overrides[id];
    if (pick) slot.recipe = pick;
    return slot;
  });
  const nudges: ProposeRequest["nudges"] = { variety: s.variety };
  if (s.freeform.trim()) nudges.freeform = s.freeform.trim();
  if (s.proteinWants.length) nudges.proteins = [...s.proteinWants].sort();
  const req: ProposeRequest = { nights: s.nights, seed: s.seed, nudges };
  if (s.excluded.length) req.exclude = [...s.excluded].sort();
  if (slots.length) req.slots = slots;
  return req;
}

/** The endpoint's response, inferred end-to-end from the Worker's composed app type. */
export type ProposeResponse = Awaited<
  ReturnType<Awaited<ReturnType<(typeof api.api.propose)["$post"]>>["json"]>
>;
export type ProposeSlotPayload = ProposeResponse["plan"][number];

/**
 * The live re-query (D7): keyed by the canonical serialized request, keeping the
 * previous week rendered while the next one computes. Deterministic server-side, so
 * a long staleTime is safe — identical requests are identical weeks.
 */
export function usePropose(request: ProposeRequest | null) {
  return useQuery({
    queryKey: ["propose", request ? JSON.stringify(request) : "none"],
    enabled: request !== null,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<ProposeResponse> => {
      const res = await api.api.propose.$post({ json: request! });
      if (!res.ok) throw await apiError(res);
      return res.json();
    },
  });
}

/**
 * Client-assigned open dates for a commit (D8): the next dates within the planning
 * window not already taken by a scheduled plan row — pure date math over the cached
 * plan, no new endpoint. Returns YYYY-MM-DD strings starting tomorrow.
 */
export function nextOpenDates(existing: PlannedRow[], count: number, from = new Date()): string[] {
  const taken = new Set(existing.map((r) => r.planned_for).filter(Boolean) as string[]);
  const out: string[] = [];
  const d = new Date(from);
  while (out.length < count) {
    d.setDate(d.getDate() + 1);
    const day = d.toISOString().slice(0, 10);
    if (!taken.has(day)) {
      taken.add(day);
      out.push(day);
    }
  }
  return out;
}
