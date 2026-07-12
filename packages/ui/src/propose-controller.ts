// The shared propose controller (shared-propose-orchestration, D18/D20): the ONE state machine
// behind both propose hosts — the member "Plan your week" page and the in-chat meal-plan widget.
// The member route and the widget are thin ADAPTERS over this; neither carries a duplicated
// reducer set. The controller owns the client session, the per-slot refinement reducers (the D20
// retained control set: per-meal counts, swap, facet pins, per-slot vibe, sides editing), the
// iterate/sync/commit channel discipline, and slot→view derivation. Transport is the adapter's:
// the member fetches `POST /api/propose` and commits through the plan-ops path; the widget proxies
// the stateless op over the ext-apps bridge and commits via the D18 write sequence.
//
// D18 channel discipline (enforced HERE, realised in `createBridgeAdapter`):
//   • a request-changing edit → adapter.iterate(): a backend write (callServerTool / POST) AND a
//     FULL proposed-week snapshot to the host model (ui/update-model-context) — never a delta.
//   • a sides-only edit → adapter.syncContext(): update-model-context ONLY, no re-query (decision
//     1, the D4 inverse — a sides tweak is a local refinement of the already-proposed week).
//   • commit → adapter.commit(): the write + a ui/message at the commit boundary.
import * as React from "react";
import type { ProposeAlt, ProposeSlotView } from "./components/propose";
import {
  buildProposeRequest,
  defaultProposeSession,
  proposeSlotToView,
  type ProposeMeals,
  type ProposeRequest,
  type ProposeSession,
} from "./propose-orchestration";

// ── the structural result shape (keeps @yamp/ui free of @yamp/contract) ──────────────

/** One proposed slot — structurally `propose_meal_plan`'s `ProposedSlot` / `ProposeCardSlot`.
 *  Kept structural so both hosts' concrete payloads assign to it without a contract dependency. */
export interface ProposeControllerSlot {
  vibe_id: string | null;
  meal: "breakfast" | "lunch" | "dinner";
  reason?: string;
  main: {
    slug: string;
    title: string;
    description: string | null;
    protein: string | null;
    cuisine: string | null;
    time_total: number | null;
  } | null;
  empty_reason?: string;
  weather_category?: string | null;
  sides: { slug?: string; title: string }[];
  flags: { waste?: string[]; meal_prep?: boolean; no_corpus_side?: boolean };
  why: string[];
  alternates: ProposeAlt[];
  alt_similar: ProposeAlt | null;
  alt_different: ProposeAlt | null;
}

/** The result portion both hosts iterate over — the `propose_meal_plan` result / the
 *  `ProposeCardData` result fields. */
export interface ProposeControllerResult {
  plan: ProposeControllerSlot[];
  variety: { distinct_proteins: number; distinct_cuisines: number; mean_pairwise_sim: number; max_pairwise_sim: number };
  uncovered_at_risk: string[];
  diagnostics: { filled: number } & Record<string, unknown>;
  note?: string;
  notes?: string[];
}

// ── the commit contract ──────────────────────────────────────────────────────────────

/** One chosen night handed to the adapter's commit — the shared "week" the host persists. */
export interface ProposeCommitSlot {
  slug: string;
  meal: "breakfast" | "lunch" | "dinner";
  from_vibe: string | null;
  /** The effective sides (edited overrides applied). */
  sides: string[];
}

export interface ProposeCommitOutcome {
  committed: boolean;
  /** When true, the controller clears its session after commit (the member's new-flow); the widget
   *  leaves the committed week on screen and returns false. */
  reset?: boolean;
}

/** An `update_meal_plan` `add` op — SLOT-grain, keyed by a client-minted row id (D26-final). */
export interface PlanCommitOp {
  op: "add";
  id: string;
  recipe: string;
  meal: "breakfast" | "lunch" | "dinner";
  from_vibe: string | null;
  sides: string[];
  planned_for: string;
}

// ── the host adapter ───────────────────────────────────────────────────────────────────

