// The background DISCOVERY SWEEP core (background-discovery-sweep) — the fourth scheduled
// capture job. It turns the in-chat, plan-time discovery pull into an autonomous pipeline:
// gather new candidates (feeds + the email inbox) → cheap triage → classify (env.AI) →
// dedup → taste-match → auto-import, recording a per-candidate outcome to the operator log.
//
// Determinism boundary (ADR 0001): this is the `capture` leg, relocated from Claude-in-chat
// to a small model on the cron. The matcher and dedup reuse the SAME cosine machinery the
// search ranker already uses (favoriteAffinity / cosineSimilarity) — the duplicate detector
// is just that cosine aimed at the corpus instead of at favorites.
//
// Logic is split from I/O (injected `DiscoveryDeps`) so the whole pipeline is unit-testable
// with in-memory fakes, exactly as flyer-warm.ts / recipe-embeddings.ts are. Unlike the
// flyer's KV cursor, the sweep needs no persisted plan: every processed candidate is
// recorded (imported → corpus, or a terminal outcome → the dedup log), so the D1 log IS the
// progress state and a re-run never reprocesses a handled candidate.

import { cosineSimilarity, embedText, embedTexts } from "./embedding.js";
import { favoriteAffinity } from "./semantic-search.js";
import type { Env } from "./env.js";
import { createR2CorpusStore } from "./corpus-store.js";
import { directoryFromEnv } from "./tenant.js";
import { readFeeds, readDiscoveryInbox, readDiscoveryRejections } from "./corpus-db.js";
import { recipeSourceMap, loadRecipeEmbeddings } from "./recipe-index.js";
import { extractRecipeSources, canonicalizeUrl, buildNewRecipe } from "./discovery.js";
import { parseFeed } from "./feeds.js";
import { fetchWithBrowserHeaders } from "./http.js";
import { extractJsonLd, findRecipe, normalizeRecipe } from "./jsonld.js";
import { classifyRecipe } from "./discovery-classify.js";
import { generateDescription, facetsFromFrontmatter } from "./description.js";
import { CLASSIFY_MODEL } from "./discovery-classify.js";
import { validateFile } from "./validate.js";
import { seedRecipeDescription, EMBED_INPUT_BATCH } from "./recipe-embeddings.js";
import { readOverlay, readProfile } from "./profile-db.js";
import { readTasteVectors, reconcileTasteVectors, buildTasteDeps } from "./taste-vector.js";
import {
  recordDiscoveryLog,
  loadEvaluatedUrls,
  recordDiscoveryMatches,
  pruneDiscoveryLog,
  countDiscoveryFailures,
} from "./discovery-db.js";
import { notifyFailure, writeJobHealth } from "./health.js";
import type { KvStore } from "./kroger-user.js";

/** A new discovery candidate to evaluate (already deduped vs corpus/rejections/log by the deps). */
export interface SweepCandidate {
  /** Canonical source URL (the dedup + log key). */
  url: string;
  title: string;
  /** Blurb for the cheap pre-classification triage embed; may be null. */
  summary: string | null;
  /** Provenance for the log (feed name / sender address). */
  source: string;
}

/** One member's taste signal for the matcher (vectors resolved by the deps). */
export interface SweepMember {
  tenant: string;
  /** Embedding of the member's authored `profile.taste` text, or null (cold-start on favorites). */
  tasteVector: number[] | null;
  /** Vectors of the member's favorited recipes (taste direction; nearest-liked). */
  favoriteVectors: number[][];
  /** Vectors of the member's rejected recipes (repel: don't re-surface a near-dup of a reject). */
  rejectVectors: number[][];
  /** The member's HARD dietary restrictions, lowercased (a violating recipe can't match them). */
  dietary: string[];
}

/** The parsed recipe content the classifier reads and the body is assembled from. */
export interface RecipeContent {
  title: string;
  ingredients: string[];
  instructions: string[];
}

