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
import {
  buildProposeRequest as buildRequest,
  dateSeed,
  defaultProposeSession as defaultSession,
  type ProposeRequest,
  type ProposeRequestSlot as RequestSlot,
  type ProposeSession,
} from "@yamp/ui";
import { api, apiError } from "./api";
import type { PlannedRow } from "./data";

const SESSION_KEY = "yamp:propose-session";

export { buildRequest, dateSeed, defaultSession, type ProposeRequest, type ProposeSession, type RequestSlot };

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
