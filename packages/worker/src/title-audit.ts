// The corpus TITLE RE-AUDIT pass (recipe-title-audit). The naming contract (recipe-import,
// "Clean titles and globally-unique slugs") reached the unattended discovery leg only with
// clean-discovery-import-titles, so the pre-existing corpus carries flowery imported titles
// ("A Better Beer Can Chicken", "Our Go-To Side Salad"). This pass converges them through the
// pipeline — never a hand-edit: each tick it drains a bounded batch of un-audited projected
// recipes (no `title_audit` stamp row), runs the same guarded title-clean judgment the
// discovery import uses (the small classifier model + the deterministic word-subset guard,
// fail-open), rewrites ONLY the frontmatter `title` through the established parse → serialize
// → validateFile funnel when the accepted clean title differs, and stamps a one-shot
// `title_audit` row (`audited_at` pattern; outcome `kept` | `cleaned` with the before/after
// titles as the audit trail).
//
// A recipe whose model call succeeds is ALWAYS stamped — `cleaned` on an accepted rewrite,
// `kept` otherwise (same title, guard-rejected output, or a rewrite that fails the contract) —
// so no row can loop; only a transient infrastructure error (env.AI/D1/R2) leaves a row
// un-stamped for a later tick. New imports are BORN-STAMPED by both write paths (the sweep's
// import and create_recipe), so the backlog is exactly the pre-existing corpus and the pass
// quiesces to a ~0-LLM no-op once drained. Slugs are IMMUTABLE ids — the R2 object path and
// the soft join key for favorites, cooking logs, meal plans, notes, and discovery attribution
// — so the pass never renames a slug or moves an object; title convergence changes the display
// name only, and the rewrite reaches the index/description/embedding organically (the
// projection re-indexes it next phase; the recipe-derived content_hash covers the title).
//
// Failure handling and shape mirror the sibling audit passes (ingredient-alias-audit): logic
// split from I/O (injected deps), bounded per tick, riding the internal env.AI/D1 budget with
// no external subrequests, health-recorded as `title-audit`.

import type { Env } from "./env.js";
import type { CorpusStore } from "./corpus-store.js";
import { createR2CorpusStore } from "./corpus-store.js";
import { db } from "./db.js";
import { ToolError } from "./errors.js";
import { cleanedTitleOrFallback, CLASSIFY_MODEL } from "./discovery-classify.js";
import { parseMarkdown } from "./parse.js";
import { serializeMarkdown } from "./serialize.js";
import { validateFile } from "./validate.js";
import { writeJobHealth, writeJobRun } from "./health.js";

/** The background-job name the pass records its health + per-run history under. */
export const TITLE_AUDIT_JOB = "title-audit";

/** Recipes audited per scheduled tick (one small env.AI call each — bounded like the alias
 *  audit; a 205-recipe backlog drains in ≈21 ticks on the 5-minute cron, then ~0 forever). */
export const TITLE_AUDIT_MAX_PER_TICK = 10;

/** One projected recipe awaiting its title audit (no `title_audit` row yet). */
export interface TitleAuditBacklogRow {
  slug: string;
  title: string;
}

/** One `title_audit` stamp: the one-shot outcome + the before/after audit trail. */
export interface TitleAuditStamp {
  slug: string;
  outcome: "kept" | "cleaned";
  /** The title as it stood when audited (or at birth, for a born-stamp). */
  before?: string | null;
  /** The rewritten title (cleaned outcomes only). */
  after?: string | null;
}

