// Plan your week (member-app-propose 6.2–6.5, D7/D8/D11): the design bundle's propose
// flow over the stateless `POST /api/propose`. The intro and empty-palette states, the
// controls row (nights 2–6, adventurousness ↔ `nudges.variety`, protein wants, the
// debounced freeform phrase), the variety bar + commit, and one card per slot with
// lock / swap / exclude / facet pins / vibe override. The forecast shapes the proposal
// server-side only (slots carry `weather_category`); no client forecast display.
// Every change updates the client-side session (localStorage) and re-queries;
// the previous week stays rendered (dimmed) until the next one lands. Commit maps
// filled slots onto P1's plan ops with `from_vibe` + client-assigned open dates, then
// clears the session and lands on the plan page.
import * as React from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Button,
  Crumbs,
  EmptyState,
  IconSparkle,
  NightsStepper,
  NudgeBar,
  RerollButton,
  SlotCard,
  VarietyBar,
  toast,
  type ProposeSlotView,
  type SlotPanel,
} from "@grocery-agent/ui";
import { useIndex, usePlan, useProfile, useVibes, type PlanOp } from "../lib/data";
import { usePlanOps } from "../lib/mutations";
import { useOnline } from "../lib/online";
import {
  buildRequest,
  defaultSession,
  loadSession,
  nextOpenDates,
  saveSession,
  usePropose,
  type ProposeSession,
  type ProposeSlotPayload,
} from "../lib/propose";

export const Route = createFileRoute("/_app/propose")({
  component: ProposePage,
});

