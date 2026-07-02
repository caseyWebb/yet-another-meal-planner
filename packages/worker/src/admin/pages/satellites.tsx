// Discovery › Satellites (recipe-ingestion): the read-only operator liveness view of satellite
// ingest — one card per satellite machine (health in the /health fresh/stale/never posture,
// reported satellite + contract version with a skew chip, per-source breakdown), the 24h throughput
// funnel, and the recent-pushes log. Pure SSR (admin/CLAUDE.md rule 8): no island, no mutation —
// key management lives in Config › Ingest Keys. Seeded from readSatelliteLiveness.

import { Layout } from "../ui/layout.js";
import { StatCardGrid, StatCard, Badge } from "../ui/kit.js";
import { InboxIcon, ActivityIcon, DownloadIcon, ShieldIcon, AlertTriangleIcon } from "../ui/icons.js";
import { relAge } from "../logs-shared.js";
import type { SatelliteRollup, SatelliteLiveness, RecentPush, Health } from "../../ingest-db.js";

/** The Candidates | Satellites sub-nav shared by both Discovery views. */
export const DiscoverySubNav = ({ active }: { active: "candidates" | "satellites" }) => (
  <div class="data-nav">
    <a href="/admin/discovery" class={active === "candidates" ? "pill active" : "pill"}>
      Candidates
    </a>
    <a href="/admin/discovery/satellites" class={active === "satellites" ? "pill active" : "pill"}>
      Satellites
    </a>
  </div>
);

const HealthBadge = ({ health }: { health: Health }) => (
  <Badge variant={health === "fresh" ? "secondary" : health === "stale" ? "destructive" : "outline"}>{health}</Badge>
);

const RESULT_LABEL: Record<RecentPush["result"], string> = {
  accepted: "Accepted",
  partial: "Partially deduped",
  bad_payload: "Rejected · bad payload",
  bad_key: "Rejected · bad key",
};

const LivenessCard = ({ s, now, contractVersion }: { s: SatelliteLiveness; now: number; contractVersion: string }) => (
  <div class="ig-live-card">
    <div class="ig-live-head">
      <div>
        <div class="item-title">{s.label}</div>
        <span class="muted small">{s.sourceCount ? `${s.sourceCount} ${s.sourceCount === 1 ? "source" : "sources"}` : "no sources yet"}</span>
      </div>
      <HealthBadge health={s.health} />
    </div>
    <div class="ig-live-when">
      <span class={s.lastPush == null ? "muted" : ""}>{s.lastPush == null ? "no pushes yet" : relAge(s.lastPush, now)}</span>
      {s.lastPush != null ? <span class="muted small"> · {s.pushes24h} in 24h</span> : null}
    </div>
    {s.sources.length > 0 ? (
      <div class="ig-src-list">
        {s.sources.map((src) => (
          <div class="ig-src">
            <span class={`dot ${src.health === "fresh" ? "ok" : src.health === "stale" ? "fail" : "never"}`} />
            <span class="ig-src-name">{src.name}</span>
            <span class="muted small">
              {src.lastPush == null ? "never" : relAge(src.lastPush, now)} · {src.pushes24h}/24h
            </span>
          </div>
        ))}
      </div>
    ) : null}
    <div class="ig-live-foot muted small">
      {s.satelliteVersion ? (
        <>
          satellite <code>v{s.satelliteVersion}</code> · contract <code>{s.contractVersion}</code>
          {s.skew ? (
            <span class="txt-bad">
              {" "}
              <AlertTriangleIcon size={11} /> behind {contractVersion}
            </span>
          ) : null}
        </>
      ) : (
        <span>key minted — no satellite has authenticated</span>
      )}
    </div>
  </div>
);

const Funnel = ({ rollup }: { rollup: SatelliteRollup }) => {
  const a = rollup.funnel.arrival;
  const d = rollup.funnel.downstream;
  const arrival: [string, number][] = [
    ["Received", a.received],
    ["Accepted", a.accepted],
    ["Deduped on arrival", a.deduped],
    ["Handed to sweep", a.swept],
  ];
  const downstream: [string, number][] = [
    ["Imported", d.imported],
    ["No match", d.noMatch],
    ["Duplicate", d.duplicate],
    ["Parked", d.parked],
  ];
  return (
    <div class="ig-funnel">
      <div class="ig-arrival">
        {arrival.map(([label, value]) => (
          <div class="ig-fstep">
            <div class="ig-fval">{value}</div>
            <div class="ig-flabel muted small">{label}</div>
          </div>
        ))}
      </div>
      <div class="ig-down">
        {downstream.map(([label, value]) => (
          <span class="badge" data-variant="outline">
            {label} {value}
          </span>
        ))}
      </div>
    </div>
  );
};

export const SatellitesView = ({ rollup, now }: { rollup: SatelliteRollup; now: number }) => (
  <div class="satellites">
    <DiscoverySubNav active="satellites" />

    <StatCardGrid>
      <StatCard icon={<InboxIcon size={15} />} label="Satellites" value={rollup.stats.activeSatellites} sub={`${rollup.stats.sources} sources`} />
      <StatCard icon={<ActivityIcon size={15} />} label="Fresh" value={rollup.stats.fresh} sub={rollup.stats.stale ? `${rollup.stats.stale} stale` : "all live"} />
      <StatCard icon={<DownloadIcon size={15} />} label="Pushes · 24h" value={rollup.stats.pushes24h} />
      <StatCard icon={<ShieldIcon size={15} />} label="Contract" value={rollup.contractVersion} sub="worker" />
    </StatCardGrid>

    {rollup.activeSatellites.length === 0 ? (
      <p class="muted">
        No satellites yet. Mint an ingest key in Config › Ingest Keys, then run a satellite on your network that pushes recipes here.
      </p>
    ) : (
      <>
        <p class="group-label">Satellite liveness</p>
        <div class="ig-live-grid">
          {rollup.activeSatellites.map((s) => (
            <LivenessCard s={s} now={now} contractVersion={rollup.contractVersion} />
          ))}
        </div>
      </>
    )}

    <p class="group-label">Throughput · last 24h</p>
    <Funnel rollup={rollup} />

    <p class="group-label">Recent pushes</p>
    {rollup.pushes.length === 0 ? (
      <p class="muted">No pushes yet.</p>
    ) : (
      <div class="cfg-table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>When</th>
              <th>Satellite</th>
              <th>Source</th>
              <th>Batch</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {rollup.pushes.map((p) => (
              <tr>
                <td class="muted small">{relAge(p.at, now)}</td>
                <td>{p.satellite}</td>
                <td>{p.source}</td>
                <td>{p.count}</td>
                <td>
                  <Badge variant={p.result === "accepted" ? "secondary" : p.result === "partial" ? "outline" : "destructive"}>
                    {RESULT_LABEL[p.result]}
                  </Badge>
                  {p.result === "partial" && p.deduped > 0 ? <span class="muted small"> {p.deduped} deduped</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </div>
);

export const SatellitesPage = ({ rollup, now }: { rollup: SatelliteRollup; now: number }) => (
  <Layout title="Satellites · grocery-agent admin" active="/admin/discovery" wide>
    <div class="area-head status-head">
      <h2>Discovery</h2>
    </div>
    <SatellitesView rollup={rollup} now={now} />
  </Layout>
);
