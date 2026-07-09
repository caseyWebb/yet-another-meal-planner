// The interactive meal-plan proposal card (meal-plan-widget). Hydrated from the
// `display_meal_plan` tool's `structuredContent` (ProposeCardData), it reproduces the member
// app's "Plan your week" surface — the controls row (nights / adventurousness / protein wants /
// freeform), the variety bar, and one SlotCard per night with lock / swap / exclude / facet pins /
// per-slot vibe — reusing the SAME @yamp/ui propose primitives + cookbook.css classes as the web
// app, inside the conversation.
//
// Iteration is MODEL-FREE (D8): every dial updates a client session and replays the adjusted
// request against the STATELESS propose op through the host — `App.callServerTool` proxies the
// call straight to `propose_meal_plan` (no frontier-model turn), and the card re-renders from the
// new result. This is the exact client-side session-replay the member web app relies on, only the
// transport is the ext-apps bridge instead of `POST /api/propose`. The dials are withheld and the
// week renders read-only when the host does not advertise the `serverTools` capability, the member
// has no palette, OR the proposal isn't palette-round-trippable (an ephemeral-authored or vibe-less
// week the palette-flow request can't reproduce) — the plan is never blocked (the MCP text
// `content` fallback is the floor below that).
import * as React from "react";
import type { App } from "@modelcontextprotocol/ext-apps";
import type { ProposeCardData, ProposeCardSlot } from "@yamp/contract";
import {
  IconSparkle,
  NightsStepper,
  NudgeBar,
  RerollButton,
  SlotCard,
  VarietyBar,
  type ProposeSlotView,
  type SlotPanel,
} from "@yamp/ui";

/** The result-portion of ProposeCardData — what a `propose_meal_plan` re-invocation returns (the
 *  op's `ProposeResult`), merged back over the held render context on each dial change. */
type ProposeResultLike = Pick<ProposeCardData, "plan" | "variety" | "uncovered_at_risk" | "diagnostics" | "note">;

/** The client session (the member app's `ProposeSession`, faithfully): every key is a vibe id. */
interface Session {
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

interface RequestSlot {
  vibe_id: string;
  protein?: string;
  cuisine?: string;
  max_time_total?: number | null;
  vibe?: string;
  recipe?: string;
}
interface ProposeReq {
  nights: number;
  seed: number;
  exclude?: string[];
  nudges?: { variety?: number; freeform?: string; proteins?: string[] };
  slots?: RequestSlot[];
}

/** Seed the session from the request that produced the initial week, so a re-roll / stepper starts
 *  from the exact plan the caller sees (and any agent-supplied slot pins are reflected). */
function initSession(req: ProposeCardData["request"]): Session {
  const s: Session = {
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
    if (slot.protein) s.slotProtein[slot.vibe_id] = slot.protein;
    if (slot.cuisine) s.slotCuisine[slot.vibe_id] = slot.cuisine;
    if (slot.max_time_total !== undefined) s.slotMaxTime[slot.vibe_id] = slot.max_time_total;
    if (slot.vibe) s.slotVibe[slot.vibe_id] = slot.vibe;
    if (slot.recipe) s.overrides[slot.vibe_id] = slot.recipe;
  }
  return s;
}

/** Serialize the session into the canonical propose request (the member app's `buildRequest`): UI
 *  lock / swap / pick-list → identity-preserving `slots[].recipe`, facet chips →
 *  `slots[].{protein,cuisine,max_time_total}`, the vibe panel → `slots[].vibe`, "not this one" →
 *  `exclude`, the slider → `nudges.variety`, the phrase box → `nudges.freeform`. Slot ids sorted so
 *  the same choices always serialize identically (the op is deterministic on its body). */
function buildRequest(s: Session): ProposeReq {
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
  const nudges: ProposeReq["nudges"] = { variety: s.variety };
  if (s.freeform.trim()) nudges.freeform = s.freeform.trim();
  if (s.proteinWants.length) nudges.proteins = [...s.proteinWants].sort();
  const req: ProposeReq = { nights: s.nights, seed: s.seed, nudges };
  if (s.excluded.length) req.exclude = [...s.excluded].sort();
  if (slots.length) req.slots = slots;
  return req;
}

/** The host-proxied tool-call result shape, taken from the ext-apps client so no direct SDK
 *  dependency is needed (the widget package only depends on `@modelcontextprotocol/ext-apps`). */
type CallResult = Awaited<ReturnType<App["callServerTool"]>>;

/** Parse a `propose_meal_plan` re-invocation result. The op returns its structured payload as one
 *  JSON text content item (src/errors.ts `ok`); some hosts may also surface `structuredContent`. */
function parseProposeResult(res: CallResult): ProposeResultLike | null {
  if (res.isError) return null;
  if (res.structuredContent && "plan" in res.structuredContent) return res.structuredContent as unknown as ProposeResultLike;
  const content = res.content as Array<{ type: string; text?: string }> | undefined;
  const text = content?.find((c) => c.type === "text")?.text;
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as ProposeResultLike;
    return Array.isArray(parsed.plan) ? parsed : null;
  } catch {
    return null;
  }
}

