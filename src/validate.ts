// Structural pre-commit validation (data-write-tools capability). Runs on
// workerd — the Node index-build validator (scripts/build-indexes.mjs) can't run
// in the Worker, so this reimplements only the STRUCTURAL subset: every staged
// file parses, and enumerated fields hold legal values. Cross-reference / index
// validation stays the post-push build Action's job. Any problem throws
// ToolError("validation_failed") so the commit engine makes no commit.

import { load as loadYaml } from "js-yaml";
import { parse as parseTomlRaw } from "smol-toml";
import { ToolError } from "./errors.js";
import { EQUIPMENT_VOCAB } from "./kitchen.js";

// `archived` is valid but tool-unwritten on purpose: it's the MANUAL
// history-preserving removal state. A recipe with cooking_log history can't be
// deleted (an unresolvable log slug hard-fails the build), so it's hand-archived
// instead — the file persists so history resolves, but it's dropped from active
// rotation (list_recipes default + retrospective "underused"). No agent tool and
// no scheduler ever set it (deliberately: there is no auto-archive). Keep it —
// the data-validation spec enumerates it and overlay/retrospective tests rely on it.
const RECIPE_STATUSES = ["active", "draft", "rejected", "archived"];
const PANTRY_CATEGORIES = ["pantry", "fridge", "freezer", "spices"];
const READY_TO_EAT_STATUSES = ["active", "draft", "rejected"];
const READY_TO_EAT_MEALS = ["breakfast", "lunch", "dinner"];
const GROCERY_STATUSES = ["active", "in_cart", "ordered"];
const GROCERY_KINDS = ["grocery", "household", "other"];
const COOKING_LOG_TYPES = ["recipe", "ready_to_eat", "ad_hoc"];
// EQUIPMENT_VOCAB is the makeability gate's vocabulary (src/kitchen.ts, mirrored in
// scripts/build-indexes.mjs). recipes/*.md `requires_equipment` is NOT vocab-enforced
// here (loose write, the build is the gate); kitchen.toml `owned` IS, since it's read
// at runtime with no build between.
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function fail(path: string, message: string): never {
  throw new ToolError("validation_failed", `${path}: ${message}`, { path });
}

