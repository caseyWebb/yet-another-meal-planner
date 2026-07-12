export type PantryFreshness = "covered" | "worth_a_look";

/** One server-owned threshold table used by every pantry freshness consumer. */
export const PANTRY_FRESHNESS_DAYS: Readonly<Record<string, number>> = Object.freeze({
  seafood: 3,
  meat: 3,
  prepared: 4,
  leftovers: 4,
  produce: 7,
  dairy: 7,
  eggs: 14,
  bakery: 14,
  pantry: 30,
  frozen: 90,
});

export function classifyPantryFreshness(
  category: string | null | undefined,
  lastVerifiedAt: string | null | undefined,
  asOf = new Date(),
): { freshness: PantryFreshness; reason?: string; days: number | null; threshold: number } {
  const threshold = PANTRY_FRESHNESS_DAYS[(category ?? "").toLowerCase()] ?? 30;
  if (!lastVerifiedAt) return { freshness: "worth_a_look", reason: "verification date unknown", days: null, threshold };
  const stamp = Date.parse(lastVerifiedAt.length <= 10 ? `${lastVerifiedAt}T00:00:00Z` : lastVerifiedAt);
  if (!Number.isFinite(stamp)) return { freshness: "worth_a_look", reason: "verification date unknown", days: null, threshold };
  const days = Math.max(0, Math.floor((asOf.getTime() - stamp) / 86_400_000));
  return days >= threshold
    ? { freshness: "worth_a_look", reason: `last verified ${days} days ago`, days, threshold }
    : { freshness: "covered", days, threshold };
}
