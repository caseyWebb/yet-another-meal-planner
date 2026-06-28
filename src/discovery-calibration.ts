// Discovery calibration (discovery-calibration-console change). Three concerns
// grouped here so discovery-sweep.ts stays pure orchestration:
//
//   1. loadDiscoveryConfig(env)   — read the D1 sparse override + merge over DEFAULT_CONFIG
//   2. analyzeThresholds(...)     — cheap no-AI δ/τ readout over the live corpus + members
//   3. buildDryRunDeps(env)       — no-write deps for a full-pipeline preview
//   4. validateDiscoveryConfig(…) — server-side footgun guard on config writes
//
// None of these need env.AI or feed fetches; the first three are pure arithmetic over data
// already in D1/R2. The footgun guard is enforced here (not only in the UI) so a direct
// API call cannot bypass it.

import { cosineSimilarity } from "./embedding.js";
import { db } from "./db.js";
import { ToolError } from "./errors.js";
import { loadRecipeEmbeddings } from "./recipe-index.js";
import { directoryFromEnv } from "./tenant.js";
import { readOverlay, readProfile } from "./profile-db.js";
import { readTasteVectors } from "./taste-vector.js";
import {
  DEFAULT_CONFIG,
  bestTasteCosine,
  type DiscoveryConfig,
  type DiscoveryDeps,
  type SweepMember,
  type LogEntry,
  type Attribution,
} from "./discovery-sweep.js";
import type { Env } from "./env.js";

// --- 1. Config loader --------------------------------------------------------

/** D1 row shape for discovery_config (all nullable sparse overrides). */
interface DiscoveryConfigRow {
  taste_threshold: number | null;
  triage_threshold: number | null;
  dedup_threshold: number | null;
  classify_max: number | null;
  rate_cap: number | null;
}

/** Validate a numeric knob from the D1 row: returns null (→ use default) when absent/invalid. */
function validatedKnob(value: number | null | undefined, check: (n: number) => boolean): number | null {
  if (value == null || typeof value !== "number" || !isFinite(value) || !check(value)) return null;
  return value;
}

/**
 * Read the operator's `discovery_config` sparse override from D1 and merge it over
 * `DEFAULT_CONFIG`. An absent row, a null column, or an out-of-range value all fall back
 * to the default — the table only records intentional operator deltas. Type/range-validated
 * defensively on read so a malformed row can never produce a nonsensical config.
 */
export async function loadDiscoveryConfig(env: Env): Promise<DiscoveryConfig> {
  const row = await db(env).first<DiscoveryConfigRow>(
    "SELECT taste_threshold, triage_threshold, dedup_threshold, classify_max, rate_cap FROM discovery_config WHERE id = 1",
  );
  if (!row) return { ...DEFAULT_CONFIG };
  return {
    tasteThreshold: validatedKnob(row.taste_threshold, (n) => n > 0 && n <= 1) ?? DEFAULT_CONFIG.tasteThreshold,
    triageThreshold: validatedKnob(row.triage_threshold, (n) => n > 0 && n <= 1) ?? DEFAULT_CONFIG.triageThreshold,
    dedupThreshold: validatedKnob(row.dedup_threshold, (n) => n > 0 && n <= 1) ?? DEFAULT_CONFIG.dedupThreshold,
    classifyMaxPerTick: validatedKnob(row.classify_max, (n) => n > 0 && Number.isInteger(n)) ?? DEFAULT_CONFIG.classifyMaxPerTick,
    rateCap: validatedKnob(row.rate_cap, (n) => n > 0 && Number.isInteger(n)) ?? DEFAULT_CONFIG.rateCap,
    // Subrequest-budget safety bounds, not operator-tunable matching knobs — no D1 column;
    // always the compiled default. (The calibration console tunes match quality, not budgets.)
    fetchMaxPerTick: DEFAULT_CONFIG.fetchMaxPerTick,
    maxCandidatesPerTick: DEFAULT_CONFIG.maxCandidatesPerTick,
    retryBackoffMinutes: DEFAULT_CONFIG.retryBackoffMinutes,
    retryMaxAttempts: DEFAULT_CONFIG.retryMaxAttempts,
    retryFetchMaxPerTick: DEFAULT_CONFIG.retryFetchMaxPerTick,
  };
}

