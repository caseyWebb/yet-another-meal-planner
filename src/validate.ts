// Structural pre-commit validation (data-write-tools capability). Runs on
// workerd — the Node index-build validator (scripts/build-indexes.mjs) can't run
// in the Worker, so this reimplements only the STRUCTURAL subset: every staged
// file parses, and enumerated fields hold legal values. Cross-reference / index
// validation stays the post-push build Action's job. Any problem throws
// ToolError("validation_failed") so the commit engine makes no commit.

import { load as loadYaml } from "js-yaml";
import { parse as parseTomlRaw } from "smol-toml";
import { ToolError } from "./errors.js";

const RECIPE_STATUSES = ["active", "draft", "rejected", "archived"];
const PANTRY_CATEGORIES = ["pantry", "fridge", "freezer", "spices"];
const READY_TO_EAT_STATUSES = ["active", "draft", "rejected"];
const READY_TO_EAT_MEALS = ["breakfast", "lunch", "dinner"];
const GROCERY_STATUSES = ["active", "in_cart", "ordered"];
const GROCERY_KINDS = ["grocery", "household", "other"];
const COOKING_LOG_TYPES = ["recipe", "ready_to_eat", "ad_hoc"];
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
    // pairs_with (plating edge) is an array of recipe slugs; standalone is an
    // optional boolean gate. Slug *resolution* is the post-push build's job (no
    // corpus on workerd) — here we only enforce the local shape, parallel to status.
    if (fm.pairs_with != null) {
      if (!Array.isArray(fm.pairs_with) || fm.pairs_with.some((s) => typeof s !== "string")) {
        fail(path, `\`pairs_with\` must be an array of recipe slugs (got ${JSON.stringify(fm.pairs_with)})`);
      }
    }
    if (fm.standalone != null && typeof fm.standalone !== "boolean") {
      fail(path, `\`standalone\` must be a boolean (got ${JSON.stringify(fm.standalone)})`);
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

  // Other TOML (preferences, substitutions, aliases, stockup, flyer_terms, …):
  // parse-only — confirm it isn't syntactic garbage before committing.
  if (path.endsWith(".toml")) {
    parseTomlOrFail(path, content);
    return;
  }

  // Freeform markdown (taste.md, diet_principles.md) and anything else: no
  // structural contract to enforce.
}
