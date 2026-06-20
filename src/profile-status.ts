// Per-tenant initialization status for the grocery profile. Backs the
// `profile_status` read tool and the `grocery-core` onboarding gate: answers
// "is this member set up?" from DATA_KV — no GitHub directory listing.

import { readProfileBundle, readPantryState, readMealPlanState, readGroceryListState } from "./user-kv.js";

const PROFILE_AREAS: ReadonlyArray<readonly [area: string, field: string]> = [
  ["store", "preferences"],
  ["taste", "taste"],
  ["diet", "diet_principles"],
  ["equipment", "kitchen"],
  ["pantry", "pantry"],
  ["ready-to-eat", "ready_to_eat"],
  ["stockup", "stockup"],
  ["corpus", "overlay"],
];

export interface ProfileStatus {
  initialized: boolean;
  missing: string[];
}

export async function profileStatus(
  kv: KVNamespace,
  username: string,
): Promise<ProfileStatus> {
  const [bundle, pantry, mealPlan, groceryList] = await Promise.all([
    readProfileBundle(kv, username),
    readPantryState(kv, username),
    readMealPlanState(kv, username),
    readGroceryListState(kv, username),
  ]);

  const initialized = bundle?.preferences != null && bundle.preferences.trim().length > 0;

  const missing: string[] = [];
  for (const [area, field] of PROFILE_AREAS) {
    if (field === "pantry") {
      if (pantry === null || pantry.length === 0) missing.push(area);
    } else {
      const value = bundle?.[field as keyof typeof bundle];
      if (value == null || (typeof value === "string" && value.trim().length === 0)) {
        missing.push(area);
      }
    }
  }

  // Session state presence (meal_plan and grocery_list are not onboarding areas
  // but we surface them in the status for diagnostics when non-empty)
  void mealPlan;
  void groceryList;

  return { initialized, missing };
}
