// Shared formatting helpers (member-app-core), ported from the design bundle's
// app-state.js (relAge/fmtDay) plus the pantry freshness constants the mock derives
// its needs-verification section from (app-pages.js).

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Wed Jul 8" for an ISO day or epoch ms. */
export function fmtDay(v: string | number): string {
  const d = typeof v === "number" ? new Date(v) : new Date(`${v}T00:00:00`);
  if (Number.isNaN(d.getTime())) return String(v);
  return `${WD[d.getDay()]} ${MO[d.getMonth()]} ${d.getDate()}`;
}

/** The mock's relative-age label ("just now", "5m ago", "3d ago", …). */
export function relAge(v: string | number | null | undefined): string {
  if (v == null) return "—";
  const ms = typeof v === "number" ? v : Date.parse(v.length <= 10 ? `${v}T00:00:00` : v);
  if (Number.isNaN(ms)) return "—";
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  const d = Math.floor(s / 86400);
  if (d < 14) return `${d}d ago`;
  if (d < 60) return `${Math.floor(d / 7)}w ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

export function capitalize(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Days since an ISO day (for the pantry staleness nudge). */
export function daysSince(isoDay: string): number {
  return Math.floor((Date.now() - Date.parse(`${isoDay}T00:00:00`)) / 86_400_000);
}

/** Perishable pantry categories + the staleness threshold (the mock's constants). */
export const PERISHABLE = new Set(["produce", "dairy", "seafood", "meat"]);
export const STALE_DAYS = 7;

/** Today as an ISO day. */
export function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}
