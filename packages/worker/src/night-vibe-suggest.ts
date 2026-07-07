// The `suggest_night_vibes` tool + the shared derivation runner (night-vibe-archetype-derivation
// capability). Loads the caller's taste-space (favorited + cooked recipes, their vectors +
// descriptions), clusters + names archetypes (the pure engine + the small-model namer), dedupes
// against the existing palette, and ENQUEUES the survivors as `add_vibe` proposals into the
// per-member reconcile queue — never writing `night_vibes` directly. Falls back to taste-text
// starter vibes when there's too little history to cluster. The scheduled generative reconcile
// pass reuses `runDerivation` (this module's core) under a per-run cap.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "./env.js";
import type { Tenant } from "./tenant.js";
import { runTool } from "./errors.js";
import { loadRecipeIndex, loadRecipeEmbeddings } from "./recipe-index.js";
import type { RecipeIndex } from "./recipes.js";
import { readProfile } from "./profile-db.js";
import { readOverlay } from "./profile-db.js";
import { readCookedDatesByRecipe, readNightVibeVectors, readNightVibes } from "./night-vibe-db.js";
import { deriveArchetypes, type TasteItem, type DerivedArchetype } from "./night-vibe-derive.js";
import { nameCluster, starterVibesFromTaste } from "./night-vibe-naming.js";
import { enqueueProposal } from "./reconcile-db.js";
import type { ProposalDraft } from "./reconcile-signals.js";
import { directoryFromEnv } from "./tenant.js";
import { writeJobHealth, writeJobRun, readJobHealth, recordUsagePoint, notifyFailure } from "./health.js";

/** Below this many taste-space recipes, cluster naming is too noisy — use the taste-text cold start. */
const MIN_TASTE_ITEMS = 4;
/** Default cap on new archetype proposals per run, so a member is never flooded. */
export const DEFAULT_MAX_SUGGESTIONS = 4;

export interface DerivationResult {
  candidates: DerivedArchetype[];
  enqueued: number;
  source: "clusters" | "cold_start" | "none";
}

/**
 * The shared derivation core (used by the tool AND the scheduled pass): assemble the caller's
 * taste-space, derive+name+dedupe archetypes (or cold-start from taste text), and enqueue each as
 * an `add_vibe` proposal. Returns what it derived + how many newly enqueued. Never writes the
 * palette. `maxSuggestions` caps the enqueue; `seed` makes the clustering reproducible.
 */
export async function runDerivation(env: Env, tenant: string, seed: number, maxSuggestions = DEFAULT_MAX_SUGGESTIONS): Promise<DerivationResult> {
  const [index, embeddings, overlay, cookedDates, paletteVecs, existingVibes, profile] = await Promise.all([
    loadRecipeIndex(env).catch(() => ({}) as RecipeIndex),
    loadRecipeEmbeddings(env),
    readOverlay(env, tenant),
    readCookedDatesByRecipe(env, tenant),
    readNightVibeVectors(env, tenant),
    readNightVibes(env, tenant),
    readProfile(env, tenant),
  ]);

  // Taste-space = the caller's favorites ∪ the recipes they've cooked, that are embedded.
  const slugs = new Set<string>();
  for (const [slug, row] of Object.entries(overlay)) if (row?.favorite) slugs.add(slug);
  for (const slug of cookedDates.keys()) slugs.add(slug);

  const items: TasteItem[] = [];
  for (const slug of slugs) {
    const embedding = embeddings.get(slug);
    if (!embedding) continue; // unembedded → not yet part of the taste-space
    const fm = (index[slug]?.frontmatter ?? {}) as Record<string, unknown>;
    items.push({
      slug,
      embedding,
      cookDates: cookedDates.get(slug),
      description: typeof fm.description === "string" ? fm.description : undefined,
    });
  }

  const paletteVectors = [...paletteVecs.values()];
  const existingIds = new Set(existingVibes.map((v) => v.id));
  const nowIso = new Date().toISOString();

  // Enough history → cluster + name; otherwise cold-start from taste text.
  let candidates: DerivedArchetype[] = [];
  let source: DerivationResult["source"] = "none";
  if (items.length >= MIN_TASTE_ITEMS) {
    candidates = await deriveArchetypes(items, paletteVectors, seed, { name: (input) => nameCluster(env, input) }, { maxProposals: maxSuggestions });
    if (candidates.length) source = "clusters";
  }
  if (candidates.length === 0) {
    const starters = await starterVibesFromTaste(env, profile.taste);
    candidates = starters.slice(0, maxSuggestions).map((s) => ({ id: s.id, vibe: s.vibe, cadence_days: null, evidence: { member_slugs: [], size: 0 } }));
    if (candidates.length) source = "cold_start";
  }

  // Enqueue each as an add_vibe proposal (skip ones whose id already names a palette vibe).
  let enqueued = 0;
  for (const c of candidates) {
    if (existingIds.has(c.id)) continue;
    const draft: ProposalDraft = {
      kind: "add_vibe",
      target: c.id,
      payload: {
        id: c.id,
        vibe: c.vibe,
        cadence_days: c.cadence_days,
        ...(c.weather_affinity ? { weather_affinity: c.weather_affinity } : {}),
      },
      rationale: rationaleFor(c, source),
      evidence: c.evidence,
    };
    const { inserted } = await enqueueProposal(env, tenant, draft, "edge", nowIso);
    if (inserted) enqueued++;
  }

  return { candidates, enqueued, source };
}

