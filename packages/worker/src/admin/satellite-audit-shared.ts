// Shared, JSX-free vocabulary for the Satellites source-audit surface (satellite-source-audit):
// the per-source audit prop shape the SSR page derives + serializes and the island re-hydrates,
// the reason/origin gloss maps (broken-adapter framing, one source of truth for both render
// passes), the fixed thresholds the recommendation copy quotes, and the provenance URL-classifier.
// Imported by BOTH the SSR page (pages/satellites.tsx) and the island (client/satellite-audit.tsx),
// so — like logs-shared.ts — it stays free of hono/jsx and workerd specifics (no D1 import: the
// display thresholds MIRROR src/satellite-audit-db.ts's QUARANTINE_* constants rather than pulling
// that module's `db` dependency into the browser bundle).

export type QState = "healthy" | "degrading" | "quarantined";

/** The per-source quality dimension (from the Worker's `readSourceQuality`, dedups excluded). */
export interface AuditQuality {
  accepted: number;
  rejected: number;
  /** accepted + rejected — the rate denominator. */
  sample: number;
  acceptanceRate: number;
  failRate: number;
  /** The fixed-numeric quarantine hint (over the fail-rate threshold with a minimum sample). */
  recommendQuarantine: boolean;
}

/** One aggregated drill-down ledger row: the SSR groups the Worker's count-1 rejects and the
 *  pre-aggregated local-summary rows by (reason, origin, provenance) — `count` summed, `rejected_at`
 *  the most recent in the group — so identical rejects collapse ("40× contract_invalid"). */
export interface AuditRejection {
  reason: string;
  origin: "worker" | "local";
  provenance: string | null;
  count: number;
  rejected_at: number;
}

export interface AuditQuarantine {
  quarantined_at: number;
  /** The operator note; the Worker persists no actor, so the panel shows the note only. */
  note: string | null;
}

/** A satellite's source row with the audit dimension joined on by {kind, source}. */
export interface AuditSource {
  /** Stable per-row key `${satelliteId}::${kind}::${source}`. */
  key: string;
  satelliteId: string;
  satelliteLabel: string;
  kind: string;
  source: string;
  /** The source's tenant binding — the quarantine flag keys on it so the toggle actually
   *  suppresses intake (the intake check keys off the carrying key's tenant, not the kind). */
  tenant: string | null;
  qstate: QState;
  quality: AuditQuality;
  /** Recency stays owned by liveness (ruling: integrate, don't duplicate) — the quality cell is
   *  accept/fail only. */
  recency: { health: "fresh" | "stale" | "never"; lastPush: number | null; pushes24h: number };
  rejections: AuditRejection[];
  quarantine: AuditQuarantine | null;
}

/** A satellite machine + its audit-joined source rows (the island's optimistic unit of state). */
export interface AuditSatellite {
  id: string;
  label: string;
  health: "fresh" | "stale" | "never";
  lastPush: number | null;
  pushes24h: number;
  sourceCount: number;
  satelliteVersion: string | null;
  contractVersion: string | null;
  skew: boolean;
  sources: AuditSource[];
}

/** The props block the SSR page emits and the island re-hydrates from. */
export interface SatelliteAuditProps {
  satellites: AuditSatellite[];
  contractVersion: string;
}

// Reason gloss — broken-adapter framing (a health gauge, never a security verdict).
export const REJECT_REASONS: Record<string, string> = {
  contract_invalid: "the adapter's output no longer matches the expected shape — the site's markup likely changed",
  judgment_smuggled: "the adapter tried to report a derived judgment a sensor must never assert (the Worker derives it)",
  implausible: "a value failed a Worker-side plausibility check (e.g. a 0-minute cook time, 900 servings)",
  quarantined: "rejected on arrival because this source is quarantined",
};

/** Where a reject happened. `local` is the loudest "adapter broke" signal (dropped before the wire). */
export const REJECT_ORIGINS: Record<"worker" | "local", { label: string; gloss: string }> = {
  worker: { label: "worker", gloss: "the Worker rejected it on arrival" },
  local: {
    label: "local",
    gloss: "the satellite's own pre-send check dropped it before it left the machine — the loudest 'adapter broke' signal",
  },
};

// The reliability window + thresholds — MIRROR src/satellite-audit-db.ts (SOURCE_QUALITY_WINDOW_DAYS
// / QUARANTINE_FAIL_RATE_THRESHOLD / QUARANTINE_MIN_SAMPLE). Display-only: the recommendation itself
// is computed Worker-side and carried on `AuditQuality.recommendQuarantine`.
export const AUDIT_WINDOW_DAYS = 60;
export const AUDIT_WINDOW_LABEL = `${AUDIT_WINDOW_DAYS} days`;
export const AUDIT_FAIL_THRESHOLD = 0.3;
export const AUDIT_MIN_SAMPLE = 20;

/** A provenance string is actionable when it is an http(s) URL (ruling #5). */
export function isUrlProvenance(prov: string | null): prov is string {
  return prov != null && /^https?:\/\//.test(prov);
}

/** Shorten a URL for display (drop the scheme + a trailing slash). */
export function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

export const pct = (x: number): string => `${Math.round(x * 100)}%`;
