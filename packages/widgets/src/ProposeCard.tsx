// The interactive meal-plan proposal card (meal-plan-widget / shared-propose-orchestration).
// Hydrated from the `display_meal_plan` tool's `structuredContent` (ProposeCardData), it reproduces
// the member app's "Plan your week" surface — the per-meal steppers, the variety bar, and one
// SlotCard per night with swap / facet pins / per-slot vibe / sides editing — as a THIN adapter
// over the SAME shared `useProposeController` the member route uses (D20: one component, identical
// control set on both hosts).
//
// This is the first WRITING widget (D18). The shared controller drives the three ext-apps channels
// through `createBridgeAdapter`:
//   • a refinement (per-meal / swap / facet / vibe) → callServerTool(propose_meal_plan) proxied by
//     the host straight to the STATELESS op (no frontier-model turn) + a full proposed-week snapshot
//     to the host model via ui/update-model-context.
//   • a sides edit → ui/update-model-context ONLY (no re-query — a local refinement).
//   • commit → the D18 write sequence: read_meal_plan → pack dates → update_meal_plan → re-read →
//     update-model-context(committed) → ui/message.
// Capability ladder (D18) + contract-version gate (D19) via `resolveProposeCapabilities`: no
// `serverTools` → read-only slots with a sendMessage-delegation commit; a newer `contract_version`
// than this build knows → fully read-only (degrade, don't crash). Below all of that sits the MCP
// text `content` fallback.
import * as React from "react";
import type { App } from "@modelcontextprotocol/ext-apps";
import { KNOWN_PROPOSE_CONTRACT_VERSION, type ProposeCardData } from "@yamp/contract";
import {
  createBridgeAdapter,
  IconSparkle,
  isRoundTrippable,
  MealsStepper,
  proposePanelOf,
  proposeSessionFromRequest,
  resolveProposeCapabilities,
  SlotCard,
  VarietyBar,
  useProposeController,
  type ProposeBridge,
  type ProposeControllerResult,
  type ProposeSlotView,
} from "@yamp/ui";

export function ProposeCard({ app, data }: { app: App; data: ProposeCardData }) {
  // The capability posture is FROZEN at first render from the spawning payload + host capabilities
  // (D18 ladder + D19 version gate) — the same one-shot freeze as `initialResult`/`initialSession`.
  // The host re-renders the SAME widget instance on each `ontoolresult`; freezing caps keeps the
  // ladder/version gate consistent with the frozen rendered week (a later payload swap can't quietly
  // re-arm the write path over a plan the first render declared read-only). A payload whose
  // contract_version exceeds this build renders fully read-only.
  const [caps] = React.useState(() => {
    const host = app.getHostCapabilities();
    return resolveProposeCapabilities({
      contractVersion: data.contract_version,
      knownVersion: KNOWN_PROPOSE_CONTRACT_VERSION,
      hostServerTools: host?.serverTools != null,
      hostUpdateModelContext: host?.updateModelContext != null,
      hostMessage: host?.message != null,
      hasPalette: data.palettePresets.length > 0,
      roundTrippable: isRoundTrippable(data.plan),
    });
  });

  // The ext-apps `App` structurally satisfies the bridge (callServerTool / updateModelContext /
  // sendMessage), so no direct SDK plumbing is needed here.
  const [adapter] = React.useState(() =>
    createBridgeAdapter(app as unknown as ProposeBridge, { capabilities: caps }),
  );

  const [initialSession] = React.useState(() => proposeSessionFromRequest(data.request));
  const [initialResult] = React.useState(() => data as unknown as ProposeControllerResult);
  const [openPanel, setOpenPanel] = React.useState<string | null>(null);

  const controller = useProposeController({
    adapter,
    context: {
      vibeLabels: data.vibeLabels,
      nullVibeLabel: (slot) => (slot.reason === "new_for_me" ? "new to you" : "your pick"),
    },
    initialSession,
    initialResult,
    // The spawning payload is already rendered — do not re-query on mount (D19: render-only snapshot).
    iterateOnMount: false,
  });

  const render = controller.result;

  // The empty-palette short-circuit: the op returns a note and no plan.
  if (render?.note && render.plan.length === 0) {
    return (
      <div className="plan-propose-widget" data-widget="plan-propose" data-testid="propose-empty">
        <p className="propose-intro">
          <IconSparkle /> {render.note}
        </p>
      </div>
    );
  }

  const meals = controller.session?.meals ?? { breakfast: 0, lunch: 0, dinner: 0 };

  return (
    <div className="plan-propose-widget" data-widget="plan-propose" data-testid="propose-card">
      {caps.canIterate ? (
        <section className="propose-controls" data-testid="propose-controls">
          <div className="pc-row">
            <MealsStepper meals={meals} onChange={(meal, n) => controller.setMeal(meal, n)} />
          </div>
        </section>
      ) : null}

      <VarietyBar
        nights={controller.summary.filled}
        cuisines={controller.summary.cuisines}
        proteins={controller.summary.proteins}
        proteinHist={controller.summary.proteinHist}
        onCommit={() => void controller.commit()}
        committing={controller.busy || !controller.canCommit}
      />

      <div className="slot-list" data-testid="slot-list" data-stale={controller.busy ? "true" : undefined}>
        {controller.slots.map(({ view }) =>
          caps.canIterate ? (
            <SlotCard
              key={view.key}
              slot={view}
              panel={proposePanelOf(openPanel, view.key)}
              onPanel={(p) => setOpenPanel(p ? `${view.key}|${p}` : null)}
              proteins={data.proteins}
              cuisines={data.cuisines}
              palettePresets={data.palettePresets}
              renderTitle={(_slug, title) => <span className="slot-title">{title}</span>}
              onSwapTo={(slug) => controller.swapTo(view.vibeId, slug)}
              onFacetPick={(kind, value) => controller.pickFacet(view.vibeId, kind, value)}
              onTimePick={(value) => controller.pickTime(view.vibeId, value)}
              onVibeApply={(text) => controller.applyVibe(view.vibeId, text)}
              onVibeReset={() => controller.resetVibe(view.vibeId)}
              onSidesChange={(sides) => controller.editSides(view.vibeId, sides)}
            />
          ) : (
            <ReadOnlySlot key={view.key} slot={view} />
          ),
        )}
      </div>
    </div>
  );
}

/** The degraded slot render (no host tool-proxy / palette-less proposal / unknown-newer payload):
 *  the same card furniture without interactive controls — the visual form of the text fallback. */
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
