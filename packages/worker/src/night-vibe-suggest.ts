// The `suggest_night_vibes` tool + the shared derivation runner (night-vibe-archetype-derivation
// capability). Loads the caller's taste-space (favorited + cooked recipes, their vectors +
// descriptions), clusters + names archetypes (the pure engine + the small-model namer) or
// cold-starts from taste text, then PHRASE-SPACE DEDUPES every candidate — cluster-derived and
// cold-start alike — against the palette, the member's pending + rejected `add_vibe` proposals, and
// candidates kept earlier in the run, and ENQUEUES the survivors as `add_vibe` proposals into the
// per-member reconcile queue (never writing `night_vibes` directly). Before enqueue it also
// CONVERGES the member's already-accumulated pending near-duplicates onto one representative each
// (marking the rest `superseded`), so redundancy heals organically. All the run's embedding work is
// one batched, KV-cached `embedTextsCached` call, so a steady palette re-embeds nothing and derives
// nothing. The scheduled generative reconcile pass reuses `runDerivation` (this module's core).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "./env.js";
import type { Tenant } from "./tenant.js";
import type { AiTrigger } from "./ai.js";
import { runTool } from "./errors.js";
import { loadRecipeIndex, loadRecipeEmbeddings } from "./recipe-index.js";
import type { RecipeIndex } from "./recipes.js";
import { readProfile } from "./profile-db.js";
import { readOverlay } from "./profile-db.js";
import { readCookedDatesByRecipe, readNightVibeVectors, readNightVibes } from "./night-vibe-db.js";
import { deriveArchetypes, type TasteItem, type DerivedArchetype } from "./night-vibe-derive.js";
import { nameCluster, starterVibesFromTaste } from "./night-vibe-naming.js";
import { enqueueProposal, readProposals, supersedeProposals, type PendingProposal } from "./reconcile-db.js";
import { planQueueConvergence, filterCandidates, type PendingVibeProposal } from "./night-vibe-dedupe.js";
import { embedTextsCached } from "./embedding.js";
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
  /** Existing pending near-duplicates converged onto a representative this run (the sweep). */
  superseded: number;
  source: "clusters" | "cold_start" | "none";
}

/**
 * The shared derivation core (used by the tool AND the scheduled pass): assemble the caller's
 * taste-space, derive+name archetypes (or cold-start from taste text when the palette is empty),
 * converge the member's existing pending near-duplicates, phrase-space-dedupe the candidates, and
 * enqueue the survivors as `add_vibe` proposals. Returns what it kept + how many newly enqueued +
 * how many pending rows it superseded. Never writes the palette. `maxSuggestions` caps the enqueue;
 * `seed` makes the clustering reproducible.
 */