export interface TitleAuditDeps {
  /** The un-audited backlog: projected slugs+titles with no stamp row, slug ASC, bounded. */
  loadBacklog(limit: number): Promise<TitleAuditBacklogRow[]>;
  /** How many projected recipes still lack a stamp (the health summary's `remaining`). */
  remaining(): Promise<number>;
  /** Read `recipes/<slug>.md` from the corpus store; null when the object vanished. */
  readRecipe(slug: string): Promise<string | null>;
  /** Persist a rewritten (already-validated) recipe file back to the corpus store. */
  writeRecipe(slug: string, content: string): Promise<void>;
  /** One small env.AI title-clean call: the model's PROPOSED title (unknown — the pass guards
   *  it). Throws only on a transient infrastructure error; unparseable output resolves to a
   *  non-string (→ the guard keeps the current title, stamped `kept`, never a loop). */
  cleanTitle(title: string, grounding: string): Promise<unknown>;
  /** Stamp the one-shot `title_audit` row. */
  stamp(row: TitleAuditStamp, now: number): Promise<void>;
  now(): number;
  maxPerTick: number;
}

export interface TitleAuditSummary {
  /** Recipes reaching a terminal stamped state this tick. */
  audited: number;
  /** Titles rewritten (frontmatter `title` only; slug/path untouched). */
  cleaned: number;
  /** Titles kept (already clean, guard-rejected output, or a contract-failing rewrite). */
  kept: number;
  /** Rows skipped on a transient error (un-stamped; retried next tick). */
  skipped: number;
  /** Un-audited backlog remaining after this tick (0 = quiesced). */
  remaining: number;
}

/** Compact grounding excerpt for the title-clean call: the first lines of the body's
 *  `## Ingredients` section (what the dish is made of — enough to tell identity from
 *  marketing), capped so the call stays small. */
export function groundingExcerpt(body: string, maxChars = 400): string {
  const m = /^##\s+Ingredients\s*$/m.exec(body);
  const from = m ? m.index + m[0].length : 0;
  return body.slice(from).trim().slice(0, maxChars);
}

/**
 * The core pass, pure w.r.t. its injected deps (unit-testable without env). Per backlog
 * recipe: read the file (vanished → skip un-stamped; the projection prunes its row next
 * tick), one title-clean model call, the word-subset guard; accepted-and-different →
 * rewrite ONLY `frontmatter.title` (parse → serialize → validateFile) and stamp `cleaned`;
 * otherwise stamp `kept`. Only a transient error leaves a row un-stamped.
 */
