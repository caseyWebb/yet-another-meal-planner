// Preferences merge-patch + validation (data-write-tools, d1-profile). Preferences
// have a defined top-level surface (the keys real code reads) plus an open `custom`
// bag. `update_preferences` takes a `patch` and applies it with JSON Merge Patch
// semantics (RFC 7396): a present key sets, `null` deletes, nested objects merge to
// any depth, arrays replace wholesale. Validation is STAGED: unknown top-level patch
// keys are rejected at authorship time (toward `custom`); the merged RESULT's types
// are validated before anything is stored. Each brands family value is a tier object
// `{ tiers, any_brand }`; the confidence tri-state rides the merge directly — row
// absent = ambiguous/ask, `{ tiers: [], any_brand: true }` = don't-care/cheapest,
// non-empty `tiers` = the preference ladder — value vs `null`.
//
// The apply onto D1 rows lives in the tool (src/write-tools.ts) + src/profile-db.ts;
// this module is the pure merge + validation, so it is unit-testable off `workerd`.

import { ToolError } from "./errors.js";

// --- brand tiers ---------------------------------------------------------------

/**
 * The canonical per-family brand preference: `tiers` is an ordered ladder of tiers,
 * each a non-empty list of equally-acceptable brands (within a tier, cheapest wins;
 * earlier tiers are tried first); `any_brand: true` means "after the tiers (if any)
 * are exhausted, take the cheapest acceptable instead of asking". Reads always carry
 * BOTH fields; `{ tiers: [], any_brand: true }` is the don't-care state, and the
 * all-empty `{ tiers: [], any_brand: false }` is unrepresentable (`null` clears).
 */
export interface BrandTierPref {
  tiers: string[][];
  any_brand: boolean;
}

/**
 * One tool-return warning entry (the D21 deprecation convention): a write that was
 * ACCEPTED under a deprecated shape/key and converted, steering the caller to the
 * current form. Shared shape across tools — `warnings` is additive on a success
 * return, never an error.
 */
export interface DeprecationWarning {
  key: string;
  reason: string;
  superseded_by: string;
}

/**
 * Convert a legacy flat rank list to the tier object (the one-window deprecated-shape
 * shim, same mapping as migration 0049): `[]` → don't-care; each rank → its own
 * singleton tier in order. Shared by the write path's accept-and-convert window and
 * the tests' migration fixtures.
 */
export function convertLegacyBrandRanks(ranks: string[]): BrandTierPref {
  if (ranks.length === 0) return { tiers: [], any_brand: true };
  return { tiers: ranks.map((r) => [r]), any_brand: false };
}

/** Canonicalize a validated family value: both fields present, defaults applied. */
export function canonicalBrandValue(value: Record<string, unknown>): BrandTierPref {
  return {
    tiers: Array.isArray(value.tiers) ? (value.tiers as string[][]) : [],
    any_brand: value.any_brand === true,
  };
}

/** The defined top-level preference keys (everything else nests under `custom`). */
export const DEFINED_PREFERENCE_KEYS = [
  "default_cooking_nights",
  "planning_cadence_days",
  "lunch_strategy",
  "ready_to_eat_default_action",
  "weekly_budget",
  "stores",
  "brands",
  "dietary",
  "rotation",
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
  if ("planning_cadence_days" in merged) {
    const v = merged.planning_cadence_days;
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) {
      fail(`planning_cadence_days must be a positive number (got ${JSON.stringify(v)})`);
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
  if ("weekly_budget" in merged) {
    const v = merged.weekly_budget;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
      fail(`weekly_budget must be a number >= 0, in dollars per week (got ${JSON.stringify(v)})`);
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
    if (!isPlainObject(brands)) {
      fail(`brands must be a map of term → { tiers, any_brand } (got ${JSON.stringify(brands)})`);
    }
    for (const [term, val] of Object.entries(brands as Record<string, unknown>)) {
      validateBrandTierValue(term, val);
    }
  }
  if ("rotation" in merged) {
    const rotation = merged.rotation;
    if (!isPlainObject(rotation)) fail(`rotation must be an object (got ${JSON.stringify(rotation)})`);
    for (const k of ["resurface_after_days", "novelty_boost"]) {
      if (k in (rotation as Record<string, unknown>)) {
        const v = (rotation as Record<string, unknown>)[k];
        if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) {
          fail(`rotation.${k} must be a positive number (got ${JSON.stringify(v)})`);
        }
      }
    }
  }
  if ("custom" in merged && !isPlainObject(merged.custom)) {
    fail(`custom must be an object (got ${JSON.stringify(merged.custom)})`);
  }
}

/**
 * Validate one merged brands family value as a tier object. Throws `malformed_data`
 * on: a non-object value (a flat rank list is the retired shape — the write path's
 * one-window shim converts it BEFORE the merge, so an array reaching here is a type
 * error), an unknown key (a typo'd field would otherwise be silently dropped by the
 * canonical UPSERT), a non-array-of-non-empty-string-arrays `tiers` (no empty tier —
 * the UI collapses an emptied one), a brand appearing in more than one tier of the
 * family (case-insensitive — two ranks for one brand is contradictory), a non-boolean
 * `any_brand`, or the all-empty value (`null` is the one way to clear a family).
 */
function validateBrandTierValue(term: string, val: unknown): void {
  const fail = (message: string): never => {
    throw new ToolError("malformed_data", message);
  };
  if (val === null || typeof val !== "object" || Array.isArray(val)) {
    fail(`brands.${term} must be a tier object { tiers: string[][], any_brand: boolean } (got ${JSON.stringify(val)})`);
  }
  const family = val as Record<string, unknown>;
  for (const key of Object.keys(family)) {
    if (key !== "tiers" && key !== "any_brand") {
      fail(`brands.${term}.${key} is not a brand-preference field — a family value carries only tiers and any_brand`);
    }
  }
  if ("any_brand" in family && typeof family.any_brand !== "boolean") {
    fail(`brands.${term}.any_brand must be a boolean (got ${JSON.stringify(family.any_brand)})`);
  }
  const tiers = "tiers" in family ? family.tiers : [];
  if (!Array.isArray(tiers)) {
    fail(`brands.${term}.tiers must be an array of tiers (got ${JSON.stringify(tiers)})`);
  }
  const seen = new Map<string, string>();
  for (const tier of tiers as unknown[]) {
    if (!Array.isArray(tier) || tier.length === 0) {
      fail(`brands.${term}.tiers must contain only non-empty arrays of brand names (got tier ${JSON.stringify(tier)})`);
    }
    for (const brand of tier as unknown[]) {
      if (typeof brand !== "string" || brand.length === 0) {
        fail(`brands.${term} brand names must be non-empty strings (got ${JSON.stringify(brand)})`);
      }
      const name = brand as string;
      const folded = name.toLowerCase();
      if (seen.has(folded)) {
        fail(`brands.${term} lists "${name}" in more than one tier — a brand belongs to at most one tier of a family`);
      }
      seen.set(folded, name);
    }
  }
  if ((tiers as unknown[]).length === 0 && family.any_brand !== true) {
    fail(`brands.${term} is empty ({ tiers: [], any_brand: false } expresses nothing) — set the family to null to clear it back to ambiguous`);
  }
}
