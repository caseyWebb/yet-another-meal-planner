// Per-tenant subjective overlay (shared-corpus capability, D5). The overlay holds
// only `rating` + `status`, keyed by recipe slug. It lives in the D1 `overlay`
// table (one row per (tenant, recipe)); `src/profile-db.ts` reads/writes those
// rows. `last_cooked` is NOT here — it is derived from the caller's D1 `cooking_log`
// table (MAX date per recipe). Read tools merge the overlay (and the cooking-log
// last_cooked) onto shared recipe content; an absent overlay row means effective
// status = `draft`.
//
// This module is now PURE merge/edit logic over objects — no serialization. The
// codec layer (TOML parse/serialize) is gone with the KV bundle (d1-profile).

export const DEFAULT_STATUS = "draft";

/** One recipe's subjective view for a tenant. */
export interface OverlayRow {
  rating?: unknown;
  status?: unknown;
}

/** slug -> subjective row. */
export type Overlay = Record<string, OverlayRow>;

/**
 * Merge a shared recipe's objective frontmatter with the caller's subjective view.
 * Returns a NEW object — never mutates the shared frontmatter. Resolution:
 *   status      = overlay.status      ?? frontmatter.status (transition) ?? "draft"
 *   rating      = overlay.rating      ?? frontmatter.rating (transition) ?? null
 *   last_cooked = cooking-log date    ?? frontmatter.last_cooked (transition) ?? null
 */
export function mergeOverlay(
  frontmatter: Record<string, unknown>,
  row: OverlayRow | undefined,
  lastCooked: string | undefined,
): Record<string, unknown> {
  const status = row?.status ?? frontmatter.status ?? DEFAULT_STATUS;
  const rating = row?.rating ?? frontmatter.rating ?? null;
  const last = lastCooked ?? frontmatter.last_cooked ?? null;
  return { ...frontmatter, status, rating, last_cooked: last };
}

/**
 * Apply a subjective edit to a single overlay row, returning the NEW row (or null
 * when the edit empties it, so the caller can DELETE the D1 row). Only `rating` and
 * `status` are overlay fields; a null/absent value clears that field for the slug.
 */
export function applyOverlayEdit(row: OverlayRow | undefined, edit: OverlayRow): OverlayRow | null {
  const next: OverlayRow = { ...(row ?? {}) };
  if ("rating" in edit) {
    if (edit.rating == null) delete next.rating;
    else next.rating = edit.rating;
  }
  if ("status" in edit) {
    if (edit.status == null) delete next.status;
    else next.status = edit.status;
  }
  return Object.keys(next).length === 0 ? null : next;
}
