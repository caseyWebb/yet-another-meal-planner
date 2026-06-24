// Structural pre-commit validation (data-write-tools capability). Runs on
// workerd — the Node index-build validator (scripts/build-indexes.mjs) can't run
// in the Worker, so this reimplements the STRUCTURAL subset: every staged file
// parses, enumerated fields hold legal values, and recipe controlled-vocabulary
// fields (protein / cuisine / requires_equipment) are vocab-checked against the
// SAME shared definition the build uses (src/vocab.js). Cross-reference / index
// validation (slug resolution) stays the post-push build Action's job — it needs
// the whole corpus. Any problem throws ToolError("validation_failed") so the
// commit engine makes no commit, and the member's agent gets an immediate,
// fixable error instead of a post-push build failure on main.

import { load as loadYaml } from "js-yaml";
import { ToolError } from "./errors.js";
import { PROTEIN_VOCAB, CUISINE_VOCAB, EQUIPMENT_VOCAB } from "./vocab.js";

// `archived` is valid but tool-unwritten on purpose: it's the MANUAL
// history-preserving removal state. A recipe with cooking_log history can't be
// deleted (an unresolvable log slug hard-fails the build), so it's hand-archived
// instead — the file persists so history resolves, but it's dropped from active
// rotation (list_recipes default + retrospective "underused"). No agent tool and
// no scheduler ever set it (deliberately: there is no auto-archive). Keep it —
// the data-validation spec enumerates it and overlay/retrospective tests rely on it.
const RECIPE_STATUSES = ["active", "draft", "rejected", "archived"];
// PROTEIN_VOCAB / CUISINE_VOCAB / EQUIPMENT_VOCAB come from the single shared
// source (src/vocab.js) that scripts/build-indexes.mjs also imports — so the
// write-time gate and the build-time gate cannot disagree. recipes/*.md
// protein / cuisine / requires_equipment ARE vocab-enforced here now (an off-vocab
// value can otherwise only be caught post-push, where it breaks the public site
// deploy and the index regen with no signal to the agent). A `none`/empty
// protein|cuisine is normalized to absent upstream in the write path
// (src/serialize.ts), so it never reaches this check.

function fail(path: string, message: string): never {
  throw new ToolError("validation_failed", `${path}: ${message}`, { path });
}

// kebab-case location slug; anchored so it also rejects path traversal.
const STORE_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Write-time store-identity validation (moved off the build into the Worker, slice 6).
 * `slug` must be kebab-case; `name` required; `domain` a non-empty string when given.
 * Throws ToolError("validation_failed") so add_store / update_store make no write.
 */
export function validateStoreInput(input: {
  slug: string;
  name: string;
  domain?: string;
}): void {
  if (!STORE_SLUG_RE.test(input.slug)) {
    throw new ToolError("validation_failed", `Invalid store slug: ${input.slug}`, { slug: input.slug });
  }
  if (typeof input.name !== "string" || !input.name.trim()) {
    throw new ToolError("validation_failed", "store name must not be empty", { slug: input.slug });
  }
  if (input.domain != null && (typeof input.domain !== "string" || !input.domain.trim())) {
    throw new ToolError("validation_failed", `\`domain\` must be a non-empty string`, { slug: input.slug });
  }
}

/**
 * Write-time discovery-candidate validation (the email-ingest inbox writer, slice 6).
 * A candidate needs a non-empty `url`. Throws ToolError("validation_failed").
 */
export function validateDiscoveryCandidate(cand: { url: string }): void {
  if (typeof cand.url !== "string" || !cand.url.length) {
    throw new ToolError("validation_failed", "inbox candidate is missing required field `url`", {});
  }
}

function parseFrontmatterOrFail(path: string, content: string): Record<string, unknown> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content);
  if (!match) fail(path, "missing leading --- frontmatter fence");
  try {
    const parsed = loadYaml(match[1]);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch (e) {
    fail(path, `frontmatter is not valid YAML — ${e instanceof Error ? e.message : String(e)}`);
  }
}

function checkEnum(
  path: string,
  field: string,
  value: unknown,
  legal: string[],
  required: boolean,
): void {
  if (value === undefined || value === null) {
    if (required) fail(path, `item is missing required field \`${field}\``);
    return;
  }
  if (typeof value !== "string" || !legal.includes(value)) {
    fail(path, `\`${field}\` = ${JSON.stringify(value)} is not one of ${legal.join(" | ")}`);
  }
}

/**
 * Validate one staged file's full new content by path. Throws
 * ToolError("validation_failed") on any structural problem; returns on success.
 */
