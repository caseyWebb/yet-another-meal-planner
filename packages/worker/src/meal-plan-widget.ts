// The bespoke in-chat meal-plan proposal card (meal-plan-widget): the `display_meal_plan` MCP
// tool and the `ui://plan/propose` MCP Apps resource it references — the propose twin of the
// recipe-card widget (recipe-card-widget.ts), cloning the same canonical ext-apps `App`-client
// bridge, no capability gating, and the widget HTML served over `resources/read` (no new HTTP
// route). It reuses the SHARED planner operation `runProposeMealPlan` (the same op the plain
// `propose_meal_plan` tool and the member app's `POST /api/propose` call), so the three surfaces
// stay one contract; it does NOT alter `propose_meal_plan`.
//
// The single self-contained widget HTML is built by `packages/widgets` into the Worker's merged
// static-assets root (`assets/widgets/plan-propose.html`) and read at runtime through the
// `ASSETS` binding. Because `wrangler.jsonc` sets `not_found_handling: "single-page-application"`,
// an unknown asset path resolves to the member SPA shell (index.html), so the read ASSERTS the
// widget's marker and fails structurally rather than serving the wrong document.
//
// Widget-initiated iteration (the dials: nights / variety / lock / swap / exclude / per-slot vibe
// / re-roll) re-invokes the STATELESS propose op client-side via the ext-apps `App.callServerTool`
// (proxied by the host straight to `propose_meal_plan` — no frontier-model turn), degrading to the
// text `content` fallback on a host without that capability. See docs/TOOLS.md.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import type { ProposeCardData, ProposeCardRequestSlot } from "@yamp/contract";
import type { Env } from "./env.js";
import type { Tenant } from "./tenant.js";
import { ToolError, fail } from "./errors.js";
import {
  runProposeMealPlan,
  PROPOSE_INPUT_SHAPE,
  type ProposeDeps,
  type ProposeInput,
  type ProposeResult,
} from "./meal-plan-proposal-tool.js";
import { readNightVibes } from "./night-vibe-db.js";
import { loadRecipeIndex } from "./recipe-index.js";

/** The `ui://` resource the widget is served from; `display_meal_plan._meta.ui.resourceUri` equals this. */
export const PLAN_PROPOSE_URI = "ui://plan/propose";

/** Where `packages/widgets` emits the built single-file HTML inside the merged assets root. */
const WIDGET_ASSET_URL = "https://assets.local/widgets/plan-propose.html";

/** A stable string the built widget HTML carries (a `<meta>` marker in the shell). The ASSETS
 *  read asserts it so the SPA-fallback document (served for an unknown asset path) is detected
 *  rather than mistaken for the widget. */
export const WIDGET_MARKER = "plan-propose-widget";

/** The default adventurousness the widget shows when the caller passes no `nudges.variety` — the
 *  member app's `defaultSession` value, so the dial's opening position matches that surface. */
const DEFAULT_VARIETY = 0.4;

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/** Map the caller's propose input onto the widget's replayable request (the palette-flow subset
 *  the member app's client session serializes: nights / seed / variety / proteins / freeform /
 *  exclude / slots). Iteration replays an adjusted copy of THIS against the stateless op. */
function toRequest(input: ProposeInput, result: ProposeResult): ProposeCardData["request"] {
  const slots: ProposeCardRequestSlot[] = (input.slots ?? []).map((s) => {
    const out: ProposeCardRequestSlot = { vibe_id: s.vibe_id };
    if (s.protein !== undefined) out.protein = s.protein;
    if (s.cuisine !== undefined) out.cuisine = s.cuisine;
    if (s.max_time_total !== undefined) out.max_time_total = s.max_time_total;
    if (s.vibe !== undefined) out.vibe = s.vibe;
    if (s.recipe !== undefined) out.recipe = s.recipe;
    return out;
  });
  return {
    // The op resolves the effective nights/seed into diagnostics — seed the session from those so
    // a re-roll (seed + 1) and the nights stepper start from the exact week the caller sees.
    nights: result.diagnostics.nights,
    seed: result.diagnostics.seed,
    variety: input.nudges?.variety ?? DEFAULT_VARIETY,
    proteins: input.nudges?.proteins ?? [],
    freeform: input.nudges?.freeform ?? "",
    exclude: input.exclude ?? [],
    slots,
  };
}

