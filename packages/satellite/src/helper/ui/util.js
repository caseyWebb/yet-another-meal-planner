/* Order Helper — small display helpers. The pull-list carries only a store SLUG and a raw
   location_id (no friendly name), and per-item prices are raw numbers — these render them
   gracefully for the human. */

/** Title-case a store slug for display, e.g. "target" → "Target", "whole-foods" → "Whole Foods". */
export function titleCase(slug) {
  if (!slug) return "Store";
  return String(slug)
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** The store's display name — the title-cased slug (the pull-list has no friendly name). */
export function storeName(store) {
  return titleCase(store && (store.slug || store.name));
}

/** The store's location line (the raw location_id), or "" when unset. */
export function storeLocation(store) {
  return store && store.location ? String(store.location) : "";
}

/** Format a raw numeric price as "$X.XX", or "" when absent (a missing price renders as nothing). */
export function formatPrice(n) {
  if (typeof n !== "number" || !isFinite(n)) return "";
  return "$" + n.toFixed(2);
}

/** The product's display name — its `description` (the raw provenance), or "" when absent. */
export function productName(product) {
  return product && product.description ? product.description : "";
}