export function validateFile(path: string, content: string): void {
  if (path.startsWith("recipes/") && path.endsWith(".md")) {
    const fm = parseFrontmatterOrFail(path, content);
    if ("status" in fm) checkEnum(path, "status", fm.status, RECIPE_STATUSES, false);
    // pairs_with (plating edge) is an array of recipe slugs; course is an
    // open-vocabulary facet (a string or array of strings). Slug *resolution* and
    // course *value* policy are the post-push build's job (no corpus on workerd) —
    // here we only enforce local shape, parallel to status. (`standalone` is retired:
    // no longer recognized, so a lingering value passes through untouched.)
    if (fm.pairs_with != null) {
      if (!Array.isArray(fm.pairs_with) || fm.pairs_with.some((s) => typeof s !== "string")) {
        fail(path, `\`pairs_with\` must be an array of recipe slugs (got ${JSON.stringify(fm.pairs_with)})`);
      }
    }
    if (
      fm.course != null &&
      typeof fm.course !== "string" &&
      !(Array.isArray(fm.course) && fm.course.every((c) => typeof c === "string"))
    ) {
      fail(path, `\`course\` must be a string or an array of strings (got ${JSON.stringify(fm.course)})`);
    }
    // description (semantic-meal-plan) is the AI-written brief summary that seeds the
    // recipe embedding and the compact candidate row — a non-empty string when present.
    if (fm.description != null && (typeof fm.description !== "string" || fm.description.trim() === "")) {
      fail(path, `\`description\` must be a non-empty string (got ${JSON.stringify(fm.description)})`);
    }
    // side_search_terms (semantic-meal-plan) are AI-memoized phrases describing the
    // kind of side that complements a main; the semantic side-retrieval query.
    if (fm.side_search_terms != null) {
      if (
        !Array.isArray(fm.side_search_terms) ||
        fm.side_search_terms.some((s) => typeof s !== "string")
      ) {
        fail(
          path,
          `\`side_search_terms\` must be an array of strings (got ${JSON.stringify(fm.side_search_terms)})`,
        );
      }
    }
    // perishable_ingredients (objective shared content) is a normalized array of
    // ingredient names; same shape-only check as pairs_with (no corpus on workerd).
    if (fm.perishable_ingredients != null) {
      if (
        !Array.isArray(fm.perishable_ingredients) ||
        fm.perishable_ingredients.some((s) => typeof s !== "string")
      ) {
        fail(
          path,
          `\`perishable_ingredients\` must be an array of ingredient names (got ${JSON.stringify(fm.perishable_ingredients)})`,
        );
      }
    }
    // Controlled vocabularies (protein / cuisine / requires_equipment) are
    // enforced HERE at the write boundary AND in the Node build validator, both
    // drawing from the single shared definition (src/vocab.js), so an off-vocab
    // value is a fixable error the agent sees immediately instead of a post-push
    // build failure on main. Checked only WHEN PRESENT; absence stays warn-only
    // (a no-protein dish is legitimately field-absent — `none`/empty is already
    // normalized to absent in the write path before it reaches here).
    if (fm.protein != null && !(typeof fm.protein === "string" && PROTEIN_VOCAB.includes(fm.protein))) {
      fail(path, `\`protein\` = ${JSON.stringify(fm.protein)} is not in the controlled vocabulary (one of ${PROTEIN_VOCAB.join(" | ")})`);
    }
    if (fm.cuisine != null && !(typeof fm.cuisine === "string" && CUISINE_VOCAB.includes(fm.cuisine))) {
      fail(path, `\`cuisine\` = ${JSON.stringify(fm.cuisine)} is not in the controlled vocabulary (one of ${CUISINE_VOCAB.join(" | ")})`);
    }
    // requires_equipment: an array of EQUIPMENT_VOCAB slugs. Shape first, then
    // vocab (an off-vocab slug silently hides a makeable recipe, so reject it at
    // write rather than post-push).
    if (fm.requires_equipment != null) {
      if (!Array.isArray(fm.requires_equipment) || fm.requires_equipment.some((s) => typeof s !== "string")) {
        fail(path, `\`requires_equipment\` must be an array of equipment slugs (got ${JSON.stringify(fm.requires_equipment)})`);
      }
      for (const slug of fm.requires_equipment as string[]) {
        if (!EQUIPMENT_VOCAB.includes(slug)) {
          fail(path, `\`requires_equipment\` slug ${JSON.stringify(slug)} is not in the controlled vocabulary (one of ${EQUIPMENT_VOCAB.join(" | ")})`);
        }
      }
    }
    return;
  }

  // After d1-shared-corpus (slice 6), recipes/*.md are the ONLY files the commit
  // engine ever writes — every other artifact (profile, session, cooking log, and the
  // whole shared corpus: stores, notes, aliases, feeds, discovery, SKU cache, flyer
  // terms) is a D1 table written + validated at its own write tool, NOT committed to
  // GitHub. So there is no non-recipe file to structurally validate here. The former
  // store/discovery/inbox TOML checks moved to write-time validators above
  // (validateStoreInput / validateDiscoveryCandidate). Anything else (freeform
  // markdown like taste.md): no structural contract to enforce.
}