export async function runDerivation(
  env: Env,
  tenant: string,
  seed: number,
  maxSuggestions = DEFAULT_MAX_SUGGESTIONS,
  trigger: AiTrigger = "cron",
): Promise<DerivationResult> {
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

  // Enough history → cluster + name; otherwise cold-start from taste text, but ONLY while the
  // palette is empty (D6): a member with a confirmed palette and too little history to cluster is
  // derived nothing rather than re-generating a starter set against a palette they already have.
  let candidates: DerivedArchetype[] = [];
  let source: DerivationResult["source"] = "none";
  if (items.length >= MIN_TASTE_ITEMS) {
    candidates = await deriveArchetypes(items, paletteVectors, seed, { name: (input) => nameCluster(env, input, trigger) }, { maxProposals: maxSuggestions });
    if (candidates.length) source = "clusters";
  }
  if (candidates.length === 0 && existingVibes.length === 0) {
    const starters = await starterVibesFromTaste(env, profile.taste, trigger);
    candidates = starters.slice(0, maxSuggestions).map((s) => ({ id: s.id, vibe: s.vibe, cadence_days: null, evidence: { member_slugs: [], size: 0 } }));
    if (candidates.length) source = "cold_start";
  }

  // Load the member's pending + rejected `add_vibe` proposals — the phrase-space dedup basis (D3).
  const [pendingRows, rejectedRows] = await Promise.all([
    readProposals(env, tenant, "pending"),
    readProposals(env, tenant, "rejected"),
  ]);
  const vibePhrase = (p: PendingProposal): string | null =>
    p.kind === "add_vibe" && typeof p.payload.vibe === "string" && p.payload.vibe.trim() ? p.payload.vibe : null;
  const pendingVibes: PendingVibeProposal[] = pendingRows
    .map((p) => ({ p, vibe: vibePhrase(p) }))
    .filter((x): x is { p: PendingProposal; vibe: string } => x.vibe !== null)
    .map(({ p, vibe }) => ({ id: p.id, vibe, created_at: p.created_at }));
  const rejectedPhrases = rejectedRows.map(vibePhrase).filter((v): v is string => v !== null);
  // Palette vibes not yet reconciled into `night_vibe_derived` (the confirm→derive race) — embed
  // their phrase this pass so a just-confirmed vibe still dedupes.
  const missingPaletteVibes = existingVibes.filter((v) => !paletteVecs.has(v.id) && typeof v.vibe === "string" && v.vibe.trim());

  // ONE batched, KV-cached embed over every phrase we need a vector for (D3): pending + rejected +
  // candidate phrases + any missing-palette phrase. Steady state re-embeds nothing.
  const toEmbed = [
    ...new Set([
      ...pendingVibes.map((p) => p.vibe),
      ...rejectedPhrases,
      ...candidates.map((c) => c.vibe),
      ...missingPaletteVibes.map((v) => v.vibe),
    ]),
  ];
  const embedded = toEmbed.length ? await embedTextsCached(env, { activity: "embed-nightvibe", trigger }, toEmbed) : [];
  const vecOf = new Map<string, number[]>();
  toEmbed.forEach((t, i) => vecOf.set(t, embedded[i]));

  // Palette basis = stored palette phrase vectors ∪ freshly-embedded missing-palette phrases.
  const paletteBasis = [...paletteVecs.values(), ...missingPaletteVibes.map((v) => vecOf.get(v.vibe)!)];
  const rejectedVecs = rejectedPhrases.map((p) => vecOf.get(p)!);

  // Converge the accumulated pending queue (D4): supersede near-dups onto the earliest representative
  // of each group. Runs even when no new candidates survive — convergence can't depend on new material.
  const plan = planQueueConvergence(pendingVibes, { paletteVecs: paletteBasis, rejectedVecs }, vecOf);
  const superseded = await supersedeProposals(env, tenant, plan.superseded.map((s) => s.id), nowIso);

  // Filter candidates against palette ∪ rejected ∪ surviving pending representatives ∪ kept-in-run (D1).
  const repVecs = plan.representatives.map((r) => vecOf.get(r.vibe)!).filter((v): v is number[] => Array.isArray(v));
  const basisVecs = [...paletteBasis, ...rejectedVecs, ...repVecs];
  const kept = filterCandidates(candidates, basisVecs, vecOf);

  // Enqueue each survivor as an add_vibe proposal (skip ones whose id already names a palette vibe;
  // the queue's stable id makes re-drafting idempotent).
  let enqueued = 0;
  for (const c of kept) {
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

  return { candidates: kept, enqueued, superseded, source };
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
    let superseded = 0;
    for (const tenant of tenants) {
      const r = await runDerivation(env, tenant, seed, DEFAULT_MAX_SUGGESTIONS);
      enqueued += r.enqueued;
      superseded += r.superseded;
    }
    const summary = { members: tenants.length, enqueued, superseded };
    await writeJobHealth(env, "archetype-derive", { ok: true, last_run_at: startedAt, summary });
    await writeJobRun(env, "archetype-derive", { ok: true, ran_at: startedAt, duration_ms: now() - startedAt, summary });
    recordUsagePoint(env, "archetype-derive", { ok: true, durationMs: now() - startedAt, counts: [tenants.length, enqueued, superseded] });
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
        "Derive candidate NIGHT VIBES for the caller from what they actually like and cook — cluster their favorites + cook history into archetypes, name each (a small model), infer a cadence from the observed cook interval, and drop any near-duplicate of a palette vibe, a pending or rejected suggestion, or another candidate this run (phrase-space dedup). With too little history AND an empty palette, falls back to starter vibes from their taste notes; a member who already has a palette but too little history to cluster is derived nothing (source `none`). Each surviving candidate is ENQUEUED as an `add_vibe` proposal the caller confirms via confirm_proposal — this tool NEVER writes the palette. It also converges the caller's already-accumulated pending near-duplicates onto one suggestion each (the rest resolved `superseded`, dropped from the queue). Use at onboarding to seed an empty palette, or any time to grow it. Returns { candidates, enqueued, superseded, source }.",
      inputSchema: {
        max_suggestions: z.number().int().positive().max(8).optional(),
        seed: z.number().int().optional(),
      },
    },
    ({ max_suggestions, seed }) =>
      runTool(async () => {
        const resolvedSeed = seed ?? Number(new Date().toISOString().slice(0, 10).replace(/-/g, ""));
        const result = await runDerivation(env, tenant.id, resolvedSeed, max_suggestions ?? DEFAULT_MAX_SUGGESTIONS, "request");
        const note =
          result.source === "none"
            ? "no taste-space to derive from yet — cook a few meals or favorite some recipes, then try again"
            : undefined;
        return note ? { ...result, note } : result;
      }),
  );
}