/** Write operator knob overrides to discovery_config (upsert; only sets non-null fields). */
export async function saveDiscoveryConfig(env: Env, patch: Partial<DiscoveryConfig>): Promise<void> {
  // Read the existing row so we do a true merge (don't overwrite already-set knobs with null).
  const existing = await db(env).first<DiscoveryConfigRow>(
    "SELECT taste_threshold, triage_threshold, dedup_threshold, classify_max, rate_cap FROM discovery_config WHERE id = 1",
  );
  const merged = {
    taste_threshold: patch.tasteThreshold ?? existing?.taste_threshold ?? null,
    triage_threshold: patch.triageThreshold ?? existing?.triage_threshold ?? null,
    dedup_threshold: patch.dedupThreshold ?? existing?.dedup_threshold ?? null,
    classify_max: patch.classifyMaxPerTick ?? existing?.classify_max ?? null,
    rate_cap: patch.rateCap ?? existing?.rate_cap ?? null,
  };
  await db(env).run(
    "INSERT INTO discovery_config (id, taste_threshold, triage_threshold, dedup_threshold, classify_max, rate_cap) " +
      "VALUES (1, ?1, ?2, ?3, ?4, ?5) " +
      "ON CONFLICT(id) DO UPDATE SET " +
      "taste_threshold = excluded.taste_threshold, triage_threshold = excluded.triage_threshold, " +
      "dedup_threshold = excluded.dedup_threshold, classify_max = excluded.classify_max, rate_cap = excluded.rate_cap",
    merged.taste_threshold,
    merged.triage_threshold,
    merged.dedup_threshold,
    merged.classify_max,
    merged.rate_cap,
  );
}

// --- 2. Cheap analyze (no AI, no feeds) -------------------------------------

/** Per-member τ analysis result. */
export interface MemberTauResult {
  tenant: string;
  matchCount: number;
  /** True when this member has no favorites and no taste vector (pure cold-start). */
  coldStart: boolean;
}

/** How many top-cosine pairs to surface in the δ histogram. */
const DELTA_SAMPLE_SIZE = 20;

/** Max corpus recipes to include in the pairwise δ analysis before bounding (O(n²)). */
const DELTA_MAX_CORPUS = 500;

export interface AnalyzeResult {
  /** How many corpus recipe PAIRS have cosine ≥ δ (would collapse as near-dups). */
  deltaPairCount: number;
  /** A sample of the highest pairwise cosines (slug pairs + cosine), for histogram/gap view. */
  deltaTopPairs: Array<{ slugA: string; slugB: string; cosine: number }>;
  /** Whether the pairwise analysis was bounded (corpus too large for full O(n²)). */
  deltaBounded: boolean;
  /** How many corpus items were included in the δ analysis (≤ DELTA_MAX_CORPUS). */
  deltaCorpusSize: number;
  /** Per-member τ match counts. */
  memberTau: MemberTauResult[];
}

/**
 * Pure computation of the analyze result from already-loaded corpus + members.
 * Exported for unit tests (no env needed — inject in-memory vectors directly).
 */
export function computeAnalysis(
  corpusEntries: Array<[string, number[]]>,
  members: SweepMember[],
  config: DiscoveryConfig,
): AnalyzeResult {
  const isBounded = corpusEntries.length > DELTA_MAX_CORPUS;
  const sample = isBounded ? corpusEntries.slice(0, DELTA_MAX_CORPUS) : corpusEntries;

  // δ analysis: pairwise cosine over the sampled corpus.
  let deltaPairCount = 0;
  const topPairs: Array<{ slugA: string; slugB: string; cosine: number }> = [];
  for (let i = 0; i < sample.length; i++) {
    const [slugA, vecA] = sample[i];
    for (let j = i + 1; j < sample.length; j++) {
      const [slugB, vecB] = sample[j];
      const c = cosineSimilarity(vecA, vecB);
      if (c >= config.dedupThreshold) deltaPairCount++;
      topPairs.push({ slugA, slugB, cosine: c });
    }
  }
  topPairs.sort((a, b) => b.cosine - a.cosine);
  const deltaTopPairs = topPairs.slice(0, DELTA_SAMPLE_SIZE);

  // τ analysis: per-member count of corpus recipes clearing the taste threshold.
  const corpus = sample.map(([slug, vector]) => ({ slug, vector }));
  const memberTau: MemberTauResult[] = members.map((m) => {
    const coldStart = m.favoriteVectors.length === 0 && m.tasteVector === null;
    let matchCount = 0;
    for (const { vector } of corpus) {
      if (bestTasteCosine(vector, m) >= config.tasteThreshold) matchCount++;
    }
    return { tenant: m.tenant, matchCount, coldStart };
  });

  return {
    deltaPairCount,
    deltaTopPairs,
    deltaBounded: isBounded,
    deltaCorpusSize: sample.length,
    memberTau,
  };
}

