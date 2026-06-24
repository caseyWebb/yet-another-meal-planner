// Preferences merge-patch + validation (data-write-tools, d1-profile). Preferences
// have a defined top-level surface (the keys real code reads) plus an open `custom`
// bag. `update_preferences` takes a `patch` and applies it with JSON Merge Patch
// semantics (RFC 7396): a present key sets, `null` deletes, nested objects merge to
// any depth, arrays replace wholesale. Validation is STAGED: unknown top-level patch
// keys are rejected at authorship time (toward `custom`); the merged RESULT's types
// are validated before anything is stored. The brands tri-state (absent = ambiguous,
// `[]` = don't-care, non-empty = ranked) rides the merge directly — value vs `null`.
//
// The apply onto D1 rows lives in the tool (src/write-tools.ts) + src/profile-db.ts;
// this module is the pure merge + validation, so it is unit-testable off `workerd`.

import { ToolError } from "./errors.js";

/** The defined top-level preference keys (everything else nests under `custom`). */
export const DEFINED_PREFERENCE_KEYS = [
  "default_cooking_nights",
  "lunch_strategy",
  "ready_to_eat_default_action",
  "stores",
  "brands",
  "dietary",
  "custom",
] as const;

const LUNCH_STRATEGIES = ["leftovers", "buy", "mixed"];
const READY_TO_EAT_ACTIONS = ["opt-in", "auto-add"];

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Apply a JSON Merge Patch (RFC 7396) of `patch` onto `target`, returning a NEW
 * value. A `null` patch value deletes the key; a nested object merges recursively;
 * any non-object patch value (including arrays) replaces wholesale.
 */
export function mergePatch(target: unknown, patch: unknown): unknown {
  if (!isPlainObject(patch)) return patch;
  const base: Record<string, unknown> = isPlainObject(target) ? { ...target } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete base[key];
    } else {
      base[key] = mergePatch(base[key], value);
    }
  }
  return base;
}

/** Reject a patch whose top-level keys aren't in the defined surface (toward `custom`). */
export function rejectUnknownPatchKeys(patch: Record<string, unknown>): void {
  const defined = new Set<string>(DEFINED_PREFERENCE_KEYS);
  for (const key of Object.keys(patch)) {
    if (!defined.has(key)) {
      throw new ToolError(
        "validation_failed",
        `unknown preference key '${key}' — nest it under custom (e.g. patch.custom.${key})`,
        { key },
      );
    }
  }
}

/**
 * Validate the merged preferences' types. Throws `malformed_data` on any type error
 * (so the caller stores nothing). Defined keys are type-checked; `custom` must be an
 * object; absent keys are fine.
 */
export function validatePreferences(merged: Record<string, unknown>): void {
  const fail = (message: string): never => {
    throw new ToolError("malformed_data", message);
  };

  if ("default_cooking_nights" in merged) {
    const v = merged.default_cooking_nights;
    if (typeof v !== "number" || !Number.isFinite(v)) {
      fail(`default_cooking_nights must be a number (got ${JSON.stringify(v)})`);
    }
  }
  if ("lunch_strategy" in merged) {
    const v = merged.lunch_strategy;
    if (typeof v !== "string" || !LUNCH_STRATEGIES.includes(v)) {
      fail(`lunch_strategy must be one of ${LUNCH_STRATEGIES.join(" | ")} (got ${JSON.stringify(v)})`);
    }
  }
  if ("ready_to_eat_default_action" in merged) {
    const v = merged.ready_to_eat_default_action;
    if (typeof v !== "string" || !READY_TO_EAT_ACTIONS.includes(v)) {
      fail(
        `ready_to_eat_default_action must be one of ${READY_TO_EAT_ACTIONS.join(" | ")} (got ${JSON.stringify(v)})`,
      );
    }
  }
  if ("stores" in merged) {
    const stores = merged.stores;
    if (!isPlainObject(stores)) fail(`stores must be an object (got ${JSON.stringify(stores)})`);
    for (const [k, val] of Object.entries(stores as Record<string, unknown>)) {
      if (typeof val !== "string") fail(`stores.${k} must be a string (got ${JSON.stringify(val)})`);
    }
  }
  if ("dietary" in merged) {
    const dietary = merged.dietary;
    if (!isPlainObject(dietary)) fail(`dietary must be an object (got ${JSON.stringify(dietary)})`);
    for (const [k, val] of Object.entries(dietary as Record<string, unknown>)) {
      if (!Array.isArray(val) || val.some((s) => typeof s !== "string")) {
        fail(`dietary.${k} must be an array of strings (got ${JSON.stringify(val)})`);
      }
    }
  }
  if ("brands" in merged) {
    const brands = merged.brands;
    if (!isPlainObject(brands)) fail(`brands must be a map of term → string[] (got ${JSON.stringify(brands)})`);
    for (const [term, val] of Object.entries(brands as Record<string, unknown>)) {
      if (!Array.isArray(val) || val.some((s) => typeof s !== "string")) {
        fail(`brands.${term} must be an array of brand names (got ${JSON.stringify(val)})`);
      }
    }
  }
  if ("custom" in merged && !isPlainObject(merged.custom)) {
    fail(`custom must be an object (got ${JSON.stringify(merged.custom)})`);
  }
}