/** Tunable thresholds + per-tick caps (calibrated by the spike's task 0.3; injected). */
export interface DiscoveryConfig {
  /** Taste cosine a member must clear for a candidate to (cosine-)match them. */
  tasteThreshold: number;
  /** Looser threshold for the cheap title+summary triage (the blurb vector is lower-fidelity). */
  triageThreshold: number;
  /** Near-duplicate cosine: at/above this vs the corpus (or this tick's imports) → skip. δ ≫ τ. */
  dedupThreshold: number;
  /** Max candidates CLASSIFIED per tick (the env.AI budget bound). */
  classifyMaxPerTick: number;
  /** Max external recipe-page FETCHES per tick (the scarce shared-subrequest bound — a parse
   *  failure spends one without ever reaching classify, so it is capped separately). */
  fetchMaxPerTick: number;
  /** Max candidates CONSIDERED per tick. Bounds the triage-embed + log-write cost so an
   *  unbounded intake backlog can't balloon one invocation; the excess defers to later ticks. */
  maxCandidatesPerTick: number;
  /** Max IMPORTS per tick (the corpus-bloat governor); excess is deferred + logged. */
  rateCap: number;
}

export const DEFAULT_CONFIG: DiscoveryConfig = {
  // Placeholders until task 0.3 calibrates them against the live corpus. fetchMaxPerTick
  // bounds the EXTERNAL recipe-page fetches — the scarce resource, since a parse failure
  // spends one without reaching classify — which share the flyer's 50-subrequest
  // per-invocation budget (both run in one scheduled() tick). classifyMaxPerTick bounds the
  // env.AI classify calls. Keep both conservative; fetchMaxPerTick ≥ classifyMaxPerTick since
  // some fetches park before classify.
  tasteThreshold: 0.55,
  triageThreshold: 0.45,
  dedupThreshold: 0.9,
  classifyMaxPerTick: 12,
  fetchMaxPerTick: 16,
  maxCandidatesPerTick: 150,
  rateCap: 10,
};

export type Outcome =
  | "imported"
  | "duplicate"
  | "no_match"
  | "rejected_source"
  | "dietary_gated"
  | "error"
  | "failed"
  | "deferred";

/** One per-candidate outcome row for the operator log (and the dedup/error views). */
export interface LogEntry {
  url: string;
  title: string;
  source: string;
  outcome: Outcome;
  slug?: string;
  detail?: Record<string, unknown>;
}

/** Per-member attribution to persist on an import. */
export interface Attribution {
  tenant: string;
  score: number;
}

/** What one sweep tick did — the health summary + test assertions. */
export interface SweepResult {
  processed: number;
  imported: number;
  duplicate: number;
  noMatch: number;
  dietaryGated: number;
  /** CONTENT parks — a candidate the sweep can't use (unreachable/walled/invalid). Expected
   *  steady state; surfaced for an author to eyeball, but NOT a system-health failure. */
  parked: number;
  /** INFRASTRUCTURE failures — a candidate dropped by a transient env.AI/D1 error (a
   *  subrequest-limit hit, an AI outage). A real failure: it flips the job's health `ok`. */
  failed: number;
  deferred: number;
}

/** The I/O the sweep needs, injected so the pipeline is testable without feeds/AI/D1/R2. */
export interface DiscoveryDeps {
  /** New candidates this tick (deps poll feeds + read the inbox + dedup vs corpus/rejections/log). */
  loadCandidates(): Promise<SweepCandidate[]>;
  /** Every member's resolved taste signal. */
  loadMembers(): Promise<SweepMember[]>;
  /** Every corpus recipe's description vector (for L2 dedup), as [slug, vector] pairs. */
  loadCorpusVectors(): Promise<Array<{ slug: string; vector: number[] }>>;
  /** Embed one text (the description post-classify — one call per surviving candidate). */
  embed(text: string): Promise<number[]>;
  /** Embed MANY texts in ONE call — the batched triage primitive, so the whole candidate
   *  pool's title+summary embeds cost a single subrequest instead of one apiece. */
  embedMany(texts: string[]): Promise<number[][]>;
  /** Fetch + parse a candidate to structured content; null when unreachable/walled (→ parked). */
  acquireContent(candidate: SweepCandidate): Promise<RecipeContent | null>;
  /** Classify content → contract-valid frontmatter; throws (validation_failed) when it can't (→ park). */
  classify(content: RecipeContent, source: string): Promise<Record<string, unknown>>;
  /** Generate the description from the classified facets (the embed source + "why this dish"). */
  describe(frontmatter: Record<string, unknown>): Promise<string>;
  /** The small-LLM negation-aware confirm: which of these members genuinely fit? Returns the tenants. */
  confirmMatches(title: string, description: string, members: SweepMember[]): Promise<string[]>;
  /** Import: assemble body + frontmatter, validate, write to the corpus, return the slug. */
  importRecipe(frontmatter: Record<string, unknown>, content: RecipeContent, descVector: number[]): Promise<string>;
  /** Persist per-member attribution for an imported recipe. */
  recordMatches(slug: string, attributions: Attribution[]): Promise<void>;
  /** Append one outcome row to the discovery log. */
  recordLog(entry: LogEntry): Promise<void>;
}

