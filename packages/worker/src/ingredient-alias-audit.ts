// The rolling alias re-audit pass (normalization-decision-reaudit). The first ~300 identity
// decisions were captured under pre-hardening rules and several alias mappings are wrong —
// below-guard collapses ("flaky sea salt" → fish sauce::type-sea-salt at 0.598) AND high-cosine
// distinct-product errors embedding distance cannot see ("sesame seeds" → toasted sesame
// seeds::toast at 0.879). This pass converges that backlog by itself: each tick it drains a
// bounded batch of un-audited AUTO alias mappings (oldest first), stamps SELF-aliases (variant
// === node id, the row every mint writes for its own node — the bulk of the backlog) with no
// model call, and re-decides EVERY other mapping through the hardened classifier confirm —
// candidates from the current registry, always including the currently-mapped node, the pick
// subject to the same NORMALIZE_CONFIRM_MIN distance guard as capture. The trade is deliberate:
// a few dozen one-time LLM calls instead of a cosine skip-filter, because the main defect class
// (a distinct product aliased onto a lookalike) lives ABOVE any cosine threshold.
//
// Re-decisions ride capture's own primitives (buildResolution + commitResolution): the alias
// upsert IS the re-point (auto source, fresh decided_at, born-stamped audited_at), a
// specialization/novel mints via the same canonical-id synthesis, and every classifier decision
// lands in ingredient_normalization_log branded `detail.audit = "alias"` with the previous
// mapping. Nodes are NEVER deleted — but when a re-point strands an auto node with no remaining
// aliases, it is merged (representative pointer) into the re-decision's resolved node so it
// exits cosine retrieval instead of lingering as a nonsense candidate.
//
// Failure handling mirrors the siblings, tilted conservative for a RE-audit: a transient
// env.AI/D1 error skips the row un-stamped (retried next tick — un-stamped IS the retry state);
// a contract-invalid confirm KEEPS the standing mapping and stamps it (never destroy on an
// undecidable — the status quo is the safe floor here, unlike capture which must place a new
// term somewhere). Human rows are never selected; new writes are born-stamped, so the pass
// drains the pre-hardening backlog and quiesces to a no-op.

import type { Env } from "./env.js";
import { ToolError } from "./errors.js";
import { cosineSimilarity, embedTexts } from "./embedding.js";
import {
  readAliasAuditBatch,
  readAliasTargets,
  readIdentitySources,
  readIdentityEmbeddings,
  readIdentityIds,
  stampAliasAudited,
  commitResolution,
  mergeIdentities,
  type AliasAuditRow,
  type IdentitySourceRow,
  type Resolution,
} from "./corpus-db.js";
import { confirmIdentity, NORMALIZE_MODEL, type IdentityConfirm, type ScoredCandidate } from "./ingredient-classify.js";
import {
  buildResolution,
  novelResolution,
  validateCanonicalId,
  lexicalKey,
  buildLexicalMap,
  NORMALIZE_CONFIRM_MIN,
  NORMALIZE_TOP_K,
} from "./ingredient-normalize.js";
import { isDisjunctiveTerm, disjunctionResolution } from "./ingredient-disjunction.js";
import { writeJobHealth, writeJobRun } from "./health.js";

/** The background-job name the pass records its health + per-run history under. */
export const ALIAS_AUDIT_JOB = "ingredient-alias-audit";

/** Alias mappings audited per scheduled tick (bounded; the rest wait for a later tick).
 *  Self-aliases stamp free, so the backlog's bulk sweeps in a handful of ticks; the classifier
 *  rows spread their one-time confirms over the same ticks. */
export const ALIAS_AUDIT_MAX_PER_TICK = 20;

