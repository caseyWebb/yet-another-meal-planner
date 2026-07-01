// The global service-health dock (operator-admin). A fixed corner pill the shell injects into
// every admin HTML page (see the health-dock middleware in app.tsx), surfacing the aggregate
// healthy/degraded rollup the panel already builds from `buildHealthPayload`. The SSR pill is
// the first paint; the health island hydrates it for the expand/collapse popover.
//
// `buildHealthRollup` projects the tenant-data-free `HealthPayload` down to the JSON-serializable
// `HealthRollup` the island seeds from — overall `ok`, the names of explicitly-failing jobs, and
// the live dependency rows (D1 probe, admin gate). The gate's display state uses the same
// precedence the Status page and the /health.svg badge use.

import type { HealthPayload } from "../../health.js";
import type { HealthRollup, HealthDep } from "../shared.js";

/** Project the full health payload to the dock rollup (overall ok, failing jobs, deps). */
export function buildHealthRollup(payload: HealthPayload): HealthRollup {
  const failingJobs = payload.jobs.filter((j) => j.ok === false).map((j) => j.name);
  const deps: HealthDep[] = [
    { name: "d1", state: payload.d1.ok ? "ok" : "fail", word: payload.d1.ok ? "reachable" : "unreachable" },
    gateDep(payload),
  ];
  return { ok: payload.ok, failingJobs, deps };
}

/** The admin-gate dependency row, by the same precedence the badge uses (exposed > gated > dev). */
function gateDep(payload: HealthPayload): HealthDep {
  const a = payload.admin;
  if (a.exposed) return { name: "admin gate", state: "fail", word: "exposed" };
  if (a.access_configured) return { name: "admin gate", state: "ok", word: "gated" };
  if (a.dev_bypass_set) return { name: "admin gate", state: "muted", word: "dev bypass" };
  return { name: "admin gate", state: "muted", word: "disabled" };
}

/** JSON for the dock's `<script type="application/json">`, with `<` escaped so the serialized
 *  payload can never close the script element early (mirrors the Members page's serializer). */
function serializeRollup(rollup: HealthRollup): string {
  return JSON.stringify(rollup).replace(/</g, "\\u003c");
}

/** The SSR dock — the resting pill (a pulse dot + Healthy/Degraded word + failing count). The
 *  island replaces `#health-dock`'s children on hydration to add the popover; this is the first
 *  paint and the no-JS fallback. */
const HealthDock = ({ rollup }: { rollup: HealthRollup }) => {
  const cls = rollup.ok ? "ok" : "fail";
  const word = rollup.ok ? "Healthy" : "Degraded";
  return (
    <div class="health-dock">
      <div id="health-dock" class="health-host">
        <button class={`health-pill ${cls}`} type="button" aria-label={`Service health: ${word}`}>
          <span class={`pulse-dot ${cls}`} />
          <span class={`status-word ${cls}`}>{word}</span>
          {!rollup.ok && rollup.failingJobs.length > 0 ? (
            <span class="hp-count">{rollup.failingJobs.length}</span>
          ) : null}
        </button>
      </div>
    </div>
  );
};

/** The HTML fragment the shell middleware injects before `</body>`: the SSR dock, the island's
 *  JSON props block, and the island module script. Returned as a string so the middleware can
 *  splice it into the already-rendered document. */
export function renderHealthDock(rollup: HealthRollup): string {
  const dock = (<HealthDock rollup={rollup} />).toString();
  const props = `<script type="application/json" id="health-props">${serializeRollup(rollup)}</script>`;
  const island = `<script type="module" src="/admin/islands/health.js"></script>`;
  return dock + props + island;
}
