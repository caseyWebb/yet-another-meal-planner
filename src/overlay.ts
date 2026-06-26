// Per-tenant subjective overlay (shared-corpus capability, D5). The overlay holds
// only the caller's two dispositions — `favorite` (loved) and `reject` (hidden-from-me)
// — keyed by recipe slug. It lives in the D1 `overlay` table (one row per
// (tenant, recipe)); `src/profile-db.ts` reads/writes those rows. `last_cooked` is NOT
// here — it is derived from the caller's D1 `cooking_log` table (MAX date per recipe).
// Read tools merge the overlay (and the cooking-log last_cooked) onto shared recipe
// content.
//
// OPT-OUT visibility: an ABSENT overlay row means NEUTRAL — the recipe is available
// (favorite = false, reject = false). The old `status` lifecycle (active/draft/
// rejected/archived) and the inert `rating` column were retired in the favorites/
// rejections collapse; a recipe is no longer effective-`draft` by default. `favorite`
// and `reject` are mutually exclusive (enforced in the write tools).
//
// This module is PURE merge/edit logic over objects — no serialization.

/** One recipe's subjective view for a tenant. A row exists iff favorited or rejected. */
export interface OverlayRow {
  favorite?: unknown;
  reject?: unknown;
}

/** slug -> subjective row. */
export type Overlay = Record<string, OverlayRow>;

/**
 * Merge a shared recipe's objective frontmatter with the caller's subjective view.
 * Returns a NEW object — never mutates the shared frontmatter. Resolution:
 *   favorite    = overlay.favorite                                          ?? false
 *   reject      = overlay.reject                                            ?? false
 *   last_cooked = cooking-log date    ?? frontmatter.last_cooked (transition) ?? null
 * Any lingering objective `status`/`rating` is dropped so no read path surfaces them.
 */
export function mergeOverlay(
  frontmatter: Record<string, unknown>,
  row: OverlayRow | undefined,
  lastCooked: string | undefined,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...frontmatter };
  delete merged.status;
  delete merged.rating;
  merged.favorite = Boolean(row?.favorite);
  merged.reject = Boolean(row?.reject);
  merged.last_cooked = lastCooked ?? frontmatter.last_cooked ?? null;
  return merged;
}

/**
 * Apply a subjective edit to a single overlay row, returning the NEW row (or null
 * when the edit empties it, so the caller can DELETE the D1 row). `favorite` and
 * `reject` are the only overlay fields and are MUTUALLY EXCLUSIVE: setting one true
 * clears the other. A falsy value clears that field; the row empties to null when
 * nothing is set (no lingering `favorite: 0` / `reject: 0` rows).
 */
export function applyOverlayEdit(row: OverlayRow | undefined, edit: OverlayRow): OverlayRow | null {
  const next: OverlayRow = { ...(row ?? {}) };
  if ("favorite" in edit) {
    if (!edit.favorite) delete next.favorite;
    else {
      next.favorite = true;
      delete next.reject; // mutual exclusion
    }
  }
  if ("reject" in edit) {
    if (!edit.reject) delete next.reject;
    else {
      next.reject = true;
      delete next.favorite; // mutual exclusion
    }
  }
  return Object.keys(next).length === 0 ? null : next;
}
