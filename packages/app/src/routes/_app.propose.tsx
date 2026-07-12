// Plan your week (member-app-propose / shared-propose-orchestration, D8/D20): the design
// bundle's propose flow over the stateless `POST /api/propose`, as a THIN adapter over the shared
// `useProposeController`. The intro and empty-palette states, the controls row (per-meal
// steppers), the variety bar + commit, and one card per slot with swap / facet pins / vibe
// override / sides editing. The D8-cut controls (adventurousness, protein wants, freeform,
// re-roll, per-slot lock + exclude) are absent from the shared surface. The controller re-queries
// on every request-changing edit; a sides edit refines the already-proposed week without a
// re-query. Commit maps filled slots onto P1's plan ops with `from_vibe` + client-assigned open
// dates, then clears the session and lands on the plan page.
import * as React from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Button,
  Crumbs,
  EmptyState,
  IconSparkle,
  MealsStepper,
  SlotCard,
  VarietyBar,
  proposePanelOf,
  toast,
  useProposeController,
  type ProposeHostAdapter,
} from "@yamp/ui";
import { useIndex, usePlan, useProfile, useVibes, type PlanOp, mintRowId } from "../lib/data";
import { usePlanOps } from "../lib/mutations";
import { useOnline } from "../lib/online";
import {
  defaultSession,
  fetchPropose,
  loadSession,
  nextOpenDates,
  saveSession,
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

  const [openPanel, setOpenPanel] = React.useState<string | null>(null);
  const [initialSession] = React.useState(loadSession);

  const prefs = (profile.data?.preferences ?? {}) as Record<string, unknown>;
  const defaultNights =
    typeof prefs.default_cooking_nights === "number" ? prefs.default_cooking_nights : 3;

  const palette = vibes.data?.vibes ?? [];
  const paletteById = new Map(palette.map((v) => [v.id, v]));

  // The facet-pin option universes derive client-side from the cached index (D2).
  const recipes = index.data?.recipes ?? [];
  const proteins = [...new Set(recipes.map((r) => r.protein).filter((p): p is string => !!p))].sort();
  const cuisines = [...new Set(recipes.map((r) => r.cuisine).filter((c): c is string => !!c))].sort();

  // The member adapter: iterate is the stateless POST; there is no MCP bridge, so no syncContext;
  // commit routes through P1's class (b) plan-ops path and lands on the plan page.
  const adapter: ProposeHostAdapter = {
    capabilities: { canIterate: true, canCommit: online },
    iterate: (request) => fetchPropose(request),
    async commit(week) {
      try {
        const existing = plan.data?.planned ?? [];
        const inPlan = new Set(existing.map((r) => r.recipe.toLowerCase()));
        const fresh = week.filter((s) => !inPlan.has(s.slug.toLowerCase()));
        if (fresh.length === 0) {
          toast("Those are already in your plan");
          await navigate({ to: "/plan" });
          return { committed: false, reset: true };
        }
        const dates = nextOpenDates(existing, fresh.length);
        // Each filled slot maps to an `add` op carrying a CLIENT-MINTED ULID row id (the class (b)
        // replay key), the slot's `meal`, its edited sides, and its vibe provenance. The commit
        // NEVER sets `duplicate` — the op layer's slug-global coalesce makes "commit updates an
        // existing row rather than duplicating" structural (D26-final).
        const ops: PlanOp[] = fresh.map((s, i) => ({
          op: "add",
          id: mintRowId(),
          recipe: s.slug,
          meal: s.meal,
          from_vibe: s.from_vibe,
          sides: s.sides,
          planned_for: dates[i],
        }));
        await planOps.mutateAsync({ ops });
        const skipped = week.length - fresh.length;
        toast(
          `Committed ${fresh.length} night${fresh.length === 1 ? "" : "s"} to your meal plan${skipped ? ` — ${skipped} already there` : ""}`,
        );
        await navigate({ to: "/plan" });
        return { committed: true, reset: true };
      } catch {
        toast("Couldn't commit the week — try again");
        return { committed: false };
      }
    },
  };

  const controller = useProposeController({
    adapter,
    context: { getVibeLabel: (vibeId) => paletteById.get(vibeId)?.vibe },
    initialSession,
    iterateOnMount: true,
    onSessionChange: saveSession,
    defaultNights,
  });

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

  // ── the empty-palette state: planning starts from meal vibes ─────────────
  if (vibes.data && palette.length === 0) {
    return (
      <div data-testid="propose-page">
        {crumbs}
        {head}
        <EmptyState
          testId="propose-empty-palette"
          title="Your palette is empty"
          sub="Planning starts from your meal vibes — the kinds of meals you cook. Add a few in your profile first."
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

  const displayMeals = controller.session?.meals ?? defaultSession(defaultNights).meals;
  const controls = (
    <section className="propose-controls" data-testid="propose-controls">
      <div className="pc-row">
        <MealsStepper meals={displayMeals} onChange={(meal, n) => controller.setMeal(meal, n)} />
        <div className="pc-actions">
          {controller.session ? (
            <Button variant="outline" data-testid="propose-reset" onClick={() => controller.reset()}>
              Start over
            </Button>
          ) : (
            <Button data-testid="propose-start" onClick={() => controller.start()}>
              <IconSparkle /> Propose a week
            </Button>
          )}
        </div>
      </div>
    </section>
  );

  // ── the intro state: dials set, nothing proposed yet ──────────────────────
  if (!controller.session) {
    return (
      <div data-testid="propose-page">
        {crumbs}
        {head}
        {controls}
        <div className="propose-intro" data-testid="propose-intro">
          <p>
            <IconSparkle /> Set how many of each meal you want above, then propose a week — picked from the kinds of
            meals you cook, spread out so it doesn’t feel samey, with the weather taken into account. Tweak any night
            and the week updates live. Nothing’s added to your plan until you say so.
          </p>
        </div>
      </div>
    );
  }

  const slots = controller.slots.filter(({ payload }) => payload.vibe_id !== null);

  return (
    <div data-testid="propose-page">
      {crumbs}
      {head}
      {controls}
      {controller.result ? (
        <VarietyBar
          nights={controller.summary.filled}
          cuisines={controller.summary.cuisines}
          proteins={controller.summary.proteins}
          proteinHist={controller.summary.proteinHist}
          onCommit={() => void controller.commit()}
          committing={controller.busy || !online}
        />
      ) : null}
      <div className="slot-list" data-testid="slot-list" data-stale={controller.busy ? "true" : undefined}>
        {slots.map(({ view }) => (
          <SlotCard
            key={view.key}
            slot={view}
            panel={proposePanelOf(openPanel, view.key)}
            onPanel={(p) => setOpenPanel(p ? `${view.key}|${p}` : null)}
            proteins={proteins}
            cuisines={cuisines}
            palettePresets={palette.map((v) => v.vibe)}
            renderTitle={(slug, title) => (
              <Link className="slot-title" to="/recipe/$slug" params={{ slug }}>
                {title}
              </Link>
            )}
            onSwapTo={(slug) => controller.swapTo(view.vibeId, slug)}
            onFacetPick={(kind, value) => controller.pickFacet(view.vibeId, kind, value)}
            onTimePick={(value) => controller.pickTime(view.vibeId, value)}
            onVibeApply={(text) => controller.applyVibe(view.vibeId, text)}
            onVibeReset={() => controller.resetVibe(view.vibeId)}
            onSidesChange={(sides) => controller.editSides(view.vibeId, sides)}
          />
        ))}
      </div>
    </div>
  );
}
