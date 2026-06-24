// Per-tenant subjective overlay (shared-corpus capability, D5). The overlay holds
// only `rating` + `status`, keyed by recipe slug, in the caller's
// `users/<username>/overlay.toml`. `last_cooked` is NOT here — it is derived from
// the caller's D1 `cooking_log` table (MAX date per recipe). Read tools merge the
// overlay (and the cooking-log last_cooked) onto shared recipe content; an absent
// overlay row means effective status = `draft`.
//
// Transition safety: until the data is migrated and `status`/`rating` are stripped
// from the shared index (§6.1), the shared frontmatter still carries them. The
// merge prefers the overlay but falls back to the frontmatter value, so the live
// deployment behaves exactly as before until the overlay exists.

import { parse as parseToml } from "smol-toml";

export const OVERLAY_PATH = "overlay.toml";
export const DEFAULT_STATUS = "draft";

/** One recipe's subjective view for a tenant. */
export interface OverlayRow {
  rating?: unknown;
  status?: unknown;
}

/** slug -> subjective row. */
export type Overlay = Record<string, OverlayRow>;

/** Parse an `overlay.toml` body's `[overlay.<slug>]` tables into a slug→row map. */
export function parseOverlay(text: string): Overlay {
  const parsed = parseToml(text) as Record<string, unknown>;
  const raw = parsed.overlay;
  if (!raw || typeof raw !== "object") return {};
  const out: Overlay = {};
  for (const [slug, row] of Object.entries(raw as Record<string, unknown>)) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const entry: OverlayRow = {};
    if (r.rating != null) entry.rating = r.rating;
    if (typeof r.status === "string") entry.status = r.status;
    out[slug] = entry;
  }
  return out;
}

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
 * Apply a subjective edit to an overlay map, returning a NEW map. Only `rating`
 * and `status` are overlay fields; everything else is ignored here (content edits
 * route to shared recipe content, `last_cooked` to the cooking log). A null/absent
 * value clears that field for the slug.
 */
export function applyOverlayEdit(overlay: Overlay, slug: string, edit: OverlayRow): Overlay {
  const next: Overlay = { ...overlay };
  const row: OverlayRow = { ...(next[slug] ?? {}) };
  if ("rating" in edit) {
    if (edit.rating == null) delete row.rating;
    else row.rating = edit.rating;
  }
  if ("status" in edit) {
    if (edit.status == null) delete row.status;
    else row.status = edit.status;
  }
  if (Object.keys(row).length === 0) delete next[slug];
  else next[slug] = row;
  return next;
}

/** Serialize an overlay map back to `overlay.toml` (stable: slugs sorted). */
export function serializeOverlay(overlay: Overlay): string {
  const header =
    "# Per-tenant subjective overlay (rating + status), keyed by recipe slug.\n" +
    "# Merged onto shared recipe content at read time; absent slug → status draft.\n" +
    "# last_cooked is NOT here — it is derived from the D1 cooking_log table.\n\n";
  const slugs = Object.keys(overlay).sort();
  const blocks = slugs.map((slug) => {
    const row = overlay[slug];
    const lines = [`[overlay.${quoteKey(slug)}]`];
    if (row.status != null) lines.push(`status = ${JSON.stringify(row.status)}`);
    if (row.rating != null) lines.push(`rating = ${formatScalar(row.rating)}`);
    return lines.join("\n");
  });
  return header + blocks.join("\n\n") + (blocks.length ? "\n" : "");
}

/** A slug is a bare TOML key when it matches [A-Za-z0-9_-]+; quote otherwise. */
function quoteKey(slug: string): string {
  return /^[A-Za-z0-9_-]+$/.test(slug) ? slug : JSON.stringify(slug);
}

function formatScalar(v: unknown): string {
  return typeof v === "number" ? String(v) : JSON.stringify(v);
}
