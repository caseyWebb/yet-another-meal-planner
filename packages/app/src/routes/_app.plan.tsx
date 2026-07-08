// Meal plan (member-app-core 7.6, D3): scheduled/unscheduled groups over the plan
// read; date set/CLEAR and side add/REMOVE ride the `set` op (replace semantics —
// the only way to remove a side or unschedule a night), remove drops the row, and
// the add-recipe combobox pulls from the cached index. "Plan my week" opens the
// propose flow (member-app-propose).
import * as React from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import {
  Button,
  Combobox,
  EmptyState,
  GroupHeading,
  IconCalendar,
  IconPlus,
  IconSparkle,
  IconTrash,
  IconX,
  PageHead,
  toast,
} from "@grocery-agent/ui";
import { useIndex, usePlan, type PlannedRow } from "../lib/data";
import { usePlanOps } from "../lib/mutations";

export const Route = createFileRoute("/_app/plan")({
  component: PlanPage,
});

function PlanPage() {
  const plan = usePlan();
  const index = useIndex();
  const planOps = usePlanOps();

  const items = plan.data?.planned ?? [];
  const scheduled = items
    .filter((p) => p.planned_for)
    .sort((a, b) => String(a.planned_for).localeCompare(String(b.planned_for)));
  const unscheduled = items.filter((p) => !p.planned_for);

  const inPlan = new Set(items.map((p) => p.recipe.toLowerCase()));
  const addOptions = (index.data?.recipes ?? [])
    .filter((r) => !inPlan.has(r.slug.toLowerCase()))
    .map((r) => ({
      value: r.slug,
      label: r.title,
      sub: [r.protein, r.cuisine].filter(Boolean).join(" · "),
    }));

  function addRecipe(slug: string) {
    // Fire-and-forget registry mutation: offline it queues (the pill explains);
    // failures toast through the registered defaults.
    planOps.mutate({ ops: [{ op: "add", recipe: slug }] }, { onSuccess: () => toast("Added to meal plan") });
  }

  const actions = (
    <div className="field-inline plan-add-inline">
      <Combobox
        options={addOptions}
        placeholder="Add a recipe…"
        ariaLabel="Add a recipe to the plan"
        emptyText="No recipes match"
        onSelect={addRecipe}
      />
      <Button asChild variant="outline" data-testid="plan-my-week">
        <Link to="/propose">
          <IconSparkle /> Plan my week
        </Link>
      </Button>
    </div>
  );

  return (
    <div data-testid="plan-page">
      <PageHead
        title="Meal plan"
        sub="What you're cooking next. Schedule a night, add sides, or pull a recipe in."
        actions={actions}
      />
      {plan.data && items.length === 0 ? (
        <EmptyState
          title="Nothing planned"
          sub="Add a recipe from here or hit “Add to meal plan” on any recipe."
          icon={<IconCalendar />}
        />
      ) : (
        <>
          {scheduled.length ? (
            <div className="plan-group" data-testid="plan-scheduled">
              <GroupHeading>Scheduled</GroupHeading>
              {scheduled.map((p) => (
                <PlanRow key={p.recipe} row={p} titleOf={titleOf(index.data?.recipes)} />
              ))}
            </div>
          ) : null}
          {unscheduled.length ? (
            <div className="plan-group" data-testid="plan-unscheduled">
              <GroupHeading>Unscheduled</GroupHeading>
              {unscheduled.map((p) => (
                <PlanRow key={p.recipe} row={p} titleOf={titleOf(index.data?.recipes)} />
              ))}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function titleOf(recipes: { slug: string; title: string }[] | undefined) {
  const bySlug = new Map((recipes ?? []).map((r) => [r.slug.toLowerCase(), r.title]));
  return (slug: string) => bySlug.get(slug.toLowerCase()) ?? slug;
}

function PlanRow({ row, titleOf }: { row: PlannedRow; titleOf: (slug: string) => string }) {
  const planOps = usePlanOps();
  const [addingSide, setAddingSide] = React.useState(false);
  const sides = row.sides ?? [];

  // Every edit is a `set` (D3): sides replace wholesale; planned_for null clears.
  function set(patch: { planned_for?: string | null; sides?: string[] }) {
    planOps.mutate({ ops: [{ op: "set", recipe: row.recipe, ...patch }] });
  }

  function remove() {
    planOps.mutate({ ops: [{ op: "remove", recipe: row.recipe }] });
  }

  return (
    <div className="plan-row" data-testid="plan-row" data-recipe={row.recipe}>
      <div className="plan-when">
        <input
          type="date"
          className="input plan-date"
          value={row.planned_for ?? ""}
          aria-label="Planned date"
          data-testid="plan-date"
          onChange={(e) => set({ planned_for: e.target.value || null })}
        />
      </div>
      <div className="plan-main">
        <Link className="plan-title" to="/recipe/$slug" params={{ slug: row.recipe }}>
          {titleOf(row.recipe)}
        </Link>
        <div className="plan-sides">
          {sides.map((s) => (
            <span className="side-chip" key={s} data-testid="side-chip">
              {s}
              <button
                type="button"
                className="side-x"
                title="Remove side"
                aria-label={`Remove side ${s}`}
                onClick={() => set({ sides: sides.filter((x) => x !== s) })}
              >
                <IconX />
              </button>
            </span>
          ))}
          {addingSide ? (
            <span className="side-input-wrap side-combo">
              <Combobox
                options={[]}
                placeholder="add a side…"
                ariaLabel="Add a side"
                allowCustom
                autoFocus
                emptyText="Type a side and press Enter"
                onSelect={(v) => {
                  const side = v.trim().toLowerCase();
                  if (side && !sides.includes(side)) set({ sides: [...sides, side] });
                  setAddingSide(false);
                }}
                onCancel={() => setAddingSide(false)}
              />
            </span>
          ) : (
            <button type="button" className="side-add" title="Add a side" data-testid="side-add" onClick={() => setAddingSide(true)}>
              <IconPlus /> side
            </button>
          )}
        </div>
      </div>
      <button type="button" className="icon-btn" title="Remove from plan" data-testid="plan-remove" onClick={remove}>
        <IconTrash />
      </button>
    </div>
  );
}