function ProposePage() {
  const vibes = useVibes();
  const index = useIndex();
  const profile = useProfile();
  const plan = usePlan();
  const planOps = usePlanOps();
  const online = useOnline();
  const navigate = useNavigate();

  const [session, setSessionState] = React.useState<ProposeSession | null>(loadSession);
  const [openPanel, setOpenPanel] = React.useState<string | null>(null);
  const [committing, setCommitting] = React.useState(false);

  const setSession = (next: ProposeSession | null) => {
    setSessionState(next);
    saveSession(next);
  };

  const prefs = (profile.data?.preferences ?? {}) as Record<string, unknown>;
  const defaultNights =
    typeof prefs.default_cooking_nights === "number" ? prefs.default_cooking_nights : 3;

  /** Every dial auto-starts the session (the mock's startPropose) and re-queries live. */
  const update = (patch: (s: ProposeSession) => ProposeSession) => {
    setSession(patch(session ?? defaultSession(defaultNights)));
  };

  const request = session ? buildRequest(session) : null;
  const propose = usePropose(request);

  const palette = vibes.data?.vibes ?? [];
  const paletteById = new Map(palette.map((v) => [v.id, v]));

  // The facet-pin option universes derive client-side from the cached index (D2).
  const recipes = index.data?.recipes ?? [];
  const proteins = [...new Set(recipes.map((r) => r.protein).filter((p): p is string => !!p))].sort();
  const cuisines = [...new Set(recipes.map((r) => r.cuisine).filter((c): c is string => !!c))].sort();

  const crumbs = (
    <Crumbs
      items={[{ label: "Meal plan", to: "/plan" }, { label: "Plan your week" }]}
      renderLink={(to, label) => <Link to={to}>{label}</Link>}
    />
  );
  const head = (
    <header className="page-head">
      <div>
        <h1>Plan your week</h1>
        <p>Build a week from the moods you cook by — balanced across the week and tuned to the forecast.</p>
      </div>
    </header>
  );

  // ── the empty-palette state: planning starts from night vibes ─────────────
  if (vibes.data && palette.length === 0) {
    return (
      <div data-testid="propose-page">
        {crumbs}
        {head}
        <EmptyState
          testId="propose-empty-palette"
          title="Your palette is empty"
          sub="Planning starts from your night vibes — the kinds of dinners you cook. Add a few in your profile first."
          icon={<IconSparkle />}
          action={
            <Button asChild>
              <Link to="/profile">
                <IconSparkle /> Set up your palette
              </Link>
            </Button>
          }
        />
      </div>
    );
  }

  const display = session ?? defaultSession(defaultNights);
  const controls = (
    <section className="propose-controls" data-testid="propose-controls">
      <div className="pc-row">
        <NightsStepper value={display.nights} min={2} max={6} onChange={(n) => update((s) => ({ ...s, nights: n }))} />
        <div className="pc-actions">
          {session ? (
            <>
              {/* Propose is an online query (D5): re-rolling needs the server. */}
              <RerollButton disabled={!online} onClick={() => update((s) => ({ ...s, seed: s.seed + 1 }))} />
              <Button variant="outline" data-testid="propose-reset" onClick={() => setSession(null)}>
                Start over
              </Button>
            </>
          ) : (
            <Button data-testid="propose-start" onClick={() => update((s) => s)}>
              <IconSparkle /> Propose a week
            </Button>
          )}
        </div>
      </div>
      <NudgeBar
        variety={display.variety}
        onVariety={(v) => update((s) => ({ ...s, variety: v }))}
        proteins={proteins}
        proteinWants={display.proteinWants}
        onToggleProtein={(p) =>
          update((s) => ({
            ...s,
            proteinWants: s.proteinWants.includes(p) ? s.proteinWants.filter((x) => x !== p) : [...s.proteinWants, p],
          }))
        }
        freeform={display.freeform}
        onFreeform={(text) => {
          // Only a real change re-queries (the debounced input fires on mount too).
          if (text !== (session?.freeform ?? "")) update((s) => ({ ...s, freeform: text }));
        }}
      />
    </section>
  );

  // ── the intro state: dials set, nothing proposed yet ──────────────────────
  if (!session) {
    return (
      <div data-testid="propose-page">
        {crumbs}
        {head}
        {controls}
        <div className="propose-intro" data-testid="propose-intro">
          <p>
            <IconSparkle /> Set the dials above, then propose a week — picked from the kinds of dinners you cook,
            spread out so it doesn’t feel samey, with the weather taken into account. Tweak any dial and the week
            updates live. Nothing’s added to your plan until you say so.
          </p>
        </div>
      </div>
    );
  }

  const data = propose.data;
  const slots: { payload: ProposeSlotPayload; view: ProposeSlotView }[] = (data?.plan ?? [])
    .filter((s) => s.vibe_id !== null)
    .map((s, i) => ({ payload: s, view: toView(s, i, session, paletteById) }));

  const filled = slots.filter((s) => s.payload.main);
  const mainProteins = new Map<string, number>();
  const mainCuisines = new Set<string>();
  for (const s of filled) {
    const m = s.payload.main!;
    if (m.protein) mainProteins.set(m.protein, (mainProteins.get(m.protein) ?? 0) + 1);
    if (m.cuisine) mainCuisines.add(m.cuisine);
  }

  async function commit() {
    if (!data) return;
    setCommitting(true);
    try {
      const existing = plan.data?.planned ?? [];
      const inPlan = new Set(existing.map((r) => r.recipe.toLowerCase()));
      const fresh = filled.filter((s) => !inPlan.has(s.payload.main!.slug.toLowerCase()));
      if (fresh.length === 0) {
        toast("Those are already in your plan");
      } else {
        const dates = nextOpenDates(existing, fresh.length);
        const ops: PlanOp[] = fresh.map((s, i) => ({
          op: "add",
          recipe: s.payload.main!.slug,
          from_vibe: s.payload.vibe_id,
          sides: s.payload.sides.map((x) => x.title),
          planned_for: dates[i],
        }));
        // The commit is P1's class (b) plan-ops registry mutation; awaiting settle is
        // fine here — the propose flow itself is online-only, so the commit runs live.
        await planOps.mutateAsync({ ops });
        const skipped = filled.length - fresh.length;
        toast(
          `Committed ${fresh.length} night${fresh.length === 1 ? "" : "s"} to your meal plan${skipped ? ` — ${skipped} already there` : ""}`,
        );
      }
      setSession(null);
      await navigate({ to: "/plan" });
    } catch {
      toast("Couldn't commit the week — try again");
    } finally {
      setCommitting(false);
    }
  }

  return (
    <div data-testid="propose-page">
      {crumbs}
      {head}
      {controls}
      {data ? (
        <VarietyBar
          nights={filled.length}
          cuisines={mainCuisines.size}
          proteins={mainProteins.size}
          proteinHist={[...mainProteins.entries()].sort((a, b) => b[1] - a[1])}
          onCommit={() => void commit()}
          committing={committing}
        />
      ) : null}
      <div className="slot-list" data-testid="slot-list" data-stale={propose.isPlaceholderData ? "true" : undefined}>
        {slots.map(({ view }) => (
          <SlotCard
            key={view.key}
            slot={view}
            panel={panelOf(openPanel, view.key)}
            onPanel={(p) => setOpenPanel(p ? `${view.key}|${p}` : null)}
            proteins={proteins}
            cuisines={cuisines}
            palettePresets={palette.map((v) => v.vibe)}
            renderTitle={(slug, title) => (
              <Link className="slot-title" to="/recipe/$slug" params={{ slug }}>
                {title}
              </Link>
            )}
            onLockToggle={() =>
              update((s) => {
                const next = { ...s, locked: { ...s.locked }, overrides: { ...s.overrides } };
                if (next.locked[view.vibeId]) {
                  delete next.locked[view.vibeId];
                  delete next.overrides[view.vibeId]; // unlock frees the night entirely
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
                delete next.locked[view.vibeId]; // "not this one" clears the slot's pin (D7)
                delete next.overrides[view.vibeId];
                return next;
              })
            }
            onFacetPick={(kind, value) =>
              update((s) => {
                const field = kind === "protein" ? "slotProtein" : "slotCuisine";
                const next = { ...s, [field]: { ...s[field] } } as ProposeSession;
                if (value === null) delete next[field][view.vibeId];
                else next[field][view.vibeId] = value;
                return next;
              })
            }
            onTimePick={(value) =>
              update((s) => {
                const next = { ...s, slotMaxTime: { ...s.slotMaxTime } };
                if (value === undefined) delete next.slotMaxTime[view.vibeId];
                else next.slotMaxTime[view.vibeId] = value; // number caps; null = "Any time"
                return next;
              })
            }
            onVibeApply={(text) =>
              update((s) => ({ ...s, slotVibe: { ...s.slotVibe, [view.vibeId]: text } }))
            }
            onVibeReset={() =>
              update((s) => {
                const next = { ...s, slotVibe: { ...s.slotVibe } };
                delete next.slotVibe[view.vibeId];
                return next;
              })
            }
          />
        ))}
      </div>
    </div>
  );
}

function panelOf(open: string | null, key: string): SlotPanel {
  if (!open || !open.startsWith(`${key}|`)) return null;
  return open.slice(key.length + 1) as SlotPanel;
}

/** Map one endpoint slot + the session's pins onto the card's view shape. */
function toView(
  s: ProposeSlotPayload,
  index: number,
  session: ProposeSession,
  paletteById: Map<string, { vibe: string }>,
): ProposeSlotView {
  const vibeId = s.vibe_id!;
  const override = session.slotVibe[vibeId];
  const flags: ProposeSlotView["flags"] = [];
  if (s.flags.waste?.length) flags.push({ type: "waste", label: `Single-use: ${s.flags.waste.join(", ")}` });
  if (s.flags.meal_prep) flags.push({ type: "meal-prep", label: "Meal-preps well" });
  if (s.flags.no_corpus_side) flags.push({ type: "side", label: "No corpus side — add your own" });
  return {
    key: `${vibeId}:${index}`,
    vibeId,
    vibeLabel: override ?? paletteById.get(vibeId)?.vibe ?? vibeId,
    vibeEdited: !!override,
    weatherCategory: s.weather_category ?? null,
    main: s.main,
    emptyReason: s.empty_reason ?? null,
    locked: !!s.main && session.locked[vibeId] === s.main.slug,
    pinnedProtein: session.slotProtein[vibeId] ?? null,
    pinnedCuisine: session.slotCuisine[vibeId] ?? null,
    timePin: {
      explicit: vibeId in session.slotMaxTime,
      value: session.slotMaxTime[vibeId] ?? null,
    },
    why: s.why,
    sides: s.sides.map((x) => x.title),
    flags,
    alternates: s.alternates,
    altSimilar: s.alt_similar,
    altDifferent: s.alt_different,
  };
}