export interface ProposeHostAdapter {
  capabilities: { canIterate: boolean; canCommit: boolean };
  /** Run one iteration for `request` — a PURE query (the write only). Returns the fresh result, or
   *  null on a transport hiccup (the prior week stays rendered). The controller owns the model-context
   *  push (it alone knows the iteration seq + the edited sides), calling `syncContext` after the
   *  seq-guarded result lands — so the D18 "request-change fires callServerTool AND
   *  update-model-context" pairing holds, orchestrated controller-side. */
  iterate(request: ProposeRequest): Promise<ProposeControllerResult | null>;
  /** The single model-context push channel (decision 1 / D18): surface a full-state snapshot to the
   *  host model. Used for BOTH the post-iterate snapshot and a sides-only refinement (no re-query).
   *  Widget → ui/update-model-context only; member → no-op. */
  syncContext?(snapshot: ProposeControllerResult): void | Promise<void>;
  /** Commit the chosen week. Member → plan-ops + navigate; widget → the D18 write sequence. */
  commit(week: ProposeCommitSlot[]): Promise<ProposeCommitOutcome>;
}

// ── client-side commit date-packing (shared by both hosts, decision 6) ───────────────────

/** A `YYYY-MM-DD` string in the LOCAL calendar — matching the member app's `format.ts` `localDay`
 *  exactly (local getFullYear/getMonth/getDate, NEVER `toISOString`, which renders UTC). The plan
 *  horizon (`_app.plan.tsx`) and existing `planned_for` rows are local-day strings, so open-date
 *  packing must walk the local calendar or it off-by-ones for users west of UTC in the evening. */
export function localDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Client-assigned open dates for a commit: the next dates within the planning window not already
 * taken by a scheduled plan row — pure LOCAL-calendar date math over the existing plan, no new
 * endpoint. Returns `YYYY-MM-DD` strings starting the local tomorrow.
 */
export function nextOpenDates(
  existing: { planned_for?: string | null }[],
  count: number,
  from = new Date(),
): string[] {
  const taken = new Set(existing.map((r) => r.planned_for).filter((d): d is string => !!d));
  const out: string[] = [];
  const d = new Date(from);
  while (out.length < count) {
    d.setDate(d.getDate() + 1);
    const day = localDay(d);
    if (!taken.has(day)) {
      taken.add(day);
      out.push(day);
    }
  }
  return out;
}