// --- pure matcher / dedup helpers (the same cosine the search ranker uses) ---

/** Best taste cosine of a candidate to one member: max over their favorites and their taste vector. */
export function bestTasteCosine(vec: number[], member: SweepMember): number {
  const fav = favoriteAffinity(vec, member.favoriteVectors);
  const taste = member.tasteVector ? cosineSimilarity(vec, member.tasteVector) : 0;
  return Math.max(fav, taste);
}

/** True if the candidate is near ANY member at the (looser) triage threshold — the cheap gate. */
export function nearAnyMember(vec: number[], members: SweepMember[], threshold: number): boolean {
  return members.some((m) => bestTasteCosine(vec, m) >= threshold);
}

/** The corpus recipe a candidate duplicates (max cosine ≥ δ), or null. Also used intra-sweep. */
export function findDuplicate(
  vec: number[],
  corpus: Array<{ slug: string; vector: number[] }>,
  delta: number,
): string | null {
  let bestSlug: string | null = null;
  let best = delta;
  for (const { slug, vector } of corpus) {
    const c = cosineSimilarity(vec, vector);
    if (c >= best) {
      best = c;
      bestSlug = slug;
    }
  }
  return bestSlug;
}

/** Does the candidate satisfy every one of a member's hard dietary restrictions? */
export function dietaryOk(candidateDietary: string[], restrictions: string[]): boolean {
  if (restrictions.length === 0) return true;
  const have = new Set(candidateDietary.map((d) => d.toLowerCase()));
  return restrictions.every((r) => have.has(r.toLowerCase()));
}

