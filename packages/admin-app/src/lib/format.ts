// Shared formatting helpers (ported from the panel's logs-shared.ts — the SSR pages and
// islands shared these; the SPA's screens keep the exact same vocabulary).

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

/** A UTC absolute timestamp (the panel's SSR convention, kept for familiarity). */
export function utc(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
}