/** Map one endpoint slot + the session's pins onto the card's view shape (the member app's `toView`). */
function toView(s: ProposeCardSlot, index: number, session: Session, vibeLabels: Record<string, string>): ProposeSlotView {
  const vibeId = s.vibe_id as string;
  const override = session.slotVibe[vibeId];
  const flags: ProposeSlotView["flags"] = [];
  if (s.flags.waste?.length) flags.push({ type: "waste", label: `Single-use: ${s.flags.waste.join(", ")}` });
  if (s.flags.meal_prep) flags.push({ type: "meal-prep", label: "Meal-preps well" });
  if (s.flags.no_corpus_side) flags.push({ type: "side", label: "No corpus side — add your own" });
  return {
    key: `${vibeId}:${index}`,
    vibeId,
    // A palette / ephemeral slot resolves its phrase from vibeLabels (ephemeral ids are labeled
    // there too); a vibe-less slot (new_for_me / caller lock → null id) gets the text-fallback name.
    vibeLabel: override ?? (s.vibe_id ? (vibeLabels[s.vibe_id] ?? s.vibe_id) : s.reason === "new_for_me" ? "new to you" : "your pick"),
    vibeEdited: !!override,
    weatherCategory: s.weather_category ?? null,
    main: s.main,
    emptyReason: s.empty_reason ?? null,
    locked: !!s.main && session.locked[vibeId] === s.main.slug,
    pinnedProtein: session.slotProtein[vibeId] ?? null,
    pinnedCuisine: session.slotCuisine[vibeId] ?? null,
    timePin: { explicit: vibeId in session.slotMaxTime, value: session.slotMaxTime[vibeId] ?? null },
    why: s.why,
    sides: s.sides.map((x) => x.title),
    flags,
    alternates: s.alternates,
    altSimilar: s.alt_similar,
    altDifferent: s.alt_different,
  };
}

function panelOf(open: string | null, key: string): SlotPanel {
  if (!open || !open.startsWith(`${key}|`)) return null;
  return open.slice(key.length + 1) as SlotPanel;
}