function parseTomlOrFail(path: string, content: string): Record<string, unknown> {
  try {
    return parseTomlRaw(content) as Record<string, unknown>;
  } catch (e) {
    fail(path, `does not parse as TOML — ${e instanceof Error ? e.message : String(e)}`);
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

function items(parsed: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(parsed.items) ? (parsed.items as Record<string, unknown>[]) : [];
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
    // requires_equipment: shape only (array of slugs). Deliberately NOT
    // vocab-checked here — the build is the gate for recipe content (D2), so an
    // off-vocab slug can't reach the index without the build, which fails first.
    if (fm.requires_equipment != null) {
      if (!Array.isArray(fm.requires_equipment) || fm.requires_equipment.some((s) => typeof s !== "string")) {
        fail(path, `\`requires_equipment\` must be an array of equipment slugs (got ${JSON.stringify(fm.requires_equipment)})`);
      }
    }
    return;
  }

  if (path === "pantry.toml") {
    const parsed = parseTomlOrFail(path, content);
    for (const it of items(parsed)) checkEnum(path, "category", it.category, PANTRY_CATEGORIES, false);
    return;
  }

  if (path === "grocery_list.toml") {
    const parsed = parseTomlOrFail(path, content);
    for (const it of items(parsed)) {
      if (typeof it.name !== "string" || it.name.length === 0) {
        fail(path, "item is missing required field `name`");
      }
      checkEnum(path, "status", it.status, GROCERY_STATUSES, true);
      checkEnum(path, "kind", it.kind, GROCERY_KINDS, false);
      // `domain` is a free string (open-vocab, default grocery on read); only the
      // shape is enforced. Absent → read as "grocery" (legacy items validate).
      if (it.domain != null && typeof it.domain !== "string") {
        fail(path, `\`domain\` = ${JSON.stringify(it.domain)} must be a string`);
      }
    }
    return;
  }

  if (path === "cooking_log.toml") {
    const parsed = parseTomlOrFail(path, content);
    const entries = Array.isArray(parsed.entries) ? (parsed.entries as Record<string, unknown>[]) : [];
    for (const e of entries) {
      if (typeof e.date !== "string" || !ISO_DATE_RE.test(e.date)) {
        fail(path, `entry has an invalid or missing \`date\`: ${JSON.stringify(e.date)}`);
      }
      checkEnum(path, "type", e.type, COOKING_LOG_TYPES, true);
      if (e.type === "recipe") {
        if (typeof e.recipe !== "string" || e.recipe.length === 0) {
          fail(path, "recipe entry is missing required field `recipe` (slug)");
        }
      } else if (typeof e.name !== "string" || e.name.length === 0) {
        fail(path, `${String(e.type)} entry is missing required field \`name\``);
      }
    }
    return;
  }

  if (path === "meal_plan.toml") {
    const parsed = parseTomlOrFail(path, content);
    const planned = Array.isArray(parsed.planned) ? (parsed.planned as Record<string, unknown>[]) : [];
    for (const p of planned) {
      if (typeof p.recipe !== "string" || p.recipe.length === 0) {
        fail(path, "planned entry is missing required field `recipe` (slug)");
      }
      if (p.planned_for != null && (typeof p.planned_for !== "string" || !ISO_DATE_RE.test(p.planned_for))) {
        fail(path, `planned entry has an invalid \`planned_for\`: ${JSON.stringify(p.planned_for)}`);
      }
      // `sides` (optional) holds free-text open-world side names riding on the main's
      // row — shape-only (array of strings), never slug-resolved.
      if (p.sides != null && (!Array.isArray(p.sides) || p.sides.some((s) => typeof s !== "string"))) {
        fail(path, `planned entry \`sides\` must be an array of side names (got ${JSON.stringify(p.sides)})`);
      }
    }
    return;
  }

  // Per-tenant ready-to-eat catalog (users/<id>/ready_to_eat.toml, or bare during
  // the single-user bootstrap). Items are slug-keyed and meal-tagged.
  if (path === "ready_to_eat.toml" || path.endsWith("/ready_to_eat.toml")) {
    const parsed = parseTomlOrFail(path, content);
    const slugs = new Set<string>();
    for (const it of items(parsed)) {
      if (typeof it.name !== "string" || it.name.length === 0) {
        fail(path, "item is missing required field `name`");
      }
      if (typeof it.slug !== "string" || it.slug.length === 0) {
        fail(path, "item is missing required field `slug`");
      }
      if (slugs.has(it.slug)) fail(path, `duplicate slug \`${it.slug}\``);
      slugs.add(it.slug);
      checkEnum(path, "meal", it.meal, READY_TO_EAT_MEALS, true);
      checkEnum(path, "status", it.status, READY_TO_EAT_STATUSES, false);
      if (it.rating != null && (typeof it.rating !== "number" || !Number.isInteger(it.rating) || it.rating < 1 || it.rating > 5)) {
        fail(path, `\`rating\` = ${JSON.stringify(it.rating)} must be an integer 1–5`);
      }
    }
    return;
  }

  // Per-tenant kitchen inventory (users/<id>/kitchen.toml, or bare during the
  // single-user bootstrap). `owned` is vocab-enforced (it's the gate's left
  // operand, read at runtime); `[notes]` is freeform (parse-only).
  if (path === "kitchen.toml" || path.endsWith("/kitchen.toml")) {
    const parsed = parseTomlOrFail(path, content);
    if (parsed.owned != null) {
      if (!Array.isArray(parsed.owned)) {
        fail(path, `\`owned\` must be an array of equipment slugs (got ${JSON.stringify(parsed.owned)})`);
      }
      for (const slug of parsed.owned) {
        if (typeof slug !== "string" || !EQUIPMENT_VOCAB.some((v) => v === slug)) {
          fail(path, `\`owned\` slug ${JSON.stringify(slug)} is not one of ${EQUIPMENT_VOCAB.join(" | ")}`);
        }
      }
    }
    return;
  }

  // Shared store registry (stores/<slug>.toml): IDENTITY only. `slug`+`name`
  // required; `domain` a string when present. Layout lives in attributed store
  // notes (store_notes/<slug>.toml), not here — legacy `aisles`/`item_locations`/
  // `doesnt_carry` keys are tolerated and ignored. The build reimplements the same
  // subset (validateStore there).
  if (path.startsWith("stores/") && path.endsWith(".toml")) {
    const parsed = parseTomlOrFail(path, content);
    if (typeof parsed.slug !== "string" || parsed.slug.length === 0) {
      fail(path, "store is missing required field `slug`");
    }
    if (typeof parsed.name !== "string" || parsed.name.length === 0) {
      fail(path, "store is missing required field `name`");
    }
    if (parsed.domain != null && typeof parsed.domain !== "string") {
      fail(path, `\`domain\` must be a string (got ${JSON.stringify(parsed.domain)})`);
    }
    return;
  }

  // Shared email-discovery inbox (root discoveries_inbox.toml): each [[entries]]
  // carries candidates, and every candidate needs a `url`.
  if (path === "discoveries_inbox.toml") {
    const parsed = parseTomlOrFail(path, content);
    const entries = Array.isArray(parsed.entries) ? (parsed.entries as Record<string, unknown>[]) : [];
    for (const e of entries) {
      const cands = Array.isArray(e.candidates) ? (e.candidates as Record<string, unknown>[]) : [];
      for (const c of cands) {
        if (typeof c.url !== "string" || c.url.length === 0) {
          fail(path, "inbox candidate is missing required field `url`");
        }
      }
    }
    return;
  }

  // Shared inbound-newsletter allowlist (root discovery_sources.toml): every
  // member/sender entry needs an `address`.
  if (path === "discovery_sources.toml") {
    const parsed = parseTomlOrFail(path, content);
    for (const key of ["members", "senders"] as const) {
      const rows = Array.isArray(parsed[key]) ? (parsed[key] as Record<string, unknown>[]) : [];
      for (const r of rows) {
        if (typeof r.address !== "string" || !r.address.includes("@")) {
          fail(path, `\`${key}\` entry needs a valid \`address\` (got ${JSON.stringify(r.address)})`);
        }
      }
    }
    return;
  }

  // Other TOML (preferences, aliases, stockup, flyer_terms, …):
  // parse-only — confirm it isn't syntactic garbage before committing.
  if (path.endsWith(".toml")) {
    parseTomlOrFail(path, content);
    return;
  }

  // Freeform markdown (taste.md, diet_principles.md) and anything else: no
  // structural contract to enforce.
}