/** A client-minted opaque plan-row id (D26-final): the offline-replay key and the row address. */
export function mintRowId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return c?.randomUUID ? c.randomUUID() : `row-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Pack a chosen week into per-slot `update_meal_plan` `add` ops with client-assigned open dates
 *  (decision 6). Coalesce semantics on the op layer (D26-final) update an already-planned recipe's
 *  row rather than duplicating; commit never passes `duplicate`. */
export function packPlanCommitOps(
  week: ProposeCommitSlot[],
  existing: { planned_for?: string | null }[],
  opts: { mintRowId?: () => string; today?: Date } = {},
): PlanCommitOp[] {
  const mint = opts.mintRowId ?? mintRowId;
  const dates = nextOpenDates(existing, week.length, opts.today);
  return week.map((slot, i) => ({
    op: "add",
    id: mint(),
    recipe: slot.slug,
    meal: slot.meal,
    from_vibe: slot.from_vibe,
    sides: slot.sides,
    planned_for: dates[i],
  }));
}

// ── the ext-apps bridge adapter (the D18 realisation) ────────────────────────────────────

/** The tool-call result the host proxies back — taken structurally from the ext-apps client so
 *  @yamp/ui needs no direct SDK dependency. */
export interface BridgeToolResult {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  content?: Array<{ type: string; text?: string }>;
}

/** The minimal ext-apps `App` surface the bridge adapter uses (structurally satisfied by `App`). */
export interface ProposeBridge {
  callServerTool(params: { name: string; arguments: Record<string, unknown> }): Promise<BridgeToolResult>;
  updateModelContext(params: { content?: unknown[]; structuredContent?: Record<string, unknown> }): Promise<unknown>;
  sendMessage(params: { role: "user"; content: { type: "text"; text: string }[] }): Promise<unknown>;
}

/** Parse a `propose_meal_plan` re-invocation result. The op returns its payload as one JSON text
 *  content item; some hosts also surface `structuredContent`. */
export function parseProposeResult(res: BridgeToolResult): ProposeControllerResult | null {
  if (res.isError) return null;
  if (res.structuredContent && "plan" in res.structuredContent) {
    return res.structuredContent as unknown as ProposeControllerResult;
  }
  const text = res.content?.find((c) => c.type === "text")?.text;
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as ProposeControllerResult;
    return Array.isArray(parsed.plan) ? parsed : null;
  } catch {
    return null;
  }
}

/** Parse a `read_meal_plan` result into its planned rows (for date-packing). */
function parsePlan(res: BridgeToolResult): { planned_for?: string | null }[] {
  const fromStructured = res.structuredContent?.planned;
  if (Array.isArray(fromStructured)) return fromStructured as { planned_for?: string | null }[];
  const text = res.content?.find((c) => c.type === "text")?.text;
  if (!text) return [];
  try {
    const parsed = JSON.parse(text) as { planned?: { planned_for?: string | null }[] };
    return Array.isArray(parsed.planned) ? parsed.planned : [];
  } catch {
    return [];
  }
}

const DEFAULT_COMMIT_MESSAGE = "I committed this proposed week to my meal plan.";

/**
 * Build a `ProposeHostAdapter` over an ext-apps bridge. The model-context channel is owned by the
 * CONTROLLER (which alone knows the iteration seq and the edited sides), so `iterate` here is a PURE
 * query — no `ui/update-model-context` inside it. The three D18 channels:
 *  • iterate  → callServerTool(propose_meal_plan) + parse ONLY (the controller pushes the seq-guarded,
 *    sides-applied snapshot via syncContext right after it lands the result).
 *  • syncContext → update-model-context only, never callServerTool, never message.
 *  • commit   → the decision-6 sequence: read_meal_plan → pack dates → update_meal_plan →
 *    read_meal_plan → update-model-context(committed) → message. Degrades per the capability ladder
 *    (`commitMode`): `write` runs the sequence; `delegate` falls back to a sendMessage; `none`
 *    reports not-committed. Once the durable `update_meal_plan` lands, every later step is
 *    best-effort — a failing re-read still commits (falling back to the packed ops as the committed
 *    snapshot), so commit NEVER rejects with rows already written.
 */
export function createBridgeAdapter(
  bridge: ProposeBridge,
  opts: {
    capabilities: ProposeCapabilities;
    mintRowId?: () => string;
    today?: () => Date;
    commitMessage?: (week: ProposeCommitSlot[]) => string;
  },
): ProposeHostAdapter {
  const caps = opts.capabilities;
  const message = (week: ProposeCommitSlot[]) => opts.commitMessage?.(week) ?? DEFAULT_COMMIT_MESSAGE;
  return {
    capabilities: { canIterate: caps.canIterate, canCommit: caps.canCommit },
    async iterate(request) {
      // PURE query — the controller owns the update-model-context push (seq-guarded + sides-applied).
      const res = await bridge.callServerTool({
        name: "propose_meal_plan",
        arguments: request as unknown as Record<string, unknown>,
      });
      return parseProposeResult(res);
    },
    async syncContext(snapshot) {
      if (!caps.canSyncContext) return;
      await bridge.updateModelContext({ structuredContent: snapshot as unknown as Record<string, unknown> }).catch(() => {});
    },
    async commit(week) {
      if (caps.commitMode === "delegate") {
        await bridge.sendMessage({ role: "user", content: [{ type: "text", text: message(week) }] }).catch(() => {});
        return { committed: true, reset: false };
      }
      if (caps.commitMode !== "write") return { committed: false };
      // The worker's tools are THROW-FREE (errors.ts `fail()`/`runTool` RESOLVE `{ isError: true }`
      // on failure, they do not reject), so `isError` is a failure just as much as a rejection.
      // Pre-write read: abort cleanly (nothing written) on either — date-packing against an empty
      // baseline from a failed read could collide with real existing rows.
      let beforeRes: BridgeToolResult;
      try {
        beforeRes = await bridge.callServerTool({ name: "read_meal_plan", arguments: {} });
      } catch {
        return { committed: false };
      }
      if (beforeRes.isError) return { committed: false };
      const before = parsePlan(beforeRes);
      const ops = packPlanCommitOps(week, before, { mintRowId: opts.mintRowId, today: opts.today?.() });
      // The write. A rejection OR a resolved `isError` both mean it did NOT land — return without
      // pushing committed context or sending the provenance message (never a false success).
      let writeRes: BridgeToolResult;
      try {
        writeRes = await bridge.callServerTool({ name: "update_meal_plan", arguments: { ops } });
      } catch {
        return { committed: false };
      }
      if (writeRes.isError) return { committed: false };
      // The write is DURABLE now. Everything below is best-effort — never let it reject commit().
      if (caps.canSyncContext) {
        let committed: Record<string, unknown>;
        try {
          const after = await bridge.callServerTool({ name: "read_meal_plan", arguments: {} });
          // A rejected OR throw-free-`isError` re-read is a miss — fall back to the packed ops as the
          // committed snapshot (never push an empty week to the model after a durable write).
          committed = after.isError ? { planned: ops } : (after.structuredContent ?? { planned: parsePlan(after) });
        } catch {
          committed = { planned: ops };
        }
        await bridge.updateModelContext({ structuredContent: committed }).catch(() => {});
      }
      await bridge.sendMessage({ role: "user", content: [{ type: "text", text: message(week) }] }).catch(() => {});
      return { committed: true, reset: false };
    },
  };
}

// ── the capability ladder + contract-version gate (D18/D19) ──────────────────────────────

export interface ProposeCapabilityInputs {
  /** The payload's `contract_version` (`undefined` reads as 1). */
  contractVersion?: number;
  /** This build's `KNOWN_PROPOSE_CONTRACT_VERSION`. */
  knownVersion: number;
  /** Host advertises `serverTools` (can proxy tool calls). */
  hostServerTools: boolean;
  /** Host accepts `ui/update-model-context`. */
  hostUpdateModelContext: boolean;
  /** Host accepts `ui/message`. */
  hostMessage: boolean;
  /** The member has a palette to reshape. */
  hasPalette: boolean;
  /** The proposal is palette-round-trippable (every slot keyed by a real palette vibe id — no
   *  null-vibe / ephemeral slot the palette-flow request can't reproduce). */
  roundTrippable: boolean;
}

export interface ProposeCapabilities {
  /** No interactive refinement controls (unknown-newer payload OR the host can't proxy tools). */
  readOnly: boolean;
  canIterate: boolean;
  canSyncContext: boolean;
  /** `write` = the D18 sequence; `delegate` = sendMessage fallback; `none` = commit disabled. */
  commitMode: "write" | "delegate" | "none";
  canCommit: boolean;
}

/** Resolve the widget's capability posture (D18 ladder + D19 contract-version gate). A payload
 *  whose `contract_version` exceeds this build's known version renders fully READ-ONLY. */
export function resolveProposeCapabilities(i: ProposeCapabilityInputs): ProposeCapabilities {
  const known = (i.contractVersion ?? 1) <= i.knownVersion;
  if (!known) {
    return { readOnly: true, canIterate: false, canSyncContext: false, commitMode: "none", canCommit: false };
  }
  const canIterate = i.hostServerTools && i.hasPalette && i.roundTrippable;
  const commitMode: ProposeCapabilities["commitMode"] = i.hostServerTools ? "write" : i.hostMessage ? "delegate" : "none";
  return {
    readOnly: !canIterate,
    canIterate,
    canSyncContext: i.hostUpdateModelContext,
    commitMode,
    canCommit: commitMode !== "none",
  };
}

/** Whether a proposed plan is palette-round-trippable (every slot keyed by a real palette vibe). */
export function isRoundTrippable(plan: { vibe_id: string | null }[]): boolean {
  return plan.every((s) => s.vibe_id !== null && !s.vibe_id.startsWith("ephemeral-"));
}

// ── the controller hook ──────────────────────────────────────────────────────────────────

export interface ProposeControllerContext {
  vibeLabels?: Record<string, string>;
  getVibeLabel?: (vibeId: string) => string | undefined;
  /** Label a null-vibe slot (widget new_for_me / your-pick). Param kept minimal-structural so it
   *  stays contravariance-compatible with `proposeSlotToView`'s slot argument. */
  nullVibeLabel?: (slot: { reason?: string; vibe_id: string | null }) => string;
}

export interface UseProposeControllerOptions {
  adapter: ProposeHostAdapter;
  context: ProposeControllerContext;
  /** The initial session (member: loadSession() or null; widget: the request echo hydrated). */
  initialSession: ProposeSession | null;
  /** The initial render result (widget: the spawning payload; member: null until first iterate). */
  initialResult?: ProposeControllerResult | null;
  /** Auto-iterate the initial session on mount (member resume). Widget: false (already rendered). */
  iterateOnMount?: boolean;
  /** Persist a session change (member: saveSession; widget: no-op). */
  onSessionChange?: (session: ProposeSession | null) => void;
  /** The default dinner count for a fresh session (member `start`). */
  defaultNights?: number;
}

export interface ProposeSlotEntry {
  payload: ProposeControllerSlot;
  view: ProposeSlotView;
}

export interface ProposeSummary {
  filled: number;
  cuisines: number;
  proteins: number;
  proteinHist: [string, number][];
}

export interface ProposeController {
  session: ProposeSession | null;
  result: ProposeControllerResult | null;
  busy: boolean;
  canIterate: boolean;
  canCommit: boolean;
  slots: ProposeSlotEntry[];
  summary: ProposeSummary;
  /** Begin from the intro (member): create a default session and iterate. */
  start(): void;
  /** Clear the session (member "Start over"). */
  reset(): void;
  setMeal(meal: keyof ProposeMeals, n: number): void;
  swapTo(vibeId: string, slug: string): void;
  pickFacet(vibeId: string, kind: "protein" | "cuisine", value: string | null): void;
  pickTime(vibeId: string, value: number | null | undefined): void;
  applyVibe(vibeId: string, text: string): void;
  resetVibe(vibeId: string): void;
  editSides(vibeId: string, sides: string[]): void;
  commit(): Promise<ProposeCommitOutcome>;
}

/** Apply the session's per-slot side overrides onto a result — the full-state snapshot the sides
 *  sync pushes to model context (the edited sides, not the op's proposed ones). */
function applySides(result: ProposeControllerResult, session: ProposeSession): ProposeControllerResult {
  return {
    ...result,
    plan: result.plan.map((s) => {
      const override = s.vibe_id ? session.slotSides[s.vibe_id] : undefined;
      return override ? { ...s, sides: override.map((title) => ({ title })) } : s;
    }),
  };
}

export function useProposeController(opts: UseProposeControllerOptions): ProposeController {
  const { adapter, context } = opts;
  const [session, setSessionState] = React.useState<ProposeSession | null>(opts.initialSession);
  const [result, setResult] = React.useState<ProposeControllerResult | null>(opts.initialResult ?? null);
  const [busy, setBusy] = React.useState(false);
  const seqRef = React.useRef(0);
  // Latest session/result in refs so the async iterate/commit closures never read a stale value.
  const sessionRef = React.useRef(session);
  sessionRef.current = session;
  const resultRef = React.useRef(result);
  resultRef.current = result;

  const persist = (next: ProposeSession | null) => {
    setSessionState(next);
    sessionRef.current = next;
    opts.onSessionChange?.(next);
  };

  const runIterate = React.useCallback(
    async (s: ProposeSession) => {
      if (!adapter.capabilities.canIterate) return;
      const seq = ++seqRef.current;
      setBusy(true);
      try {
        const r = await adapter.iterate(buildProposeRequest(s));
        // Only the LATEST in-flight iteration lands its result AND pushes model context — a slower
        // earlier reply can neither clobber the newer week nor leave the host model on a stale one
        // (D18 full-state-snapshot invariant). The pushed snapshot carries the edited sides so
        // context matches render + commit (the D4-style divergence D18 exists to prevent).
        if (r && seq === seqRef.current) {
          setResult(r);
          resultRef.current = r;
          // Apply sides from the LIVE session ref, not the launch-time `s`: a sides edit made while
          // this iterate was in flight updated `sessionRef.current` without bumping seqRef (only a
          // superseding request-change does, and that fails the guard above). So the guard already
          // guarantees the same request — the only drift is newer sides, which the pushed snapshot
          // must carry to match render and commit (the D18/D4 invariant).
          if (adapter.syncContext) await adapter.syncContext(applySides(r, sessionRef.current ?? s));
        }
      } catch {
        // transport hiccup — keep the current week rendered
      } finally {
        if (seq === seqRef.current) setBusy(false);
      }
    },
    [adapter],
  );

  const runSync = React.useCallback(
    async (s: ProposeSession) => {
      const r = resultRef.current;
      if (!adapter.syncContext || !r) return;
      try {
        await adapter.syncContext(applySides(r, s));
      } catch {
        // model-context push failures are non-fatal — the sides still render locally
      }
    },
    [adapter],
  );

  // Member resume: replay the persisted session on mount so a reload re-renders its week.
  React.useEffect(() => {
    if (opts.iterateOnMount && session && adapter.capabilities.canIterate) void runIterate(session);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const requestChange = (next: ProposeSession) => {
    persist(next);
    void runIterate(next);
  };
  const sidesChange = (next: ProposeSession) => {
    persist(next);
    void runSync(next);
  };
  const base = () => sessionRef.current ?? defaultProposeSession(opts.defaultNights ?? 3);

  const controller: ProposeController = {
    session,
    result,
    busy,
    canIterate: adapter.capabilities.canIterate,
    canCommit: adapter.capabilities.canCommit,
    slots:
      session && result
        ? result.plan.map((slot, i) => ({
            payload: slot,
            view: proposeSlotToView(slot, i, session, context),
          }))
        : [],
    summary: (() => {
      const filled = (result?.plan ?? []).filter((s) => s.main);
      const proteins = new Map<string, number>();
      const cuisines = new Set<string>();
      for (const s of filled) {
        if (s.main?.protein) proteins.set(s.main.protein, (proteins.get(s.main.protein) ?? 0) + 1);
        if (s.main?.cuisine) cuisines.add(s.main.cuisine);
      }
      return {
        filled: filled.length,
        cuisines: cuisines.size,
        proteins: proteins.size,
        proteinHist: [...proteins.entries()].sort((a, b) => b[1] - a[1]),
      };
    })(),
    start() {
      requestChange(defaultProposeSession(opts.defaultNights ?? 3));
    },
    reset() {
      // Invalidate any in-flight iteration so a late reply cannot repopulate a reset session, and
      // clear busy (the invalidated iteration's own `finally` no longer will).
      seqRef.current++;
      setBusy(false);
      persist(null);
      setResult(null);
      resultRef.current = null;
    },
    setMeal(meal, n) {
      requestChange((() => {
        const s = base();
        const meals = { ...s.meals, [meal]: Math.max(0, n) };
        return { ...s, meals, nights: meals.dinner };
      })());
    },
    swapTo(vibeId, slug) {
      requestChange((() => {
        const s = base();
        return { ...s, locked: { ...s.locked }, overrides: { ...s.overrides, [vibeId]: slug } };
      })());
    },
    pickFacet(vibeId, kind, value) {
      requestChange((() => {
        const s = base();
        const field = kind === "protein" ? "slotProtein" : "slotCuisine";
        const next = { ...s, [field]: { ...s[field] } } as ProposeSession;
        if (value === null) delete next[field][vibeId];
        else next[field][vibeId] = value;
        return next;
      })());
    },
    pickTime(vibeId, value) {
      requestChange((() => {
        const s = base();
        const next = { ...s, slotMaxTime: { ...s.slotMaxTime } };
        if (value === undefined) delete next.slotMaxTime[vibeId];
        else next.slotMaxTime[vibeId] = value;
        return next;
      })());
    },
    applyVibe(vibeId, text) {
      requestChange((() => {
        const s = base();
        return { ...s, slotVibe: { ...s.slotVibe, [vibeId]: text } };
      })());
    },
    resetVibe(vibeId) {
      requestChange((() => {
        const s = base();
        const next = { ...s, slotVibe: { ...s.slotVibe } };
        delete next.slotVibe[vibeId];
        return next;
      })());
    },
    editSides(vibeId, sides) {
      // A sides edit is a LOCAL refinement — update model context WITHOUT a re-query (decision 1).
      sidesChange((() => {
        const s = base();
        return { ...s, slotSides: { ...s.slotSides, [vibeId]: sides } };
      })());
    },
    async commit() {
      const s = sessionRef.current;
      const r = resultRef.current;
      if (!s || !r) return { committed: false };
      const week: ProposeCommitSlot[] = r.plan
        .filter((slot) => slot.main)
        .map((slot) => ({
          slug: slot.main!.slug,
          meal: slot.meal,
          from_vibe: slot.vibe_id,
          sides: slot.vibe_id ? (s.slotSides[slot.vibe_id] ?? slot.sides.map((x) => x.title)) : slot.sides.map((x) => x.title),
        }));
      // A zero-filled week (e.g. a 0/0/0 request) commits nothing — return without touching the
      // adapter, so a widget write never false-succeeds and the member never toasts a misleading
      // "already in your plan". The commit control is also disabled at `summary.filled === 0`.
      if (week.length === 0) return { committed: false };
      setBusy(true);
      try {
        const outcome = await adapter.commit(week);
        if (outcome.reset) {
          // Invalidate any in-flight iteration so a late reply cannot repopulate the cleared session.
          seqRef.current++;
          persist(null);
          setResult(null);
          resultRef.current = null;
        }
        return outcome;
      } finally {
        setBusy(false);
      }
    },
  };

  return controller;
}