export function ProposeCard({ app, data }: { app: App; data: ProposeCardData }) {
  // The result-portion is held and refreshed on iteration; the render context (vibe labels, facet
  // universes, presets) is stable within a session, so it stays as the initial `data`.
  const [render, setRender] = React.useState<ProposeResultLike>(data);
  const [session, setSession] = React.useState<Session>(() => initSession(data.request));
  const [openPanel, setOpenPanel] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  // A monotonic request token: racing dial changes each bump it, and only the LATEST in-flight
  // rerun is allowed to land its result / clear busy — a slower earlier reply can't clobber a
  // newer week (only RerollButton was `disabled={busy}`; the NudgeBar/SlotCard dials are not).
  const seqRef = React.useRef(0);

  // Iteration replays the palette-flow request (`buildRequest`) against the stateless op, so it is
  // only safe when the proposal is palette-round-trippable: every slot keyed by a real palette vibe
  // id. A vibe-less slot (new_for_me / caller lock → null id) or an ephemeral slot (synthetic
  // `ephemeral-N` id, minted by the op and absent from the palette) can't be reproduced by
  // buildRequest — iterating would silently drop it and revert an ephemeral / discovery week to a
  // plain palette week. Those render read-only. Iteration also needs the host to proxy tool calls
  // (`serverTools`) and a palette to reshape (an ephemeral-only member has none).
  const roundTrippable = render.plan.every((s) => s.vibe_id !== null && !s.vibe_id.startsWith("ephemeral-"));
  const canIterate =
    app.getHostCapabilities()?.serverTools != null && data.palettePresets.length > 0 && roundTrippable;

  /** Apply a session patch and (when iterable) replay it against the stateless op. `session` is the
   *  current render's state — a dial change is a discrete user event, so it is never stale here. */
  const update = (patch: (s: Session) => Session): void => {
    const next = patch(session);
    setSession(next);
    void rerun(next);
  };

  async function rerun(next: Session): Promise<void> {
    if (!canIterate) return;
    const seq = ++seqRef.current;
    setBusy(true);
    try {
      const res = await app.callServerTool({ name: "propose_meal_plan", arguments: buildRequest(next) as unknown as Record<string, unknown> });
      const result = parseProposeResult(res);
      // On a host/transport hiccup keep the current week rendered rather than blanking the card;
      // ignore a reply that a newer dial change has already superseded (stale-week guard).
      if (result && seq === seqRef.current) setRender((prev) => ({ ...prev, ...result }));
    } catch {
      // transport failure — the current week stays; the member can retry a dial
    } finally {
      if (seq === seqRef.current) setBusy(false);
    }
  }

  async function commit(): Promise<void> {
    // Committing writes the plan; hand the chosen week back to the conversation so the agent runs
    // update_meal_plan (best-effort — a host without sendMessage simply no-ops).
    try {
      await app.sendMessage({ role: "user", content: [{ type: "text", text: "Add this proposed week to my meal plan." }] });
    } catch {
      // host without a chat-message channel — nothing to do
    }
  }

  // The empty-palette short-circuit: the op returns a note and no plan.
  if (render.note && render.plan.length === 0) {
    return (
      <div className="plan-propose-widget" data-widget="plan-propose" data-testid="propose-empty">
        <p className="propose-intro">
          <IconSparkle /> {render.note}
        </p>
      </div>
    );
  }

  // Render EVERY slot the op returned — locked / new_for_me / ephemeral slots included — so the card
  // matches the text fallback and `diagnostics.filled` (a filtered subset would hide real nights).
  const slots = render.plan;
  const filled = slots.filter((s) => s.main);
  const mainProteins = new Map<string, number>();
  const mainCuisines = new Set<string>();
  for (const s of filled) {
    if (s.main?.protein) mainProteins.set(s.main.protein, (mainProteins.get(s.main.protein) ?? 0) + 1);
    if (s.main?.cuisine) mainCuisines.add(s.main.cuisine);
  }

  const views = slots.map((s, i) => ({ payload: s, view: toView(s, i, session, data.vibeLabels) }));

  return (
    <div className="plan-propose-widget" data-widget="plan-propose" data-testid="propose-card">
      {canIterate ? (
        <section className="propose-controls" data-testid="propose-controls">
          <div className="pc-row">
            <NightsStepper value={session.nights} min={2} max={6} onChange={(n) => update((s) => ({ ...s, nights: n }))} />
            <div className="pc-actions">
              <RerollButton disabled={busy} onClick={() => update((s) => ({ ...s, seed: s.seed + 1 }))} />
            </div>
          </div>
          <NudgeBar
            variety={session.variety}
            onVariety={(v) => update((s) => ({ ...s, variety: v }))}
            proteins={data.proteins}
            proteinWants={session.proteinWants}
            onToggleProtein={(p) =>
              update((s) => ({
                ...s,
                proteinWants: s.proteinWants.includes(p) ? s.proteinWants.filter((x) => x !== p) : [...s.proteinWants, p],
              }))
            }
            freeform={session.freeform}
            onFreeform={(text) => {
              if (text !== session.freeform) update((s) => ({ ...s, freeform: text }));
            }}
          />
        </section>
      ) : null}

      <VarietyBar
        nights={render.diagnostics.filled}
        cuisines={mainCuisines.size}
        proteins={mainProteins.size}
        proteinHist={[...mainProteins.entries()].sort((a, b) => b[1] - a[1])}
        onCommit={() => void commit()}
      />

      <div className="slot-list" data-testid="slot-list" data-stale={busy ? "true" : undefined}>
        {views.map(({ view }) =>
          canIterate ? (
            <SlotCard
              key={view.key}
              slot={view}
              panel={panelOf(openPanel, view.key)}
              onPanel={(p) => setOpenPanel(p ? `${view.key}|${p}` : null)}
              proteins={data.proteins}
              cuisines={data.cuisines}
              palettePresets={data.palettePresets}
              renderTitle={(_slug, title) => <span className="slot-title">{title}</span>}
              onLockToggle={() =>
                update((s) => {
                  const next = { ...s, locked: { ...s.locked }, overrides: { ...s.overrides } };
                  if (next.locked[view.vibeId]) {
                    delete next.locked[view.vibeId];
                    delete next.overrides[view.vibeId];
                  } else if (view.main) {
                    next.locked[view.vibeId] = view.main.slug;
                    delete next.overrides[view.vibeId];
                  }
                  return next;
                })
              }
              onSwapTo={(slug) =>
                update((s) => {
                  const next = { ...s, locked: { ...s.locked }, overrides: { ...s.overrides, [view.vibeId]: slug } };
                  delete next.locked[view.vibeId];
                  return next;
                })
              }
              onExclude={() =>
                update((s) => {
                  if (!view.main) return s;
                  const slug = view.main.slug;
                  const next = {
                    ...s,
                    excluded: s.excluded.includes(slug) ? s.excluded : [...s.excluded, slug],
                    locked: { ...s.locked },
                    overrides: { ...s.overrides },
                  };
                  delete next.locked[view.vibeId];
                  delete next.overrides[view.vibeId];
                  return next;
                })
              }
              onFacetPick={(kind, value) =>
                update((s) => {
                  const field = kind === "protein" ? "slotProtein" : "slotCuisine";
                  const next = { ...s, [field]: { ...s[field] } } as Session;
                  if (value === null) delete next[field][view.vibeId];
                  else next[field][view.vibeId] = value;
                  return next;
                })
              }
              onTimePick={(value) =>
                update((s) => {
                  const next = { ...s, slotMaxTime: { ...s.slotMaxTime } };
                  if (value === undefined) delete next.slotMaxTime[view.vibeId];
                  else next.slotMaxTime[view.vibeId] = value;
                  return next;
                })
              }
              onVibeApply={(text) => update((s) => ({ ...s, slotVibe: { ...s.slotVibe, [view.vibeId]: text } }))}
              onVibeReset={() =>
                update((s) => {
                  const next = { ...s, slotVibe: { ...s.slotVibe } };
                  delete next.slotVibe[view.vibeId];
                  return next;
                })
              }
            />
          ) : (
            <ReadOnlySlot key={view.key} slot={view} />
          ),
        )}
      </div>
    </div>
  );
}