export interface AliasAuditDeps {
  loadBatch(limit: number): Promise<AliasAuditRow[]>;
  /** EVERY alias mapping (variant → pre-representative id) — the orphan check's reference set. */
  aliasTargets(): Promise<AliasAuditRow[]>;
  /** Every identity row's id/representative/source — resolution + human protection. */
  identities(): Promise<IdentitySourceRow[]>;
  identityEmbeddings(): Promise<{ id: string; embedding: number[] }[]>;
  /** EVERY existing node id and alias variant — the canonical-collision set (as capture). */
  knownIds(): Promise<Set<string>>;
  embed(texts: string[]): Promise<number[][]>;
  confirm(term: string, candidates: ScoredCandidate[]): Promise<IdentityConfirm>;
  /** Apply a re-decision — capture's own commit (alias upsert = the re-point, born-stamped). */
  commit(r: Resolution): Promise<void>;
  /** Merge a stranded wrong-mint node into the re-decision's resolved node (union-find). */
  merge(loser: string, survivor: string): Promise<void>;
  /** Stamp a self-alias audited (the deterministic pre-filter path — no commit rides it). */
  stamp(variant: string, now: number): Promise<void>;
  now(): number;
  maxPerTick: number;
  confirmMin: number;
  topK: number;
}

export interface AliasAuditSummary {
  /** Mappings reaching a terminal audited state this tick (stamped or re-committed). */
  audited: number;
  /** Self-aliases stamped by the deterministic pre-filter (no embedding, no LLM). */
  self_stamped: number;
  /** Classifier re-affirmed (or fail-safe kept) the standing mapping. */
  kept: number;
  /** Alias re-pointed to an existing node. */
  repointed: number;
  /** Re-decision minted a node (specialization / novel, incl. guard fallbacks). */
  minted: number;
  /** Stranded wrong-mint nodes merged away behind a re-point. */
  merged: number;
  /** Rows skipped on a transient error (un-stamped; retried next tick). */
  skipped: number;
}

function emptySummary(): AliasAuditSummary {
  return { audited: 0, self_stamped: 0, kept: 0, repointed: 0, minted: 0, merged: 0, skipped: 0 };
}

/** The pass's in-tick view of the registry, kept current as re-decisions land so later rows in
 *  the same tick see fresh mints and orphan merges. */
interface AuditContext {
  /** id → representative (mutable — a mid-tick merge updates it). */
  rep: Map<string, string | null>;
  /** id → source (fresh mints registered as auto). */
  sourceOf: Map<string, "auto" | "human">;
  /** variant → pre-representative target for EVERY alias (mutated as re-points land). */
  aliasTarget: Map<string, string>;
  identityVecs: { id: string; embedding: number[] }[];
  knownIds: Set<string>;
  /** lexical form → survivor over surviving NODE IDS only (a variant's own alias row must not
   *  self-satisfy it — node ids are the mechanical-identity reference set here). */
  lexical: Map<string, string>;
}

/** Follow the representative chain to the surviving id (cycle-safe; mirrors readResolver). */
function resolveVia(rep: Map<string, string | null>, id: string): string {
  let cur = id;
  const seen = new Set<string>();
  for (;;) {
    const next = rep.get(cur);
    if (!next || next === cur || seen.has(next)) return cur;
    seen.add(cur);
    cur = next;
  }
}

/** Brand a resolution's log with the audit marker + the mapping it replaced (additive). */
function brandAudit(r: Resolution, previous: string): Resolution {
  const base =
    r.log.detail && typeof r.log.detail === "object" && !Array.isArray(r.log.detail)
      ? (r.log.detail as Record<string, unknown>)
      : {};
  r.log.detail = { ...base, audit: "alias", previous_id: previous };
  return r;
}

/**
 * Re-audit one non-self mapping: confirm the variant against the current registry (the
 * currently-mapped survivor always among the candidates) and apply the re-decision. Returns how
 * the mapping ended up; throws only on a TRANSIENT error so the caller can skip-and-retry.
 */
