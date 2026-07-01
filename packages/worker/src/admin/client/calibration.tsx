// The discovery calibration island (operator-admin): the sweep's tunable knobs, rendered by
// the shared KnobConsole (client/knob-console.tsx), plus Analyze (cheap, no-AI) and Dry-run
// (full pipeline, no writes) preview panels below it. Save is confirm-gated exactly like
// Ranking/Flyer's opconfig.tsx now — this island supplies the knob spec + the PUT wiring
// (client/knob-console.tsx owns the Clean|Dirty|NeedsConfirm state machine itself).

import { render, useState } from "hono/jsx/dom";
import { hc } from "hono/client";
import type { AdminApp } from "../app.js";
import { type Loadable, notAsked, loading, success, failure } from "../lib/remote.js";
import type { KnobSpec } from "../ui/kit.js";
import { KnobConsole, toPatch, floorWarningFromResponse, type Draft } from "./knob-console.js";
import type { DiscoveryConfig } from "../../discovery-sweep.js";
import type { AnalyzeResult, DryRunOutcome } from "../../discovery-calibration.js";

const client = hc<AdminApp>(location.origin);

const KNOBS: KnobSpec[] = [
  { key: "tasteThreshold", label: "τ taste threshold", step: 0.01, min: 0, max: 1, floor: 0.2, help: "Cosine a candidate must clear against a member's taste to match them." },
  { key: "triageThreshold", label: "triage threshold", step: 0.01, min: 0, max: 1, help: "Looser gate on the cheap title+summary embed before the expensive fetch/classify." },
  { key: "dedupThreshold", label: "δ dedup threshold", step: 0.01, min: 0, max: 1, floor: 0.7, help: "At/above this cosine vs the corpus, a candidate is treated as a near-duplicate." },
  { key: "classifyMaxPerTick", label: "classify cap", step: 1, min: 1, max: 100, help: "Max env.AI classification calls per sweep tick." },
  { key: "rateCap", label: "rate cap", step: 1, min: 1, max: 200, help: "Max imports per tick — the corpus-bloat governor." },
  { key: "fetchMaxPerTick", label: "fetch max / tick", step: 1, min: 1, max: 100, help: "Max external recipe-page fetches per tick." },
  { key: "maxCandidatesPerTick", label: "max candidates / tick", step: 10, min: 10, max: 1000, help: "Bounds the triage-embed + log-write cost per invocation." },
  { key: "retryMaxAttempts", label: "retry max attempts", step: 1, min: 1, max: 20, help: "Retryable parks/failures stop retrying after this many attempts." },
  { key: "logRetentionDays", label: "log retention days", step: 1, min: 1, max: 730, help: "How long discovery_log rows are kept for audit + dedup." },
];

function CalibrationIsland({ config }: { config: DiscoveryConfig }) {
  const [saved, setSaved] = useState<DiscoveryConfig>(config);
  const [analyze, setAnalyze] = useState<Loadable<AnalyzeResult>>(notAsked);
  const [dryRun, setDryRun] = useState<Loadable<DryRunOutcome[]>>(notAsked);

  async function runAnalyze(draft: Draft): Promise<void> {
    setAnalyze(loading);
    const res = await client.admin.api.discovery.analyze.$post({ json: toPatch(KNOBS, draft) });
    setAnalyze(res.ok ? success(await res.json()) : failure({ error: "upstream", message: `HTTP ${res.status}` }));
  }

  async function runDryRun(draft: Draft): Promise<void> {
    setDryRun(loading);
    const res = await client.admin.api.discovery["dry-run"].$post({ json: toPatch(KNOBS, draft) });
    setDryRun(res.ok ? success((await res.json()).outcomes) : failure({ error: "upstream", message: `HTTP ${res.status}` }));
  }

  async function save(patch: Record<string, number>, confirm: boolean) {
    const res = await client.admin.api.discovery.config.$put({ json: { ...patch, confirm } });
    if (res.ok) {
      const config = (await res.json()).config as unknown as Record<string, number>;
      return { ok: true as const, config };
    }
    const warning = await floorWarningFromResponse(res);
    return { ok: false as const, warning };
  }

  function onSaved(config: Record<string, number>): void {
    setSaved(config as unknown as DiscoveryConfig);
    setAnalyze(notAsked);
    setDryRun(notAsked);
  }

  return (
    <div>
      <div class="card">
        <section>
          <KnobConsole knobs={KNOBS} saved={saved as unknown as Record<string, number>} onSaved={onSaved} save={save}>
            {(draft) => (
              <div class="cfg-preview-actions">
                <button class="btn" data-variant="outline" data-size="sm" onClick={() => runAnalyze(draft)}>
                  Analyze
                </button>
                <button class="btn" data-variant="outline" data-size="sm" onClick={() => runDryRun(draft)}>
                  Dry-run
                </button>
                <span class="muted small">Analyze is cheap (no AI). Dry-run runs the full pipeline with no writes.</span>
              </div>
            )}
          </KnobConsole>
        </section>
      </div>

      <AnalyzePanel state={analyze} />
      <DryRunPanel state={dryRun} />
    </div>
  );
}

const AnalyzePanel = ({ state }: { state: Loadable<AnalyzeResult> }) => {
  if (state.status === "notAsked") return null;
  if (state.status === "loading") return <p class="muted">Analyzing…</p>;
  if (state.status === "failure")
    return (
      <div class="alert" data-variant="destructive">
        <section>Analyze failed: {state.error.message}</section>
      </div>
    );
  const a = state.value;
  return (
    <div class="card">
      <section>
        <h2>Analyze</h2>
        <p class="muted small">
          δ pairs: {a.deltaPairCount}
          {a.deltaBounded ? " (sampled)" : ""} · corpus {a.deltaCorpusSize}
        </p>
        <table class="table">
          <thead>
            <tr>
              <th>member</th>
              <th>matches at τ</th>
            </tr>
          </thead>
          <tbody>
            {a.memberTau.map((m) => (
              <tr>
                <td>{m.tenant}</td>
                <td>
                  {m.matchCount}
                  {m.coldStart ? <span class="muted small"> (cold start)</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
};

const DryRunPanel = ({ state }: { state: Loadable<DryRunOutcome[]> }) => {
  if (state.status === "notAsked") return null;
  if (state.status === "loading") return <p class="muted">Running the pipeline (no writes)…</p>;
  if (state.status === "failure")
    return (
      <div class="alert" data-variant="destructive">
        <section>Dry-run failed: {state.error.message}</section>
      </div>
    );
  return (
    <div class="card">
      <section>
        <h2>Dry-run</h2>
        {state.value.length === 0 ? (
          <p class="muted">No candidates this run.</p>
        ) : (
          <ul class="entry-list">
            {state.value.map((o) => (
              <li class="entry-row">
                <span class="entry-outcome muted">{o.outcome}</span>
                <span class="entry-title">{o.title || o.url}</span>
                <span class="entry-source muted small">
                  {o.wouldMatchMembers && o.wouldMatchMembers.length > 0 ? `→ ${o.wouldMatchMembers.join(", ")}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};

const host = document.getElementById("config-island");
const propsEl = document.getElementById("config-props");
if (host && propsEl) {
  const props = JSON.parse(propsEl.textContent ?? "{}") as { config: DiscoveryConfig };
  host.replaceChildren();
  render(<CalibrationIsland config={props.config} />, host);
}