/** Cosine-match a candidate against members: clears τ, not repelled by a reject, passes diet. */
export function matchMembers(
  vec: number[],
  candidateDietary: string[],
  members: SweepMember[],
  config: DiscoveryConfig,
): { matches: Attribution[]; gatedByDiet: boolean } {
  const matches: Attribution[] = [];
  let gatedByDiet = false;
  for (const m of members) {
    const score = bestTasteCosine(vec, m);
    if (score < config.tasteThreshold) continue;
    // Repel: a near-duplicate of something this member rejected is not for them.
    if (favoriteAffinity(vec, m.rejectVectors) >= config.dedupThreshold) continue;
    if (!dietaryOk(candidateDietary, m.dietary)) {
      gatedByDiet = true;
      continue;
    }
    matches.push({ tenant: m.tenant, score: Math.round(score * 1e4) / 1e4 });
  }
  return { matches, gatedByDiet: gatedByDiet && matches.length === 0 };
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** The cheap-triage embed text for a candidate: its title joined with its blurb (if any). */
export function triageText(c: SweepCandidate): string {
  return [c.title, c.summary ?? ""].join(" — ").trim();
}

/**
 * Run one discovery sweep tick: process the gathered candidates through triage → classify →
 * dedup → match → confirm → import, bounded by the classify cap and the import rate cap, and
 * record a log entry for every terminal outcome. Pure orchestration over injected deps; all
 * writes are idempotent (the recorded outcome keeps a candidate from reprocessing), so a
 * thrown/retried tick is safe.
 */
export async function runDiscoverySweep(
  deps: DiscoveryDeps,
  config: DiscoveryConfig = DEFAULT_CONFIG,
): Promise<SweepResult> {
  const [candidates, members, corpus] = await Promise.all([
    deps.loadCandidates(),
    deps.loadMembers(),
    deps.loadCorpusVectors(),
  ]);
  const res: SweepResult = {
    processed: 0,
    imported: 0,
    duplicate: 0,
    noMatch: 0,
    dietaryGated: 0,
    parked: 0,
    failed: 0,
    deferred: 0,
  };
  const importedVectors: Array<{ slug: string; vector: number[] }> = [];
  let classified = 0;
  let fetched = 0;

  // Clamp the per-tick pool so an unbounded intake backlog (many feeds, an un-pruned inbox)
  // can't balloon one invocation's subrequest/CPU cost — each candidate costs a triage-embed
  // slot and a log write. The excess defers to later ticks (the frequent cron drains it),
  // exactly like the rate/fetch caps below.
  const pool = candidates.slice(0, config.maxCandidatesPerTick);
  res.deferred += candidates.length - pool.length;

  // Triage embeds, batched in env.AI-input-sized CHUNKS (EMBED_INPUT_BATCH — the same bge input
  // ceiling the recipe-embedding reconcile chunks on), so the whole pool costs ceil(N/BATCH)
  // calls — not one per candidate, and not one oversized call that would exceed the model's
  // input limit and wedge the tick. The match itself stays the pure `nearAnyMember` cosine
  // check below. A chunk failure (a transient env.AI outage) propagates and fails the tick: no
  // candidate is logged, so the whole pool re-gathers next run — far safer than embedding each
  // one (re-spending the budget we are saving) or mislabeling them all `no_match`.
  const triageVecs: number[][] = [];
  for (let i = 0; i < pool.length; i += EMBED_INPUT_BATCH) {
    triageVecs.push(...(await deps.embedMany(pool.slice(i, i + EMBED_INPUT_BATCH).map(triageText))));
  }

  for (let i = 0; i < pool.length; i++) {
    const candidate = pool[i];
    // Governor / budget: once the rate cap or the classify cap is hit, defer the rest (no
    // wasted classify) — they re-gather next tick (still un-evaluated, so no dedup needed).
    if (res.imported >= config.rateCap || classified >= config.classifyMaxPerTick) {
      res.deferred++;
      continue;
    }

    try {
      // [1] cheap triage — drop anything near nobody BEFORE spending a fetch/classify. The
      //     blurb vector was embedded in the batch above; this is now a pure cosine check.
      if (!nearAnyMember(triageVecs[i] ?? [], members, config.triageThreshold)) {
        await deps.recordLog({ ...logBase(candidate), outcome: "no_match", detail: { stage: "triage" } });
        res.noMatch++;
        res.processed++;
        continue;
      }

      // Fetch budget: the external page fetch is the scarce shared subrequest, and a parse
      // failure spends one WITHOUT reaching classify — so bound the fetches directly, not via
      // the classify cap. A triage survivor we cannot afford to fetch this tick is deferred
      // (re-gathered next tick); triage non-matches above are still cheaply finalized.
      if (fetched >= config.fetchMaxPerTick) {
        res.deferred++;
        continue;
      }

      // [2] acquire content — unreachable/walled (no inline recipe) → park (no human to paste).
      const content = await deps.acquireContent(candidate);
      fetched++;
      if (!content) {
        await deps.recordLog({ ...logBase(candidate), outcome: "error", detail: { reason: "unreachable" } });
        res.parked++;
        res.processed++;
        continue;
      }

      // [3] classify — the expensive leg; a persistently-invalid classification parks.
      classified++;
      let frontmatter: Record<string, unknown>;
      try {
        frontmatter = await deps.classify(content, candidate.url);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        await deps.recordLog({ ...logBase(candidate), outcome: "error", detail: { reason: message } });
        res.parked++;
        res.processed++;
        continue;
      }

      // [4] describe + embed the description — the authoritative vector for dedup + match.
      const description = await deps.describe(frontmatter);
      const descVec = await deps.embed(description);

      // [5] dedup — same dish already in the corpus (L2) or imported earlier this tick (L3).
      const dupSlug = findDuplicate(descVec, corpus, config.dedupThreshold) ??
        findDuplicate(descVec, importedVectors, config.dedupThreshold);
      if (dupSlug) {
        await deps.recordLog({ ...logBase(candidate), outcome: "duplicate", detail: { duplicate_of: dupSlug } });
        res.duplicate++;
        res.processed++;
        continue;
      }

      // [6] match (cosine + repel + dietary gate), then the negation-aware LLM confirm.
      const { matches, gatedByDiet } = matchMembers(
        descVec,
        asStringArray(frontmatter.dietary),
        members,
        config,
      );
      if (matches.length === 0) {
        const outcome: Outcome = gatedByDiet ? "dietary_gated" : "no_match";
        await deps.recordLog({ ...logBase(candidate), outcome, detail: { stage: "match" } });
        if (gatedByDiet) res.dietaryGated++;
        else res.noMatch++;
        res.processed++;
        continue;
      }
      const matchMembersList = members.filter((m) => matches.some((a) => a.tenant === m.tenant));
      const confirmed = new Set(await deps.confirmMatches(candidate.title, description, matchMembersList));
      const attributions = matches.filter((a) => confirmed.has(a.tenant));
      if (attributions.length === 0) {
        await deps.recordLog({ ...logBase(candidate), outcome: "no_match", detail: { stage: "confirm" } });
        res.noMatch++;
        res.processed++;
        continue;
      }

      // [7] import — assemble + validate + write; attribute; log; seed the L3 vector. An
      // import failure (e.g. a slug collision) parks the candidate rather than crashing the tick.
      let slug: string;
      try {
        slug = await deps.importRecipe(frontmatter, content, descVec);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        await deps.recordLog({ ...logBase(candidate), outcome: "error", detail: { reason: `import: ${message}` } });
        res.parked++;
        res.processed++;
        continue;
      }
      await deps.recordMatches(slug, attributions);
      await deps.recordLog({
        ...logBase(candidate),
        outcome: "imported",
        slug,
        detail: { attribution: attributions },
      });
      importedVectors.push({ slug, vector: descVec });
      res.imported++;
      res.processed++;
    } catch (e) {
      // An unexpected transient AI/D1 failure (env.AI hiccup, a subrequest-limit hit, a D1
      // blip) drops THIS candidate rather than throwing out of the loop — the unattended sweep
      // must keep making progress. It is recorded as `failed` (an INFRASTRUCTURE failure, not a
      // content `error`): a real fault that flips the job's health `ok` until it clears, vs an
      // expected un-importable page. recordLog is best-effort; if it too fails, the candidate is
      // left un-evaluated and re-tried next tick (idempotent, so that is safe).
      const message = e instanceof Error ? e.message : String(e);
      try {
        await deps.recordLog({ ...logBase(candidate), outcome: "failed", detail: { reason: `unexpected: ${message}` } });
      } catch {
        /* logging itself failed — skip; next tick re-evaluates this candidate */
      }
      res.failed++;
      res.processed++;
    }
  }

  return res;
}

function logBase(c: SweepCandidate): Pick<LogEntry, "url" | "title" | "source"> {
  return { url: c.url, title: c.title, source: c.source };
}

// --- real-client wiring (buildDiscoveryDeps), mirroring flyer-warm's buildWarmDeps -------

const MAX_PER_FEED = 8;
/** Max links promoted from a single email body — a newsletter can carry a long junk tail. */
const MAX_PER_EMAIL = 8;
const URL_RE = /https?:\/\/[^\s)"'<>]+/g;

/** Hosts that are never a recipe page — social/sharing and chat. Matched on the host with a
 *  leading `www.` stripped. Conservative on purpose: over-filtering hides recipes, and the
 *  per-tick fetch budget already backstops whatever junk slips through. */
const NON_RECIPE_HOSTS = new Set([
  "facebook.com", "twitter.com", "x.com", "instagram.com", "pinterest.com",
  "youtube.com", "youtu.be", "tiktok.com", "linkedin.com", "reddit.com", "threads.net",
  "whatsapp.com", "t.me",
]);
/** Path shapes that are transactional/navigational, never a recipe (unsubscribe, account, …). */
const NON_RECIPE_PATH_RE =
  /(?:^|\/)(?:unsubscribe|subscribe|preferences|manage|account|login|signup|sign-up|privacy|terms|contact|about)(?:\/|$)/i;

/** True for a link that is obviously NOT a recipe page (a social share, an unsubscribe link),
 *  so an email body's junk tail never becomes a fetched-then-parked candidate. Unparseable →
 *  true (drop). High-precision: it rejects only clear non-recipes; a click-tracking wrapper
 *  that redirects to a recipe is left for the fetch (bounded by fetchMaxPerTick) to resolve. */
export function isLikelyNonRecipeLink(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return true;
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  if (NON_RECIPE_HOSTS.has(host)) return true;
  return NON_RECIPE_PATH_RE.test(u.pathname);
}

function renderContent(c: RecipeContent): string {
  return (
    `Ingredients:\n${c.ingredients.map((i) => `- ${i}`).join("\n")}\n\n` +
    `Instructions:\n${c.instructions.map((s, i) => `${i + 1}. ${s}`).join("\n")}`
  );
}

function assembleBody(c: RecipeContent): string {
  return (
    `## Ingredients\n\n${c.ingredients.map((i) => `- ${i}`).join("\n")}\n\n` +
    `## Instructions\n\n${c.instructions.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n`
  );
}

/** Conservatively derive a member's HARD dietary restrictions from their preferences. Returns
 *  [] (no gate) when the shape is unclear — over-gating wrongly hides recipes, and opt-out
 *  (toggle_reject) is the backstop. */
function deriveDietaryRestrictions(preferences: Record<string, unknown> | null): string[] {
  const d = preferences?.dietary as unknown;
  if (Array.isArray(d)) return d.filter((x): x is string => typeof x === "string");
  if (d && typeof d === "object") {
    const r = (d as Record<string, unknown>).restrictions ?? (d as Record<string, unknown>).avoid;
    if (Array.isArray(r)) return r.filter((x): x is string => typeof x === "string");
  }
  return [];
}

function parseJsonObject(response: unknown): Record<string, unknown> | null {
  if (response && typeof response === "object") return response as Record<string, unknown>;
  if (typeof response !== "string") return null;
  const t = response.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const s = t.indexOf("{");
  const e = t.lastIndexOf("}");
  if (s === -1 || e === -1) return null;
  try {
    const v = JSON.parse(t.slice(s, e + 1));
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The negation-aware confirm: ask the model which members genuinely fit, respecting their
 *  stated dislikes. Members with no taste text can't be negation-checked → kept (cosine
 *  already gated them). Fails OPEN to the cosine matches on an AI error (a missed negation is
 *  a toggle_reject away; the pipeline stays resilient). */
async function confirmMatchesAI(
  env: Env,
  title: string,
  description: string,
  members: SweepMember[],
  tasteTexts: Map<string, string>,
): Promise<string[]> {
  const withText = members.filter((m) => (tasteTexts.get(m.tenant) ?? "").trim());
  const noText = members.filter((m) => !(tasteTexts.get(m.tenant) ?? "").trim()).map((m) => m.tenant);
  if (withText.length === 0) return members.map((m) => m.tenant);
  const roster = withText.map((m) => `- ${m.tenant}: ${tasteTexts.get(m.tenant)}`).join("\n");
  const prompt =
    `Recipe: "${title}" — ${description}\n\n` +
    "For each member below, decide if this recipe is a genuine fit for their taste, RESPECTING any dislikes or avoidances they state (a stated dislike of a defining ingredient means NOT a fit). " +
    'Output ONLY JSON: {"fits": ["<member>", ...]} listing the members it fits.\n\nMembers:\n' +
    roster;
  try {
    const res = (await env.AI.run(CLASSIFY_MODEL, {
      messages: [{ role: "user", content: prompt }],
      max_tokens: 200,
      temperature: 0,
    })) as { response?: unknown };
    const parsed = parseJsonObject(res?.response);
    const fits = Array.isArray(parsed?.fits)
      ? (parsed!.fits as unknown[]).filter((x): x is string => typeof x === "string")
      : withText.map((m) => m.tenant);
    return [...new Set([...fits, ...noText])];
  } catch {
    return members.map((m) => m.tenant);
  }
}

/**
 * Wire the real feed/HTTP/AI/D1/R2 clients for the scheduled handler. Integration glue
 * (not unit-tested — the testable core is `runDiscoverySweep`), mirroring flyer-warm's
 * `buildWarmDeps` / recipe-embeddings' `buildEmbedDeps`. Runs without an OAuth session: it
 * enumerates the tenant directory and reads shared + per-tenant D1 directly.
 */
export function buildDiscoveryDeps(env: Env, now: () => number = () => Date.now()): DiscoveryDeps {
  const store = createR2CorpusStore(env.CORPUS);
  const directory = directoryFromEnv(env);
  const tasteTexts = new Map<string, string>(); // tenant → taste text, populated by loadMembers
  const today = () => new Date(now()).toISOString().slice(0, 10);

  return {
    async loadCandidates() {
      const feeds = await readFeeds(env);
      const [sourceMap, rejected, evaluated, inbox] = await Promise.all([
        recipeSourceMap(env),
        readDiscoveryRejections(env),
        loadEvaluatedUrls(env),
        readDiscoveryInbox(env),
      ]);
      const seen = extractRecipeSources(sourceMap);
      for (const u of rejected) seen.add(u);
      for (const u of evaluated) seen.add(canonicalizeUrl(u));

      const out: SweepCandidate[] = [];
      const local = new Set<string>();
      const push = (rawUrl: string, title: string, summary: string | null, source: string): boolean => {
        const url = canonicalizeUrl(rawUrl);
        if (!url || seen.has(url) || local.has(url)) return false;
        local.add(url);
        out.push({ url, title, summary, source });
        return true;
      };

      // RSS/Atom feeds (title + summary give the triage a real signal).
      await Promise.all(
        feeds.map(async (f) => {
          if (!f.url) return;
          try {
            const res = await fetchWithBrowserHeaders(f.url);
            if (!res.ok) return;
            for (const item of parseFeed(await res.text()).slice(0, MAX_PER_FEED)) {
              push(item.link, item.title, item.summary ?? null, f.name ?? f.url);
            }
          } catch {
            // a dead feed is skipped this sweep (re-tried next), never wedges the sweep
          }
        }),
      );

      // Email inbox — promote the body's recipe links (the page fetch yields the real title).
      // Drop obvious non-recipe links and cap per email so one newsletter's junk tail cannot
      // flood the pool: every promoted link costs a triage embed and, if it survives, a fetch.
      for (const email of inbox) {
        const body = typeof email.body === "string" ? email.body : "";
        const subject = typeof email.subject === "string" ? email.subject : "newsletter";
        const sender = String(email.from ?? "email");
        let promoted = 0;
        for (const m of body.match(URL_RE) ?? []) {
          if (promoted >= MAX_PER_EMAIL) break;
          if (isLikelyNonRecipeLink(m)) continue;
          if (push(m, subject, null, sender)) promoted++;
        }
      }
      return out;
    },

    async loadMembers() {
      const tenants = await directory.list();
      const [corpusEmb, tasteVecs] = await Promise.all([loadRecipeEmbeddings(env), readTasteVectors(env)]);
      const members: SweepMember[] = [];
      for (const tenant of tenants) {
        const [overlay, profile] = await Promise.all([readOverlay(env, tenant), readProfile(env, tenant)]);
        const favoriteVectors: number[][] = [];
        const rejectVectors: number[][] = [];
        for (const [slug, o] of Object.entries(overlay)) {
          const v = corpusEmb.get(slug);
          if (!v) continue;
          if (o.favorite) favoriteVectors.push(v);
          if (o.reject) rejectVectors.push(v);
        }
        if (typeof profile.taste === "string" && profile.taste.trim()) tasteTexts.set(tenant, profile.taste.trim());
        members.push({
          tenant,
          tasteVector: tasteVecs.get(tenant) ?? null,
          favoriteVectors,
          rejectVectors,
          dietary: deriveDietaryRestrictions(profile.preferences),
        });
      }
      return members;
    },

    async loadCorpusVectors() {
      const emb = await loadRecipeEmbeddings(env);
      return [...emb.entries()].map(([slug, vector]) => ({ slug, vector }));
    },

    embed: (text) => embedText(env, text),

    embedMany: (texts) => embedTexts(env, texts),

    async acquireContent(candidate) {
      try {
        const res = await fetchWithBrowserHeaders(candidate.url);
        if (!res.ok) return null;
        const blocks = await extractJsonLd(res);
        if (blocks.length === 0) return null;
        const recipe = findRecipe(blocks);
        if (!recipe) return null;
        const norm = normalizeRecipe(recipe);
        if (!norm.ok) return null;
        return {
          title: norm.recipe.title || candidate.title,
          ingredients: norm.recipe.ingredients,
          instructions: norm.recipe.instructions,
        };
      } catch {
        return null;
      }
    },

    async classify(content, source) {
      const { frontmatter } = await classifyRecipe(env, { title: content.title, content: renderContent(content) }, source);
      return frontmatter;
    },

    describe: (frontmatter) => generateDescription(env, facetsFromFrontmatter(frontmatter)),

    confirmMatches: (title, description, members) => confirmMatchesAI(env, title, description, members, tasteTexts),

    async importRecipe(frontmatter, content) {
      const fm = { ...frontmatter, discovered_at: today(), discovery_source: "discovery-sweep" };
      const body = assembleBody(content);
      const { slug, file, facets } = await buildNewRecipe(store, env, fm, body);
      validateFile(file.path, file.content);
      await store.put(file.path, file.content);
      // Seed the description so the recipe reads well before the reconcile (the embedding is
      // left to the reconcile, as create_recipe does — keep import consistent with that path).
      try {
        await seedRecipeDescription(env, slug, facets);
      } catch (e) {
        console.error(`[discovery-sweep] description seed failed for ${slug}:`, e);
      }
      return slug;
    },

    async recordMatches(slug, attributions) {
      await recordDiscoveryMatches(env, slug, attributions, today());
    },

    async recordLog(entry) {
      await recordDiscoveryLog(env, { ...entry, createdAt: new Date(now()).toISOString() });
    },
  };
}

/** Log rows older than this are pruned each run (the audit/dedup retention window). */
export const LOG_RETENTION_DAYS = 60;

/**
 * One scheduled run of the discovery sweep: refresh the per-member taste vectors (so the
 * matcher has current taste), run the sweep, prune old log rows, record
 * `health:job:discovery-sweep` — a counts summary with `ok: false` while any standing
 * INFRASTRUCTURE failure (`outcome = 'failed'`) sits unresolved, so `/health` shows the
 * degradation even on a later idle tick (a content park does NOT degrade it). On a HARD
 * (thrown) tick it records `ok: false` and **rethrows** so the platform's native cron status
 * reflects it too — the same shape as runWarmJob / runEmbedJob / runProjectionJob. Runs AFTER
 * the index projection + recipe-derived reconcile in the tick, so dedup/match see a fresh
 * corpus + fresh embeddings.
 */
export async function runDiscoverySweepJob(
  env: Env,
  deps: DiscoveryDeps,
  kv: KvStore,
  config: DiscoveryConfig = DEFAULT_CONFIG,
  now: () => number = () => Date.now(),
): Promise<void> {
  const startedAt = now();
  try {
    const directory = directoryFromEnv(env);
    const taste = await reconcileTasteVectors(
      buildTasteDeps(env, async () => {
        const tenants = await directory.list();
        return Promise.all(
          tenants.map(async (tenant) => ({ tenant, taste: (await readProfile(env, tenant)).taste })),
        );
      }, now),
    );
    const r = await runDiscoverySweep(deps, config);
    const cutoff = new Date(startedAt - LOG_RETENTION_DAYS * 86_400_000).toISOString();
    const pruned = await pruneDiscoveryLog(env, cutoff);
    // Standing infrastructure-failure count (not just this tick's): an idle tick after an
    // outage must still read as degraded until the `failed` rows clear, so the health record
    // reflects the system's actual state, not just the latest run's activity. THAT is what a
    // health check is for. `ok: false` flips `/health` to 503; the cron itself is NOT failed
    // (the tick completed) — only a thrown tick rethrows below.
    const failedOutstanding = await countDiscoveryFailures(env);
    const ok = failedOutstanding === 0;
    await writeJobHealth(kv, "discovery-sweep", {
      ok,
      last_run_at: startedAt,
      summary: {
        processed: r.processed,
        imported: r.imported,
        duplicate: r.duplicate,
        no_match: r.noMatch,
        dietary_gated: r.dietaryGated,
        parked: r.parked,
        failed: r.failed,
        failed_outstanding: failedOutstanding,
        deferred: r.deferred,
        taste_updated: taste.updated,
        log_pruned: pruned,
      },
    });
    if (r.failed > 0) {
      // Push only on FRESH infra failures (this tick), not on every tick a failure stands —
      // the standing state is already visible at `/health` (ok:false). Avoids per-tick ntfy
      // spam on the short cron cadence.
      await notifyFailure(
        env,
        "discovery-sweep",
        `${r.failed} discovery candidate(s) failed on infrastructure errors this tick (${failedOutstanding} standing; see /health, read_discovery_errors)`,
      ).catch(() => {});
    } else if (r.parked > 0) {
      // Content parks aren't a job failure, but they need eyes (read_discovery_errors / the
      // admin log). A best-effort heads-up; never let it fail the run.
      await notifyFailure(env, "discovery-sweep", `${r.parked} discovery candidate(s) parked (see read_discovery_errors)`).catch(
        () => {},
      );
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[discovery-sweep] tick failed:", msg);
    await writeJobHealth(kv, "discovery-sweep", {
      ok: false,
      last_run_at: startedAt,
      summary: { error: msg },
    }).catch(() => {});
    await notifyFailure(env, "discovery-sweep", msg);
    throw e; // cron is not retried; surfacing the failure loses nothing
  }
}