async function auditOne(
  deps: AliasAuditDeps,
  row: AliasAuditRow,
  vec: number[],
  ctx: AuditContext,
): Promise<{ kind: "kept" | "repointed" | "minted"; mergedOrphan: boolean }> {
  const previous = resolveVia(ctx.rep, row.id);

  // Lexical fast path: a variant whose punctuation-insensitive form uniquely equals a surviving
  // node id is mechanically that product — keep (hit = the standing survivor) or re-point,
  // deterministically, with no confirm call.
  const lexicalHit = ctx.lexical.get(lexicalKey(row.variant));
  if (lexicalHit !== undefined) {
    const resolution: Resolution = {
      term: row.variant,
      id: lexicalHit,
      edges: [],
      log: {
        term: row.variant,
        outcome: "same",
        resolved_id: lexicalHit,
        candidates: [],
        model: null,
        detail: { audit: "alias", previous_id: previous, note: "lexical_match" },
      },
    };
    await deps.commit(resolution);
    ctx.aliasTarget.set(row.variant, lexicalHit);
    const lexTarget = resolveVia(ctx.rep, lexicalHit);
    if (lexTarget === previous) return { kind: "kept", mergedOrphan: false };
    let stillThere = false;
    for (const id of ctx.aliasTarget.values()) {
      if (resolveVia(ctx.rep, id) === previous) {
        stillThere = true;
        break;
      }
    }
    let merged = false;
    if (!stillThere && ctx.sourceOf.get(previous) !== "human") {
      await deps.merge(previous, lexTarget);
      ctx.rep.set(previous, lexTarget);
      merged = true;
    }
    return { kind: "repointed", mergedOrphan: merged };
  }

  // Disjunction disposal, capture parity (disjunctive-term-modeling): a variant of the form
  // "X or Y" is a satisfaction constraint, never a concrete identity — dispose it to its
  // disjunction concept deterministically (minted abstract when absent), no confirm call.
  if (isDisjunctiveTerm(row.variant)) {
    const resolution = brandAudit(disjunctionResolution(row.variant, vec), previous);
    await deps.commit(resolution);
    if (resolution.node) {
      ctx.identityVecs.push({ id: resolution.id, embedding: resolution.node.embedding });
      ctx.knownIds.add(resolution.id);
      if (!ctx.rep.has(resolution.id)) ctx.rep.set(resolution.id, null);
      if (!ctx.sourceOf.has(resolution.id)) ctx.sourceOf.set(resolution.id, "auto");
    }
    ctx.aliasTarget.set(row.variant, resolution.id);
    const target = resolveVia(ctx.rep, resolution.id);
    if (target === previous) return { kind: "kept", mergedOrphan: false };
    let stillReferenced = false;
    for (const id of ctx.aliasTarget.values()) {
      if (resolveVia(ctx.rep, id) === previous) {
        stillReferenced = true;
        break;
      }
    }
    let mergedOrphan = false;
    if (!stillReferenced && ctx.sourceOf.get(previous) !== "human") {
      await deps.merge(previous, target);
      ctx.rep.set(previous, target);
      mergedOrphan = true;
    }
    return { kind: "minted", mergedOrphan };
  }

  // Candidates: cosine top-K over the registry, plus the currently-mapped survivor when
  // retrieval misses it — scored from its registry vector when it has one, unscored otherwise
  // (ScoredCandidate models the absent score; the confirm sees it without a similarity).
  const scored = ctx.identityVecs
    .map((c) => ({ id: c.id, score: cosineSimilarity(vec, c.embedding) }))
    .sort((a, b) => b.score - a.score);
  const ranked = scored.slice(0, deps.topK);
  const candidates: ScoredCandidate[] = [...ranked];
  if (!candidates.some((c) => c.id === previous)) {
    const self = scored.find((c) => c.id === previous);
    candidates.push(self ?? { id: previous });
  }

  let resolution: Resolution;
  try {
    const confirm = await deps.confirm(row.variant, candidates);
    resolution = decide(deps, row, vec, ranked, candidates, confirm, previous, ctx.knownIds, (id) =>
      resolveVia(ctx.rep, id),
    );
  } catch (e) {
    // Contract-invalid confirm → KEEP the standing mapping and stamp it (a re-audit never
    // destroys on an undecidable — committing the same mapping is the keep, born-stamped).
    // A transient AI/D1 error → rethrow so the caller skips the row (retried next tick).
    if (!(e instanceof ToolError && e.code === "validation_failed")) throw e;
    resolution = {
      term: row.variant,
      id: previous,
      edges: [],
      log: {
        term: row.variant,
        outcome: "novel",
        resolved_id: previous,
        candidates: ranked,
        model: NORMALIZE_MODEL,
        detail: { audit: "alias", previous_id: previous, note: "confirm_failed_safe" },
      },
    };
  }

  await deps.commit(resolution);
  // Register a fresh mint for later rows this tick (retrieval + collision + resolution sets).
  if (resolution.node) {
    ctx.identityVecs.push({ id: resolution.id, embedding: resolution.node.embedding });
    ctx.knownIds.add(resolution.id);
    if (!ctx.rep.has(resolution.id)) ctx.rep.set(resolution.id, null);
    if (!ctx.sourceOf.has(resolution.id)) ctx.sourceOf.set(resolution.id, "auto");
  }
  ctx.aliasTarget.set(row.variant, resolution.id);

  const target = resolveVia(ctx.rep, resolution.id);
  if (target === previous) return { kind: "kept", mergedOrphan: false };

  // Orphan cleanup: the re-point moved the variant off `previous`. When no alias still resolves
  // there and the node is auto-sourced, merge it into the re-decision's resolved node — it
  // leaves the retrieval set and stray references (old sku_cache keys, edges) keep resolving
  // somewhere sane through the representative chain. Never a human node, never one that
  // retains aliases.
  let mergedOrphan = false;
  let stillReferenced = false;
  for (const id of ctx.aliasTarget.values()) {
    if (resolveVia(ctx.rep, id) === previous) {
      stillReferenced = true;
      break;
    }
  }
  if (!stillReferenced && ctx.sourceOf.get(previous) !== "human") {
    await deps.merge(previous, target);
    ctx.rep.set(previous, target);
    mergedOrphan = true;
  }
  return { kind: resolution.node ? "minted" : "repointed", mergedOrphan };
}

