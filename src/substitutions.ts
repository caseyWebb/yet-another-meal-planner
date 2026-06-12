// substitutions.toml rule engine (ingredient-substitution capability, tasks
// 4.1–4.2 core). Pure deterministic rule lookup + inventory filtering. The
// sale-mode Kroger filtering lives in the tool wrapper (it needs I/O); this
// module supplies the rule-acceptable candidate list it filters.

import { normalizeIngredient } from "./matching.js";

export interface SubRule {
  ingredient: string;
  acceptable: string[];
  unacceptable: string[];
  notes?: string;
}

export interface SubstitutionResult {
  substitutes: string[];
  unacceptable: string[];
}

function asStrings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** Extract `[[rules]]` from a parsed substitutions.toml document. */
export function parseSubstitutionRules(parsed: Record<string, unknown>): SubRule[] {
  const raw = Array.isArray(parsed.rules) ? (parsed.rules as Record<string, unknown>[]) : [];
  const rules: SubRule[] = [];
  for (const r of raw) {
    if (typeof r.ingredient !== "string") continue;
    rules.push({
      ingredient: r.ingredient,
      acceptable: asStrings(r.acceptable_substitutes),
      unacceptable: asStrings(r.unacceptable_substitutes),
      notes: typeof r.notes === "string" ? r.notes : undefined,
    });
  }
  return rules;
}

/**
 * Join shared substitution rules with a tenant's personal override layer (§7.2).
 * An override rule for an ingredient REPLACES the shared rule for that same
 * (alias-normalized) ingredient — for this tenant only; the shared rule is
 * untouched for everyone else. Override-only ingredients are added. Shared rules
 * with no override carry through unchanged.
 */
export function mergeSubstitutionRules(
  shared: SubRule[],
  override: SubRule[],
  aliases: Record<string, string>,
): SubRule[] {
  const key = (r: SubRule): string => normalizeIngredient(r.ingredient, aliases);
  const overridden = new Set(override.map(key));
  return [...shared.filter((r) => !overridden.has(key(r))), ...override];
}

/** Find the rule for an ingredient, matching on alias-normalized names. */
export function findRule(
  rules: SubRule[],
  ingredient: string,
  aliases: Record<string, string>,
): SubRule | null {
  const key = normalizeIngredient(ingredient, aliases);
  return rules.find((r) => normalizeIngredient(r.ingredient, aliases) === key) ?? null;
}

/**
 * Acceptable substitutes that are present in the pantry (alias-normalized
 * comparison). Used by `propose_substitutions` inventory mode and by verify's
 * `inventory_substitutes_available` bucket.
 */
export function acceptableInPantry(
  rule: SubRule,
  pantryNames: string[],
  aliases: Record<string, string>,
): string[] {
  const present = new Set(pantryNames.map((n) => normalizeIngredient(n, aliases)));
  return rule.acceptable.filter((s) => present.has(normalizeIngredient(s, aliases)));
}

/**
 * propose_substitutions inventory mode (pure). No rule (or empty file) yields an
 * empty, non-error result — the dormant-until-seeded contract.
 */
export function proposeInventory(
  rule: SubRule | null,
  pantryNames: string[],
  aliases: Record<string, string>,
): SubstitutionResult {
  if (!rule) return { substitutes: [], unacceptable: [] };
  return {
    substitutes: acceptableInPantry(rule, pantryNames, aliases),
    unacceptable: rule.unacceptable,
  };
}

/**
 * propose_substitutions sale mode. `isOnSale` is injected (the tool wires it to
 * a Kroger lookup) so the logic stays pure and testable. No rule → empty result
 * (the dormant contract) and no fetch. A rejection from `isOnSale` propagates,
 * surfacing as a structured upstream error at the tool boundary — distinct from
 * the empty no-rules result.
 */
export async function proposeSale(
  rule: SubRule | null,
  isOnSale: (substitute: string) => Promise<boolean>,
): Promise<SubstitutionResult> {
  if (!rule) return { substitutes: [], unacceptable: [] };
  const onSale = await Promise.all(rule.acceptable.map((sub) => isOnSale(sub)));
  const substitutes = rule.acceptable.filter((_, i) => onSale[i]);
  return { substitutes, unacceptable: rule.unacceptable };
}
