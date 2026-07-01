// Island hydration props (operator-admin). These cross the server→client boundary as JSON
// embedded in the page, so they MUST be JSON-serializable (no Date/Map) — the island
// hydrates with state matching the server-render. Shared by the SSR page and the island.

import type { TenantRosterRow } from "../admin.js";

/** Seed for the Members island: the current roster rows (operational status only). */
export interface MembersIslandProps {
  members: TenantRosterRow[];
}

/** A live dependency state for the health dock (D1 probe, admin gate). `state` drives the dot
 *  color; `word` is the short label shown alongside. */
export interface HealthDep {
  name: string;
  state: "ok" | "fail" | "muted";
  word: string;
}

/** Seed for the global health-dock island: the aggregate rollup the shell injects on every
 *  page. Derived from the tenant-data-free `HealthPayload` (see `ui/health-dock.tsx`), so it is
 *  JSON-serializable and carries no per-tenant data. `failingJobs` is the names of explicitly
 *  failing jobs; `deps` is the live dependency rows the popover lists. */
export interface HealthRollup {
  ok: boolean;
  failingJobs: string[];
  deps: HealthDep[];
}