/** Turn a contract-valid confirm into the resolution to commit, applying the pick guard. */
function decide(
  deps: AliasAuditDeps,
  row: AliasAuditRow,
  vec: number[],
  ranked: { id: string; score: number }[],
  candidates: ScoredCandidate[],
  confirm: IdentityConfirm,
  previous: string,
  knownIds: Set<string>,
  resolve: (id: string) => string,
): Resolution {
  // No-op keep guard: a NOVEL whose proposed canonical resolves to the STANDING survivor only
  // re-derives the standing mapping — without this, buildResolution would mint the VARIANT
  // verbatim (via the collision fallback, or via the invalid-canonical fallback when the
  // standing id itself fails mint validation, e.g. it contains a comma — the production
  // sockeye id). The RAW trimmed canonical is compared, not just the validated one: mint
  // validation gates what a NEW id may look like, not whether an EXISTING id was re-derived.
  if (confirm.outcome === "novel") {
    const canonical =
      validateCanonicalId(confirm.canonical) ??
      (typeof confirm.canonical === "string" && confirm.canonical.trim() ? confirm.canonical.trim() : null);
    if (canonical && resolve(canonical) === previous) {
      return {
        term: row.variant,
        id: previous,
        edges: [],
        log: {
          term: row.variant,
          outcome: "novel",
          resolved_id: previous,
          candidates: ranked,
          model: NORMALIZE_MODEL,
          detail: { audit: "alias", previous_id: previous, note: "canonical_is_standing", reason: confirm.reason },
        },
      };
    }
  }
  // The pick guard, capture parity: a same/specialization pick whose chosen candidate is
  // distant rejects to a verbatim NOVEL mint — this corrects the below-guard class (flaky sea
  // salt) even when the classifier repeats its old pick. An UNSCORED chosen candidate (only
  // ever the appended unembedded survivor) can't be distance-checked and passes: re-affirming
  // the standing mapping on unverifiable distance keeps it rather than destroys it.
  if ((confirm.outcome === "same" || confirm.outcome === "specialization") && confirm.match) {
    const chosen = candidates.find((c) => c.id === confirm.match);
    if (!chosen || (chosen.score !== undefined && chosen.score < deps.confirmMin)) {
      return brandAudit(
        novelResolution(row.variant, vec, ranked, NORMALIZE_MODEL, {
          note: "confirm_below_min",
          rejected: {
            outcome: confirm.outcome,
            match: confirm.match,
            score: chosen && chosen.score !== undefined ? chosen.score : null,
          },
        }),
        previous,
      );
    }
  }
  return brandAudit(buildResolution(row.variant, vec, ranked, confirm, knownIds), previous);
}

