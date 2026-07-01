// Shared, JSX-free helpers for the Logs area (operator-admin) — imported by BOTH the SSR page
// and the client island so the outcome mapping + detail predicate stay one source of truth.
// Also imported by the Discovery area (admin-ui-redesign-discovery), which shares the same
// discovery_log row shape and the same relative-time formatting.

import type { DiscoveryLogRow } from "../discovery-db.js";

/** Coarse relative age, e.g. "just now" / "4m ago" / "2h ago" / "8d ago". */
export function relAge(ms: number, now: number): string {
  const s = Math.max(0, Math.floor((now - ms) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Coarse relative countdown to a future instant, e.g. "any moment" / "in 4m" / "in 2h" / "in 8d". */
export function relFuture(ms: number, now: number): string {
  const s = Math.max(0, Math.floor((ms - now) / 1000));
  if (s < 60) return "any moment";
  if (s < 3600) return `in ${Math.floor(s / 60)}m`;
  if (s < 86400) return `in ${Math.floor(s / 3600)}h`;
  return `in ${Math.floor(s / 86400)}d`;
}

/** Map a discovery outcome to its [class, word] (color + label). Unknown outcomes pass through. */
export function outcomeClassWord(outcome: string): [string, string] {
  switch (outcome) {
    case "imported":
      return ["ok", "imported"];
    case "duplicate":
      return ["muted", "duplicate"];
    case "no_match":
      return ["muted", "no match"];
    case "rejected_source":
      return ["muted", "rejected source"];
    case "dietary_gated":
      return ["muted", "dietary gated"];
    case "error":
      return ["fail", "error"];
    case "failed":
      return ["fail", "failed"];
    default:
      return ["muted", outcome];
  }
}

/** Only `error`/`failed` rows are retryable (and deletable as a parked row). */
export function isRetryable(outcome: string): boolean {
  return outcome === "error" || outcome === "failed";
}

function isEmptyDetail(detail: unknown): boolean {
  if (detail == null) return true;
  if (Array.isArray(detail)) return detail.length === 0;
  if (typeof detail === "object") return Object.keys(detail).length === 0;
  return true; // a bare scalar is not structured enough for the dialog
}

/** A row has expandable detail iff it imported (has a slug) or carries a non-empty detail blob. */
export function hasDetail(row: DiscoveryLogRow): boolean {
  return row.slug !== null || !isEmptyDetail(row.detail);
}

export function entryTitle(row: DiscoveryLogRow): string {
  return row.title ?? row.url ?? "(untitled)";
}