/**
 * Cheap threshold analysis over the live corpus and members — no AI, no feed fetches.
 * δ: pairwise cosine over the recipe_derived embeddings (count pairs ≥ δ; sample top pairs).
 * τ: per member, count corpus recipes that match (bestTasteCosine ≥ τ).
 * Bounded for large corpora (reports bounded=true rather than silently partial).
 */
export async function analyzeThresholds(env: Env, config: DiscoveryConfig): Promise<AnalyzeResult> {
  const [corpusMap, tasteVecs] = await Promise.all([loadRecipeEmbeddings(env), readTasteVectors(env)]);
  const directory = directoryFromEnv(env);
  const tenants = await directory.list();

  // Load member taste signals (no AI — same pattern as buildDiscoveryDeps.loadMembers).
  const members: SweepMember[] = [];
  for (const tenant of tenants) {
    const [overlay] = await Promise.all([readOverlay(env, tenant), readProfile(env, tenant)]);
    const favoriteVectors: number[][] = [];
    const rejectVectors: number[][] = [];
    for (const [slug, o] of Object.entries(overlay)) {
      const v = corpusMap.get(slug);
      if (!v) continue;
      if (o.favorite) favoriteVectors.push(v);
      if (o.reject) rejectVectors.push(v);
    }
    members.push({
      tenant,
      tasteVector: tasteVecs.get(tenant) ?? null,
      favoriteVectors,
      rejectVectors,
      dietary: [],
    });
  }

  return computeAnalysis([...corpusMap.entries()], members, config);
}

// --- 3. Deep dry-run (no writes) — discharges discovery-sweep 10.3 ----------

/** Captured per-candidate outcome from a dry run. */
export interface DryRunOutcome {
  url: string;
  title: string;
  source: string;
  outcome: string;
  slug?: string;
  detail?: Record<string, unknown>;
  wouldMatchMembers?: string[];
}

/** The return from buildDryRunDeps — run the sweep then call capturedOutcomes(). */
export interface DryRunDeps {
  deps: DiscoveryDeps;
  capturedOutcomes: () => DryRunOutcome[];
}

/**
 * Build a no-write dependency set that mirrors `buildDiscoveryDeps` but captures every
 * would-be outcome in memory instead of writing R2/D1. `runDiscoverySweep` is called
 * verbatim against these deps — the full pipeline exercises unchanged — and the captured
 * outcomes are the dry-run result. Nothing is written.
 */
export function buildDryRunDeps(realDeps: DiscoveryDeps): DryRunDeps {
  const outcomes: DryRunOutcome[] = [];
  const importedSlugs = new Map<string, number[]>(); // slug → descVec (for intra-sweep L3 dedup)

  const deps: DiscoveryDeps = {
    loadCandidates: () => realDeps.loadCandidates(),
    loadMembers: () => realDeps.loadMembers(),
    loadCorpusVectors: () => realDeps.loadCorpusVectors(),
    embed: (text) => realDeps.embed(text),
    embedMany: (texts) => realDeps.embedMany(texts),
    acquireContent: (c) => realDeps.acquireContent(c),
    classify: (content, source) => realDeps.classify(content, source),
    describe: (frontmatter) => realDeps.describe(frontmatter),
    confirmMatches: (title, description, members) => realDeps.confirmMatches(title, description, members),

    async importRecipe(frontmatter, _content, descVec) {
      // Capture: record the slug the real import would produce, but write nothing.
      const slug = String(frontmatter.title ?? "unknown")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
      importedSlugs.set(slug, descVec);
      return slug;
    },

    async recordMatches(slug, attributions: Attribution[]) {
      // Capture the attribution on the last recorded outcome for this slug.
      const outcome = outcomes.find((o) => o.slug === slug && o.outcome === "imported");
      if (outcome) outcome.wouldMatchMembers = attributions.map((a) => a.tenant);
    },

    async recordLog(entry: LogEntry) {
      outcomes.push({
        url: entry.url,
        title: entry.title,
        source: entry.source,
        outcome: entry.outcome,
        slug: entry.slug,
        detail: entry.detail,
      });
    },

    async loadRetries() { return []; },
    async resolveRow() {},
    async bumpRetry() {},
  };

  return {
    deps,
    capturedOutcomes: () => [...outcomes],
  };
}