/** The generative reconcile pass runs at most this often — the naming step spends `env.AI`, and
 *  the dedup makes steady state a no-op, so once a day is plenty to catch a new archetype.
 *  Exported: the member API's suggest endpoint gates on the SAME constant (D7). */
export const DERIVE_INTERVAL_MS = 20 * 60 * 60 * 1000;

/**
 * The scheduled generative reconcile producer (the `edge` producer of profile-reconciliation).
 * For every member, derive+name+dedupe archetypes and enqueue new `add_vibe` proposals (bounded
 * by `DEFAULT_MAX_SUGGESTIONS` per member). Self-gated to ~daily via its own `job_health` stamp,
 * because naming spends `env.AI` and a steady palette derives nothing anyway. Records health like
 * the other background jobs; rethrows on a hard failure so the cron surface reflects it.
 */
export async function runArchetypeDerivationJob(env: Env, now: () => number = () => Date.now()): Promise<void> {
  const startedAt = now();
  // Self-gate: skip (without touching health) if we SUCCEEDED within the interval, so a frequent
  // cron tick doesn't re-spend the naming model. Gating on `ok` (not just recency) means a failed
  // pass isn't starved for the interval — it retries on the next tick, like the other jobs.
  const last = await readJobHealth(env, "archetype-derive").catch(() => null);
  if (last && last.ok && startedAt - last.last_run_at < DERIVE_INTERVAL_MS) return;

  try {
    const tenants = await directoryFromEnv(env).list();
    const seed = Number(new Date(startedAt).toISOString().slice(0, 10).replace(/-/g, ""));
    let enqueued = 0;
    for (const tenant of tenants) {
      const r = await runDerivation(env, tenant, seed, DEFAULT_MAX_SUGGESTIONS);
      enqueued += r.enqueued;
    }
    const summary = { members: tenants.length, enqueued };
    await writeJobHealth(env, "archetype-derive", { ok: true, last_run_at: startedAt, summary });
    await writeJobRun(env, "archetype-derive", { ok: true, ran_at: startedAt, duration_ms: now() - startedAt, summary });
    recordUsagePoint(env, "archetype-derive", { ok: true, durationMs: now() - startedAt, counts: [tenants.length, enqueued] });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[archetype-derive] failed:", msg);
    await writeJobHealth(env, "archetype-derive", { ok: false, last_run_at: startedAt, summary: { error: msg } }).catch(() => {});
    await writeJobRun(env, "archetype-derive", { ok: false, ran_at: startedAt, duration_ms: now() - startedAt, summary: { error: msg } });
    recordUsagePoint(env, "archetype-derive", { ok: false, durationMs: now() - startedAt });
    await notifyFailure(env, "archetype-derive", msg);
    throw e;
  }
}

function rationaleFor(c: DerivedArchetype, source: DerivationResult["source"]): string {
  if (source === "cold_start") return `Based on your taste notes — add “${c.vibe}” to your rotation?`;
  const cadence = c.cadence_days ? ` (about every ${c.cadence_days} days)` : "";
  return `You keep cooking dishes like this${cadence} — add “${c.vibe}” to your rotation so a night is set aside for it?`;
}

export function registerSuggestNightVibesTool(server: McpServer, env: Env, tenant: Tenant): void {
  server.registerTool(
    "suggest_night_vibes",
    {
      description:
        "Derive candidate NIGHT VIBES for the caller from what they actually like and cook — cluster their favorites + cook history into archetypes, name each (a small model), infer a cadence from the observed cook interval, and drop any already covered by their palette. With too little history, falls back to starter vibes from their taste notes. Each candidate is ENQUEUED as an `add_vibe` proposal the caller confirms via confirm_proposal — this tool NEVER writes the palette. Use at onboarding to seed an empty palette, or any time to grow it. Returns { candidates, enqueued, source }.",
      inputSchema: {
        max_suggestions: z.number().int().positive().max(8).optional(),
        seed: z.number().int().optional(),
      },
    },
    ({ max_suggestions, seed }) =>
      runTool(async () => {
        const resolvedSeed = seed ?? Number(new Date().toISOString().slice(0, 10).replace(/-/g, ""));
        const result = await runDerivation(env, tenant.id, resolvedSeed, max_suggestions ?? DEFAULT_MAX_SUGGESTIONS);
        const note =
          result.source === "none"
            ? "no taste-space to derive from yet — cook a few meals or favorite some recipes, then try again"
            : undefined;
        return note ? { ...result, note } : result;
      }),
  );
}