/** Assemble the widget payload: the propose result + the render context its dials need (vibe
 *  labels, palette presets, and the corpus protein/cuisine facet universes). The op already loads
 *  the palette + index internally; re-reading them here (cheap, cron-projected) keeps this off the
 *  op's return contract. */
async function toProposeCardData(env: Env, tenant: Tenant, input: ProposeInput, result: ProposeResult): Promise<ProposeCardData> {
  const [palette, index] = await Promise.all([
    readNightVibes(env, tenant.id).catch(() => []),
    loadRecipeIndex(env).catch(() => ({})),
  ]);
  const vibeLabels: Record<string, string> = {};
  for (const v of palette) vibeLabels[v.id] = v.vibe;
  // Ephemeral-authored slots carry synthetic `ephemeral-N` ids (N = index into the non-blank
  // ephemeral set, mirroring the op's minting) — label them with the authored phrase so the card
  // and the text fallback render the vibe, not the raw `ephemeral-N` id.
  (input.ephemeral_vibes ?? [])
    .filter((e) => typeof e.vibe === "string" && e.vibe.trim())
    .forEach((e, i) => {
      vibeLabels[`ephemeral-${i}`] = e.vibe.trim();
    });
  const rows = Object.values(index);
  const proteins = [...new Set(rows.map((r) => str((r as Record<string, unknown>).protein)).filter((p): p is string => !!p))].sort();
  const cuisines = [...new Set(rows.map((r) => str((r as Record<string, unknown>).cuisine)).filter((c): c is string => !!c))].sort();
  return {
    plan: result.plan,
    variety: result.variety,
    uncovered_at_risk: result.uncovered_at_risk,
    diagnostics: result.diagnostics,
    note: result.note,
    request: toRequest(input, result),
    vibeLabels,
    palettePresets: palette.map((v) => v.vibe),
    proteins,
    cuisines,
  };
}

/** A plain-text rendering of the proposed week — the `content` fallback for hosts that cannot
 *  render the widget. Lists each proposed night (vibe → main + facets), its why/sides, then the
 *  variety summary and any uncovered at-risk items. */
export function toTextFallback(data: ProposeCardData): string {
  if (data.note) return data.note;
  const lines: string[] = [];
  let n = 0;
  for (const slot of data.plan) {
    if (slot.vibe_id === null && slot.reason !== "locked" && slot.reason !== "new_for_me") continue;
    n += 1;
    const label = slot.vibe_id ? (data.vibeLabels[slot.vibe_id] ?? slot.vibe_id) : slot.reason === "new_for_me" ? "new to you" : "your pick";
    if (!slot.main) {
      lines.push(`${n}. ${label} — (no recipe: ${slot.empty_reason ?? "over-constrained"})`);
      continue;
    }
    const facets = [slot.main.protein, slot.main.cuisine].filter((x): x is string => !!x);
    if (slot.main.time_total != null) facets.push(`${slot.main.time_total} min`);
    const head = `${n}. ${label} — ${slot.main.title}${facets.length ? ` (${facets.join(" · ")})` : ""}`;
    lines.push(head);
    if (slot.why.length) lines.push(`   ${slot.why.join("; ")}`);
    if (slot.sides.length) lines.push(`   sides: ${slot.sides.map((s) => s.title).join(", ")}`);
  }
  if (lines.length === 0) lines.push("No nights could be proposed for this week.");
  const v = data.variety;
  lines.push("", `Variety: ${data.diagnostics.filled} night${data.diagnostics.filled === 1 ? "" : "s"}, ${v.distinct_cuisines} cuisines, ${v.distinct_proteins} proteins.`);
  if (data.uncovered_at_risk.length) lines.push(`Still going bad (not used): ${data.uncovered_at_risk.join(", ")}.`);
  return lines.join("\n");
}