// --- 4. Footgun guard (config write validation) -----------------------------

/** Hard floors: values AT OR BELOW these thresholds need an explicit confirm. */
export const FLOOR_TASTE = 0.2;
export const FLOOR_DEDUP = 0.7;
/** Hard ceiling: a rate cap AT OR ABOVE this needs an explicit confirm. */
export const CEILING_RATE_CAP = 100;

export interface ValidateDiscoveryConfigOpts {
  /** When true, allow values that breach hard floors/ceilings (the operator explicitly confirmed). */
  confirm?: boolean;
}

export interface ConfigValidationResult {
  /** null = valid; a ToolError = rejected. */
  error: ToolError | null;
}

/**
 * Server-side guard for a discovery config write. Enforces:
 *   - range checks: thresholds in (0, 1], caps positive integers
 *   - hard floors: τ ≤ FLOOR_TASTE or δ ≤ FLOOR_DEDUP → rejected unless confirm=true
 *   - hard ceiling: rateCap ≥ CEILING_RATE_CAP → rejected unless confirm=true
 * Returns a structured error (never throws).
 */
export function validateDiscoveryConfig(
  patch: Partial<DiscoveryConfig>,
  opts: ValidateDiscoveryConfigOpts = {},
): ConfigValidationResult {
  const { confirm = false } = opts;

  // Range checks (always enforced, even with confirm=true).
  if (patch.tasteThreshold !== undefined) {
    if (typeof patch.tasteThreshold !== "number" || patch.tasteThreshold <= 0 || patch.tasteThreshold > 1) {
      return { error: new ToolError("validation_failed", "tasteThreshold must be in (0, 1]", { field: "tasteThreshold" }) };
    }
  }
  if (patch.triageThreshold !== undefined) {
    if (typeof patch.triageThreshold !== "number" || patch.triageThreshold <= 0 || patch.triageThreshold > 1) {
      return { error: new ToolError("validation_failed", "triageThreshold must be in (0, 1]", { field: "triageThreshold" }) };
    }
  }
  if (patch.dedupThreshold !== undefined) {
    if (typeof patch.dedupThreshold !== "number" || patch.dedupThreshold <= 0 || patch.dedupThreshold > 1) {
      return { error: new ToolError("validation_failed", "dedupThreshold must be in (0, 1]", { field: "dedupThreshold" }) };
    }
  }
  if (patch.classifyMaxPerTick !== undefined) {
    if (
      typeof patch.classifyMaxPerTick !== "number" ||
      !Number.isInteger(patch.classifyMaxPerTick) ||
      patch.classifyMaxPerTick <= 0
    ) {
      return { error: new ToolError("validation_failed", "classifyMaxPerTick must be a positive integer", { field: "classifyMaxPerTick" }) };
    }
  }
  if (patch.rateCap !== undefined) {
    if (typeof patch.rateCap !== "number" || !Number.isInteger(patch.rateCap) || patch.rateCap <= 0) {
      return { error: new ToolError("validation_failed", "rateCap must be a positive integer", { field: "rateCap" }) };
    }
  }

  // Floor/ceiling checks (require explicit confirm to override).
  if (!confirm) {
    if (patch.tasteThreshold !== undefined && patch.tasteThreshold <= FLOOR_TASTE) {
      return {
        error: new ToolError(
          "validation_failed",
          `tasteThreshold ≤ ${FLOOR_TASTE} makes the sweep dangerously permissive — pass confirm:true to override`,
          { field: "tasteThreshold", floor: FLOOR_TASTE, needsConfirm: true },
        ),
      };
    }
    if (patch.dedupThreshold !== undefined && patch.dedupThreshold <= FLOOR_DEDUP) {
      return {
        error: new ToolError(
          "validation_failed",
          `dedupThreshold ≤ ${FLOOR_DEDUP} risks collapsing genuine variety — pass confirm:true to override`,
          { field: "dedupThreshold", floor: FLOOR_DEDUP, needsConfirm: true },
        ),
      };
    }
    if (patch.rateCap !== undefined && patch.rateCap >= CEILING_RATE_CAP) {
      return {
        error: new ToolError(
          "validation_failed",
          `rateCap ≥ ${CEILING_RATE_CAP} may flood the corpus — pass confirm:true to override`,
          { field: "rateCap", ceiling: CEILING_RATE_CAP, needsConfirm: true },
        ),
      };
    }
  }

  return { error: null };
}