/** The degraded slot render (no host callback support / palette-less proposal): the same card
 *  furniture without the interactive controls — the visual form of the text `content` fallback. */
function ReadOnlySlot({ slot }: { slot: ProposeSlotView }) {
  const facets = [slot.pinnedProtein ?? slot.main?.protein, slot.pinnedCuisine ?? slot.main?.cuisine].filter(
    (x): x is string => !!x,
  );
  return (
    <article className={`slot-card${slot.main ? "" : " empty-slot"}`} data-testid="slot-card" data-vibe={slot.vibeId}>
      <div className="slot-head">
        <div className="slot-head-label">
          <span className="slot-vibe">{slot.vibeLabel}</span>
          {slot.weatherCategory ? <span className="slot-wx">{slot.weatherCategory} weather</span> : null}
        </div>
      </div>
      {slot.main ? (
        <>
          <span className="slot-title">{slot.main.title}</span>
          {slot.main.description ? <p className="slot-desc">{slot.main.description}</p> : null}
          <div className="slot-facets">
            {facets.map((f) => (
              <span className="facet" key={f}>
                {f}
              </span>
            ))}
            {slot.main.time_total != null ? <span className="facet">{slot.main.time_total} min</span> : null}
          </div>
          <div className="slot-why">
            {slot.why.map((w) => (
              <span className="why-chip" key={w}>
                {w}
              </span>
            ))}
          </div>
          <div className="slot-footer">
            <div className="slot-sides">
              {slot.sides.length ? (
                slot.sides.map((x) => (
                  <span className="side-chip" key={x}>
                    {x}
                  </span>
                ))
              ) : (
                <span className="muted small">no side</span>
              )}
            </div>
          </div>
        </>
      ) : (
        <p className="slot-empty-reason">{slot.emptyReason ?? "No recipe fits this night."}</p>
      )}
    </article>
  );
}