/**
 * Register the meal-plan proposal widget onto `server`: the `ui://plan/propose` resource and the
 * `display_meal_plan` tool. `deps` are the shared propose closures (`buildServer` binds env +
 * tenant); `env` backs the resource's ASSETS read. No capability gating — `_meta.ui.resourceUri`
 * is returned UNCONDITIONALLY (the pinned SDK's capability probe is unreliable), and the text
 * `content` fallback keeps a non-rendering host readable.
 */
export function registerMealPlanWidget(server: McpServer, env: Env, tenant: Tenant, deps: ProposeDeps): void {
  registerAppResource(
    server,
    "Meal Plan Proposal",
    PLAN_PROPOSE_URI,
    { description: "The bespoke in-chat meal-plan proposal card: one night per vibe with lock / swap / exclude / per-slot vibe dials that re-plan without a model turn." },
    async () => {
      const res = await env.ASSETS.fetch(new Request(WIDGET_ASSET_URL));
      if (!res.ok) {
        throw new ToolError("not_found", `plan propose widget asset is unavailable (status ${res.status})`);
      }
      const html = await res.text();
      // The SPA-fallback shell (not_found_handling) also returns 200; the marker distinguishes
      // the real widget document from that shell.
      if (!html.includes(WIDGET_MARKER)) {
        throw new ToolError("not_found", "plan propose widget asset not found (received the SPA shell)");
      }
      return { contents: [{ uri: PLAN_PROPOSE_URI, mimeType: RESOURCE_MIME_TYPE, text: html }] };
    },
  );

  registerAppTool(
    server,
    "display_meal_plan",
    {
      title: "Display meal plan proposal",
      description:
        "Propose a week of dinners from the caller's night-vibe palette AND render it as an inline, interactive planning card in the conversation — the widget twin of propose_meal_plan (same stateless planner, same request shape). Use this when the member wants to SEE and TWEAK a proposed week; use propose_meal_plan when you only need the data to reason over, and read_meal_plan to read the already-saved plan. Takes the same input as propose_meal_plan (nights, seed, lock, exclude, boost_ingredients, nudges, slots, ephemeral_vibes, new_for_me). Returns a widget-bearing result: `_meta.ui.resourceUri` points at the ui://plan/propose view, `structuredContent` carries the proposed slots (mains/alternates/sides/why/flags), variety, uncovered-at-risk, diagnostics, plus the palette + facet context the card's dials need, and `content` is a plain-text rendering of the proposed nights that hosts which cannot render the widget fall back to. The card's dials (nights / variety / lock / swap / exclude / per-slot vibe / re-roll) re-run the stateless proposal client-side, so refinement costs no additional model turn. NO writes — persist a chosen week with update_meal_plan. An empty palette with no ephemeral set returns a `note` and an empty plan (not an error); genuine failures return a structured error, never thrown.",
      inputSchema: PROPOSE_INPUT_SHAPE,
      _meta: { ui: { resourceUri: PLAN_PROPOSE_URI } },
    },
    async (input) => {
      try {
        const result = await runProposeMealPlan(env, tenant, input as ProposeInput, deps);
        const data = await toProposeCardData(env, tenant, input as ProposeInput, result);
        return {
          _meta: { ui: { resourceUri: PLAN_PROPOSE_URI } },
          structuredContent: data,
          content: [{ type: "text", text: toTextFallback(data) }],
        };
      } catch (e) {
        if (e instanceof ToolError) return fail(e.toShape());
        const message = e instanceof Error ? e.message : String(e);
        return fail({ error: "upstream_unavailable", message });
      }
    },
  );
}
