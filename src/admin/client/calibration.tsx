// The discovery calibration island (operator-admin): the sweep's tunable knobs as a form, with
// Analyze (cheap, no-AI) and Dry-run (full pipeline, no writes) previews and a confirm-gated Save.
// The form is one union — Clean | Dirty | NeedsConfirm — so "unsaved edits", "the floor warning",
// and "saved" cannot contradict (admin/CLAUDE.md). A below-floor Save returns a structured
// needsConfirm error; the UI surfaces it and re-submits with confirm:true. Seeded from SSR props.

import { render, useState } from "hono/jsx/dom";
import { hc } from "hono/client";
import type { AdminApp } from "../app.js";
import { type Loadable, notAsked, loading, success, failure } from "../lib/remote.js";
import type { DiscoveryConfig } from "../../discovery-sweep.js";
import type { AnalyzeResult, DryRunOutcome } from "../../discovery-calibration.js";

const client = hc<AdminApp>(location.origin);

const KNOBS = [
  { key: "tasteThreshold", label: "τ taste threshold", step: "0.01" },
  { key: "triageThreshold", label: "triage threshold", step: "0.01" },
  { key: "dedupThreshold", label: "δ dedup threshold", step: "0.01" },
  { key: "classifyMaxPerTick", label: "classify cap", step: "1" },
  { key: "rateCap", label: "rate cap", step: "1" },
  { key: "fetchMaxPerTick", label: "fetch max / tick", step: "1" },
  { key: "maxCandidatesPerTick", label: "max candidates / tick", step: "1" },
  { key: "retryMaxAttempts", label: "retry max attempts", step: "1" },
  { key: "logRetentionDays", label: "log retention days", step: "1" },
] as const;

type Knob = (typeof KNOBS)[number]["key"];
type Draft = Record<Knob, string>;
interface FloorWarning {
  field: string;
  message: string;
}
type FormState = { t: "clean" } | { t: "dirty"; draft: Draft } | { t: "needsConfirm"; draft: Draft; warning: FloorWarning };

function toDraft(config: DiscoveryConfig): Draft {
  const d = {} as Draft;
  for (const { key } of KNOBS) d[key] = String(config[key]);
  return d;
}

function toPatch(draft: Draft): Record<string, number> {
  const patch: Record<string, number> = {};
  for (const { key } of KNOBS) {
    const n = Number(draft[key]);
    if (Number.isFinite(n)) patch[key] = n;
  }
  return patch;
}

async function floorWarning(res: { json: () => Promise<unknown> }): Promise<FloorWarning | null> {
  const body = (await res.json().catch(() => null)) as
    | { message?: string; detail?: { field?: string; needsConfirm?: boolean } }
    | null;
  if (body?.detail?.needsConfirm) return { field: body.detail.field ?? "", message: body.message ?? "Below the safe floor." };
  return null;
}

function CalibrationIsland({ config }: { config: DiscoveryConfig }) {
  const [saved, setSaved] = useState<DiscoveryConfig>(config);
  const [form, setForm] = useState<FormState>({ t: "clean" });
  const [analyze, setAnalyze] = useState<Loadable<AnalyzeResult>>(notAsked);
  const [dryRun, setDryRun] = useState<Loadable<DryRunOutcome[]>>(notAsked);

  const currentDraft = (): Draft => (form.t === "clean" ? toDraft(saved) : form.draft);

  function onField(key: Knob, value: string): void {
    setForm({ t: "dirty", draft: { ...currentDraft(), [key]: value } });
  }

  async function runAnalyze(): Promise<void> {
    setAnalyze(loading);
    const res = await client.admin.api.discovery.analyze.$post({ json: toPatch(currentDraft()) });
    setAnalyze(res.ok ? success(await res.json()) : failure({ error: "upstream", message: `HTTP ${res.status}` }));
  }

  async function runDryRun(): Promise<void> {
    setDryRun(loading);
    const res = await client.admin.api.discovery["dry-run"].$post({ json: toPatch(currentDraft()) });
    setDryRun(res.ok ? success((await res.json()).outcomes) : failure({ error: "upstream", message: `HTTP ${res.status}` }));
  }

  async function save(confirm: boolean): Promise<void> {
    const draft = currentDraft();
    const res = await client.admin.api.discovery.config.$put({ json: { ...toPatch(draft), confirm } });
    if (res.ok) {
      setSaved((await res.json()).config);
      setForm({ t: "clean" });
      setAnalyze(notAsked);
      setDryRun(notAsked);
      return;
    }
    const warning = await floorWarning(res);
    if (warning) setForm({ t: "needsConfirm", draft, warning });
  }

  const draft = currentDraft();
  const dirty = form.t !== "clean";

  return (
    <div>
      <div class="card">
      <fieldset style="border:0;padding:0;margin:0">
        {KNOBS.map((k) => (
          <label>
            {k.label}
            <input
              type="number"
              step={k.step}
              value={draft[k.key]}
              onInput={(e: Event) => onField(k.key, (e.target as HTMLInputElement).value)}
            />
          </label>
        ))}
      </fieldset>

      {form.t === "needsConfirm" ? (
        <div class="confirm">
          <p>{form.warning.message}</p>
          <div class="form-actions">
            <button class="danger-solid" onClick={() => save(true)}>
              Confirm &amp; save
            </button>
            <button class="link" onClick={() => setForm({ t: "dirty", draft: form.draft })}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div class="form-actions">
          <button disabled={!dirty} onClick={() => save(false)}>
            Save
          </button>
          <button class="link" onClick={runAnalyze}>
            Analyze
          </button>
          <button class="link" onClick={runDryRun}>
            Dry-run
          </button>
        </div>
      )}
      </div>

      <AnalyzePanel state={analyze} />
      <DryRunPanel state={dryRun} />
    </div>
  );
}

const AnalyzePanel = ({ state }: { state: Loadable<AnalyzeResult> }) => {
  if (state.status === "notAsked") return null;
  if (state.status === "loading") return <p class="muted">Analyzing…</p>;
  if (state.status === "failure") return <div class="error">Analyze failed: {state.error.message}</div>;
  const a = state.value;
  return (
    <div class="card">
      <h2>Analyze</h2>
      <p class="muted small">
        δ pairs: {a.deltaPairCount}
        {a.deltaBounded ? " (sampled)" : ""} · corpus {a.deltaCorpusSize}
      </p>
      <table>
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
    </div>
  );
};

const DryRunPanel = ({ state }: { state: Loadable<DryRunOutcome[]> }) => {
  if (state.status === "notAsked") return null;
  if (state.status === "loading") return <p class="muted">Running the pipeline (no writes)…</p>;
  if (state.status === "failure") return <div class="error">Dry-run failed: {state.error.message}</div>;
  return (
    <div class="card">
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