export async function auditTitles(deps: TitleAuditDeps): Promise<TitleAuditSummary> {
  const summary: TitleAuditSummary = { audited: 0, cleaned: 0, kept: 0, skipped: 0, remaining: 0 };
  const batch = await deps.loadBacklog(deps.maxPerTick);

  for (const row of batch) {
    try {
      const path = `recipes/${row.slug}.md`;
      const text = await deps.readRecipe(row.slug);
      if (text === null) continue; // vanished from R2 — the projection drops its row next tick
      const { frontmatter, body } = parseMarkdown(text, path);
      const current = typeof frontmatter.title === "string" ? frontmatter.title : row.title;

      // The model call (transient failure throws → the catch below skips, un-stamped). From
      // here on, a successful call ALWAYS resolves to a stamp — no poison row can loop.
      const proposed = await deps.cleanTitle(current, groundingExcerpt(body));
      const accepted = cleanedTitleOrFallback(current, proposed);

      let rewrite: string | null = null;
      if (accepted !== current) {
        frontmatter.title = accepted; // the ONLY field touched; slug/path never renamed
        const content = serializeMarkdown(frontmatter, body);
        try {
          validateFile(path, content);
          rewrite = content;
        } catch {
          rewrite = null; // a contract-failing rewrite keeps the standing file → stamp kept
        }
      }

      if (rewrite !== null) {
        await deps.writeRecipe(row.slug, rewrite);
        await deps.stamp({ slug: row.slug, outcome: "cleaned", before: current, after: accepted }, deps.now());
        summary.cleaned++;
      } else {
        await deps.stamp({ slug: row.slug, outcome: "kept", before: current }, deps.now());
        summary.kept++;
      }
      summary.audited++;
    } catch (e) {
      // Transient (env.AI/D1/R2) → skip the row, leave it un-stamped (retried next tick).
      summary.skipped++;
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[title-audit] skipped "${row.slug}":`, msg);
    }
  }

  summary.remaining = await deps.remaining();
  return summary;
}

// --- D1 accessors (via src/db.ts — throw-free storage_error discipline) --------------------

/** The un-audited backlog: projected recipes with no `title_audit` stamp, slug ASC. Recipes
 *  currently failing projection (`reconcile_errors`) are naturally deferred until they index —
 *  the audit must not touch a file that fails the contract. */
export async function loadTitleAuditBacklog(env: Env, limit: number): Promise<TitleAuditBacklogRow[]> {
  return db(env).all<TitleAuditBacklogRow>(
    "SELECT slug, title FROM recipes WHERE slug NOT IN (SELECT slug FROM title_audit) ORDER BY slug LIMIT ?1",
    limit,
  );
}

/** Stamp (upsert) a `title_audit` row — the pass's terminal write AND the import paths'
 *  born-stamp (both write paths stamp `kept` at create, so post-change writes never enter
 *  the backlog). Upsert so a re-created slug refreshes its stamp rather than erroring. */
export async function stampTitleAudit(env: Env, row: TitleAuditStamp, now: number): Promise<void> {
  await db(env).run(
    "INSERT INTO title_audit (slug, audited_at, outcome, before_title, after_title) VALUES (?1, ?2, ?3, ?4, ?5) " +
      "ON CONFLICT(slug) DO UPDATE SET audited_at = excluded.audited_at, outcome = excluded.outcome, " +
      "before_title = excluded.before_title, after_title = excluded.after_title",
    row.slug,
    now,
    row.outcome,
    row.before ?? null,
    row.after ?? null,
  );
}

/** Count of projected recipes still lacking a stamp (the summary's `remaining`; 0 = quiesced). */
export async function countTitleAuditRemaining(env: Env): Promise<number> {
  const row = await db(env).first<{ n: number }>(
    "SELECT COUNT(*) AS n FROM recipes WHERE slug NOT IN (SELECT slug FROM title_audit)",
  );
  return row?.n ?? 0;
}

// --- the title-clean model call + real-deps wiring ------------------------------------------

const TITLE_CLEAN_PROMPT = [
  "You clean one recipe title to its plain dish name for a home-cooking app's index. Strip SEO suffixes (a trailing or embedded \"Recipe\"), marketing qualifiers (\"the best\", \"easy\", \"homemade\", \"classic\", superlatives like \"super soft and tender\"), and editorial framing (\"A Better X\", \"Our Go-To X\", \"Summer Dinner Recipe: X\", \"(Inspired By ...)\").",
  "Only REMOVE words — never add or substitute one. KEEP identity-bearing words that change what the dish IS: dietary qualifiers (\"Vegan\", \"Vegetarian\"), method qualifiers (\"Slow Cooker\", \"Grilled\"), and named variants. KEEP a foreign dish name over its English gloss, and KEEP an informative parenthetical gloss (\"Jatjuk (Pine Nut Porridge)\" stays as-is). When unsure, return the title unchanged.",
  'You are given the title and an ingredients excerpt for grounding. Output ONLY a JSON object: {"title": "<the clean dish name>"} — no prose, no markdown fence.',
].join("\n");

// Few-shot anchors: a flowery title resolves to the dish name; an identity qualifier and a
// glossed foreign name come back UNCHANGED (the model learns not to rewrite clean titles).
const TITLE_CLEAN_FEW_SHOT: Array<{ title: string; grounding: string; output: string }> = [
  {
    title: "A Better Beer Can Chicken",
    grounding: "- 1 whole chicken\n- 1 can lager\n- smoked paprika rub",
    output: "Beer Can Chicken",
  },
  {
    title: "Vegan Meatballs",
    grounding: "- lentils\n- mushrooms\n- breadcrumbs",
    output: "Vegan Meatballs",
  },
  {
    title: "Jatjuk (Pine Nut Porridge)",
    grounding: "- pine nuts\n- short-grain rice",
    output: "Jatjuk (Pine Nut Porridge)",
  },
];

/** Lenient JSON-object extraction (same tolerance as the classifier's parseFacets). */
function parseTitleResponse(response: unknown): unknown {
  if (response && typeof response === "object") return (response as Record<string, unknown>).title;
  if (typeof response !== "string") return null;
  const t = response.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const s = t.indexOf("{");
  const e = t.lastIndexOf("}");
  if (s === -1 || e === -1) return null;
  try {
    const v = JSON.parse(t.slice(s, e + 1));
    return v && typeof v === "object" ? (v as Record<string, unknown>).title : null;
  } catch {
    return null;
  }
}

/** One title-clean call on the classifier's model binding. Throws a structured `storage_error`
 *  on an AI failure (transient — the pass skips the row); unparseable output returns a
 *  non-string, which the guard resolves to keep (stamped, never a loop). */
async function cleanTitleAI(env: Env, title: string, grounding: string): Promise<unknown> {
  const messages = [
    { role: "system", content: TITLE_CLEAN_PROMPT },
    ...TITLE_CLEAN_FEW_SHOT.flatMap((ex) => [
      { role: "user", content: `Title: ${ex.title}\nIngredients:\n${ex.grounding}` },
      { role: "assistant", content: JSON.stringify({ title: ex.output }) },
    ]),
    { role: "user", content: `Title: ${title}\nIngredients:\n${grounding}` },
  ];
  let res: { response?: unknown };
  try {
    res = (await env.AI.run(CLASSIFY_MODEL, { messages, max_tokens: 80, temperature: 0.1 })) as {
      response?: unknown;
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new ToolError("storage_error", `Workers AI title clean failed: ${message}`, { model: CLASSIFY_MODEL });
  }
  return parseTitleResponse(res?.response);
}

/** Wire the real D1 + R2 + Workers AI clients for the scheduled handler. */
export function buildTitleAuditDeps(env: Env, corpus?: CorpusStore): TitleAuditDeps {
  const store = corpus ?? createR2CorpusStore(env.CORPUS);
  return {
    loadBacklog: (limit) => loadTitleAuditBacklog(env, limit),
    remaining: () => countTitleAuditRemaining(env),
    readRecipe: (slug) => store.getFile(`recipes/${slug}.md`),
    writeRecipe: (slug, content) => store.put(`recipes/${slug}.md`, content),
    cleanTitle: (title, grounding) => cleanTitleAI(env, title, grounding),
    stamp: (row, now) => stampTitleAudit(env, row, now),
    now: () => Date.now(),
    maxPerTick: TITLE_AUDIT_MAX_PER_TICK,
  };
}

/**
 * One scheduled run: do the pass, record the `title-audit` job_health + job_run rows
 * (counts only, tenant-data-free; transient skips surface in the summary), and rethrow a
 * hard failure so the platform's cron status reflects it (mirrors runAliasAuditJob).
 */
export async function runTitleAuditJob(env: Env, deps: TitleAuditDeps): Promise<void> {
  const startedAt = deps.now();
  try {
    const s = await auditTitles(deps);
    await writeJobHealth(env, TITLE_AUDIT_JOB, { ok: true, last_run_at: startedAt, summary: { ...s } });
    await writeJobRun(env, TITLE_AUDIT_JOB, {
      ok: true,
      ran_at: startedAt,
      duration_ms: deps.now() - startedAt,
      summary: { ...s },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[title-audit] pass failed:", msg);
    await writeJobHealth(env, TITLE_AUDIT_JOB, { ok: false, last_run_at: startedAt, summary: { error: msg } }).catch(
      () => {},
    );
    await writeJobRun(env, TITLE_AUDIT_JOB, {
      ok: false,
      ran_at: startedAt,
      duration_ms: deps.now() - startedAt,
      summary: { error: msg },
    }).catch(() => {});
    throw e;
  }
}