/** The core pass, pure w.r.t. its injected deps (unit-testable without env). */
export async function auditAliases(deps: AliasAuditDeps): Promise<AliasAuditSummary> {
  const now = deps.now();
  const summary = emptySummary();
  const batch = await deps.loadBatch(deps.maxPerTick);
  if (batch.length === 0) return summary; // self-quiesced: backlog drained, no model calls

  // Deterministic pre-filter: a SELF-alias (variant === its node id) is definitionally
  // consistent as a MAPPING — whether the NODE should merge into a synonym is the
  // re-confirm/co-resolution passes' question, not this one's. Stamp free, no model call.
  const rest: AliasAuditRow[] = [];
  for (const row of batch) {
    if (row.variant === row.id) {
      await deps.stamp(row.variant, now);
      summary.self_stamped++;
      summary.audited++;
    } else {
      rest.push(row);
    }
  }
  if (rest.length === 0) return summary;

  const [identities, identityVecs, knownIds, aliasRows] = await Promise.all([
    deps.identities(),
    deps.identityEmbeddings(),
    deps.knownIds(),
    deps.aliasTargets(),
  ]);
  const ctx: AuditContext = {
    rep: new Map(identities.map((r) => [r.id, r.representative])),
    sourceOf: new Map(identities.map((r) => [r.id, r.source])),
    aliasTarget: new Map(aliasRows.map((a) => [a.variant, a.id])),
    identityVecs,
    knownIds,
    lexical: buildLexicalMap(identities),
  };

  // One batched embed of the tick's variants; a chunk failure throws → the whole tick fails
  // (rows stay un-stamped and retry — mirrors the capture job's embed discipline).
  const vecs = await deps.embed(rest.map((r) => r.variant));

  for (let i = 0; i < rest.length; i++) {
    try {
      const res = await auditOne(deps, rest[i], vecs[i], ctx);
      summary.audited++;
      if (res.kind === "kept") summary.kept++;
      else if (res.kind === "minted") summary.minted++;
      else summary.repointed++;
      if (res.mergedOrphan) summary.merged++;
    } catch (e) {
      // Transient (env.AI/D1) → skip the row, leave it un-stamped (retried next tick).
      summary.skipped++;
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[ingredient-alias-audit] skipped "${rest[i].variant}":`, msg);
    }
  }
  return summary;
}

/** Wire the real env for the scheduled handler. */
export function buildAliasAuditDeps(env: Env): AliasAuditDeps {
  return {
    loadBatch: (limit) => readAliasAuditBatch(env, limit),
    aliasTargets: () => readAliasTargets(env),
    identities: () => readIdentitySources(env),
    identityEmbeddings: () => readIdentityEmbeddings(env),
    knownIds: () => readIdentityIds(env),
    embed: (texts) => embedTexts(env, { activity: "embed-ingredient" }, texts),
    confirm: (term, candidates) => confirmIdentity(env, term, candidates),
    commit: (r) => commitResolution(env, r),
    merge: (loser, survivor) => mergeIdentities(env, loser, survivor),
    stamp: (variant, now) => stampAliasAudited(env, variant, now),
    now: () => Date.now(),
    maxPerTick: ALIAS_AUDIT_MAX_PER_TICK,
    confirmMin: NORMALIZE_CONFIRM_MIN,
    topK: NORMALIZE_TOP_K,
  };
}

/**
 * One scheduled run: do the pass, record the `ingredient-alias-audit` job_health + job_run rows,
 * and rethrow so the platform's cron status reflects a hard failure (mirrors runReconfirmJob).
 */
export async function runAliasAuditJob(env: Env, deps: AliasAuditDeps): Promise<void> {
  const startedAt = deps.now();
  try {
    const s = await auditAliases(deps);
    await writeJobHealth(env, ALIAS_AUDIT_JOB, { ok: true, last_run_at: startedAt, summary: { ...s } });
    await writeJobRun(env, ALIAS_AUDIT_JOB, {
      ok: true,
      ran_at: startedAt,
      duration_ms: deps.now() - startedAt,
      summary: { ...s },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[ingredient-alias-audit] pass failed:", msg);
    await writeJobHealth(env, ALIAS_AUDIT_JOB, { ok: false, last_run_at: startedAt, summary: { error: msg } }).catch(
      () => {},
    );
    await writeJobRun(env, ALIAS_AUDIT_JOB, {
      ok: false,
      ran_at: startedAt,
      duration_ms: deps.now() - startedAt,
      summary: { error: msg },
    }).catch(() => {});
    throw e;
  }
}
