// The client-side propose session (member-app-propose / shared-propose-orchestration): the
// palette-flow option shape, persisted in localStorage and replayed as the FULL request body
// against the stateless `POST /api/propose` on every change — no server-side session state ever
// (the spec'd negative guarantee; the endpoint's determinism IS session resume). The shared
// `useProposeController` owns the reducers + the live re-query loop; this module supplies the
// member transport (`fetchPropose`) and the localStorage persistence. The propose query is a
// read-shaped POST — never queued offline, never retried as a mutation (the D8 exemption): a stale
// propose is just re-requested. Commit reuses P1's class (b) plan-ops mutation with `from_vibe`
// provenance and client-assigned open dates (`nextOpenDates`, shared).
import {
  buildProposeRequest as buildRequest,
  dateSeed,
  defaultProposeSession as defaultSession,
  nextOpenDates,
  PROPOSE_SESSION_VERSION,
  type ProposeControllerResult,
  type ProposeRequest,
  type ProposeRequestSlot as RequestSlot,
  type ProposeSession,
} from "@yamp/ui";
import { api, apiError } from "./api";

const SESSION_KEY = "yamp:propose-session";

export {
  buildRequest,
  dateSeed,
  defaultSession,
  nextOpenDates,
  type ProposeRequest,
  type ProposeSession,
  type RequestSlot,
};

export function loadSession(): ProposeSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as ProposeSession;
    // Discard a persisted session from an older schema (v4 added meals / attendance / sides).
    return s?.v === PROPOSE_SESSION_VERSION && typeof s?.seed === "number" ? s : null;
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
 * The stateless propose fetch (the member transport): the controller's iterate for this host.
 * Deterministic server-side — an identical request body is an identical week, so a reload replays
 * it for free (no server-side session read).
 */
export async function fetchPropose(request: ProposeRequest): Promise<ProposeControllerResult> {
  const res = await api.api.propose.$post({ json: request });
  if (!res.ok) throw await apiError(res);
  return (await res.json()) as unknown as ProposeControllerResult;
}
