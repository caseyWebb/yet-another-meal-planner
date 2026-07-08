// Config › Discovery (the bare /config default group) — the sweep's calibration console
// (ported from the SSR client/calibration.tsx island: the shared KnobConsole over the
// ["discovery-config"] query, Save confirm-gated on the floor knobs, plus Analyze (cheap,
// no-AI) and Dry-run (full pipeline, no writes) preview mutations rendering their result
// panels below it), the Discovery feeds corpus editor with its test-feed probe, and the
// Email Sources editor.

import { useMutation, useQuery } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { api, apiErrorOf, unwrap } from "../../lib/api";
import { discoveryConfigQuery, queryClient, type DiscoveryConfigData } from "../../lib/queries";
import { assertNever } from "../../lib/assert";
import { Button, Card, DataTable, ErrorBanner, type KnobSpec } from "../../components/kit";
import { KnobConsole, floorWarningOrThrow, toPatch, type Draft, type FloorWarning } from "../../components/knob-console";
import { ConfigShell, Section } from "./shell";
import { CorpusEditor, type TableConfig } from "./corpus-editor";
import { EmailSourcesEditor } from "./email-sources";

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

const FEEDS_EDITOR: TableConfig = {
  slug: "feeds",
  pkColumn: "url",
  testUrlColumn: "url",
  addFields: [
    { key: "url", label: "feed url", kind: "text", required: true },
    { key: "name", label: "name", kind: "text", required: false },
    { key: "weight", label: "weight", kind: "number", required: false },
    { key: "tags", label: "tags (comma-separated)", kind: "tags", required: false },
  ],
};

export function ConfigDiscoveryScreen() {
  return (
    <ConfigShell>
      <Section
        title="Calibration"
        blurb="Tune the sweep's knobs, preview with Analyze / Dry-run, then Save (a below-floor value asks to confirm)."
      >
        <CalibrationSection />
      </Section>
      <Section
        title="Discovery feeds"
        blurb="RSS sources the sweep polls for new candidates. Weight scales a feed's taste contribution; test a URL before adding."
      >
        <CorpusEditor config={FEEDS_EDITOR} />
      </Section>
      <Section title="Email Sources">
        <EmailSourcesEditor />
      </Section>
    </ConfigShell>
  );
}

function CalibrationSection() {
  const q = useQuery(discoveryConfigQuery);
  switch (q.status) {
    case "pending":
      return <p className="muted">Loading the calibration console…</p>;
    case "error":
      return <ErrorBanner message={apiErrorOf(q.error)?.message ?? String(q.error)} />;
    case "success":
      return <CalibrationConsole config={q.data.config} />;
    default:
      return assertNever(q);
  }
}

type AnalyzeResult = InferResponseType<typeof api.admin.api.discovery.analyze.$post>;
type DryRunData = InferResponseType<(typeof api.admin.api.discovery)["dry-run"]["$post"]>;
type SaveResult = { ok: true; config: Record<string, number> } | { ok: false; warning: FloorWarning | null };

function CalibrationConsole({ config }: { config: DiscoveryConfigData["config"] }) {
  const saveMut = useMutation({
    mutationFn: async ({ patch, confirm }: { patch: Record<string, number>; confirm: boolean }): Promise<SaveResult> => {
      const res = await api.admin.api.discovery.config.$put({ json: { ...patch, confirm } });
      if (res.ok) return { ok: true, config: (await res.json()).config as unknown as Record<string, number> };
      return { ok: false, warning: await floorWarningOrThrow(res) };
    },
    onSuccess: (result) => {
      if (result.ok) {
        queryClient.setQueryData(discoveryConfigQuery.queryKey, {
          config: result.config as unknown as DiscoveryConfigData["config"],
        });
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["discovery-config"] }),
  });

  const analyzeMut = useMutation({
    mutationFn: (draft: Draft) => unwrap(api.admin.api.discovery.analyze.$post({ json: toPatch(KNOBS, draft) })),
  });

  const dryRunMut = useMutation({
    mutationFn: (draft: Draft) => unwrap(api.admin.api.discovery["dry-run"].$post({ json: toPatch(KNOBS, draft) })),
  });

  return (
    <div>
      <Card>
        {saveMut.isError ? (
          <ErrorBanner message={`Save failed: ${apiErrorOf(saveMut.error)?.message ?? String(saveMut.error)}`} />
        ) : null}
        <KnobConsole
          knobs={KNOBS}
          saved={config as unknown as Record<string, number>}
          onSaved={() => {
            // A fresh save resets the preview panels (they described the pre-save draft).
            analyzeMut.reset();
            dryRunMut.reset();
          }}
          save={(patch, confirm) => saveMut.mutateAsync({ patch, confirm })}
          saving={saveMut.isPending}
        >
          {(draft) => (
            <div className="cfg-preview-actions">
              <Button variant="outline" size="sm" disabled={analyzeMut.isPending} onClick={() => analyzeMut.mutate(draft)}>
                Analyze
              </Button>
              <Button variant="outline" size="sm" disabled={dryRunMut.isPending} onClick={() => dryRunMut.mutate(draft)}>
                Dry-run
              </Button>
              <span className="muted small">Analyze is cheap (no AI). Dry-run runs the full pipeline with no writes.</span>
            </div>
          )}
        </KnobConsole>
      </Card>

      <AnalyzePanel mut={analyzeMut} />
      <DryRunPanel mut={dryRunMut} />
    </div>
  );
}

function AnalyzePanel({
  mut,
}: {
  mut: { status: "idle" | "pending" | "error" | "success"; error: unknown; data?: AnalyzeResult };
}) {
  if (mut.status === "idle") return null;
  if (mut.status === "pending") return <p className="muted">Analyzing…</p>;
  if (mut.status === "error")
    return <ErrorBanner message={`Analyze failed: ${apiErrorOf(mut.error)?.message ?? String(mut.error)}`} />;
  const a = mut.data as AnalyzeResult;
  return (
    <Card>
      <h2>Analyze</h2>
      <p className="muted small">
        δ pairs: {a.deltaPairCount}
        {a.deltaBounded ? " (sampled)" : ""} · corpus {a.deltaCorpusSize}
      </p>
      <DataTable
        columns={[
          { key: "member", label: "member" },
          { key: "matches", label: "matches at τ" },
        ]}
        rows={a.memberTau.map((m) => ({
          member: m.tenant,
          matches: (
            <>
              {m.matchCount}
              {m.coldStart ? <span className="muted small"> (cold start)</span> : null}
            </>
          ),
        }))}
      />
    </Card>
  );
}

function DryRunPanel({
  mut,
}: {
  mut: { status: "idle" | "pending" | "error" | "success"; error: unknown; data?: DryRunData };
}) {
  if (mut.status === "idle") return null;
  if (mut.status === "pending") return <p className="muted">Running the pipeline (no writes)…</p>;
  if (mut.status === "error")
    return <ErrorBanner message={`Dry-run failed: ${apiErrorOf(mut.error)?.message ?? String(mut.error)}`} />;
  const outcomes = (mut.data as DryRunData).outcomes;
  return (
    <Card>
      <h2>Dry-run</h2>
      {outcomes.length === 0 ? (
        <p className="muted">No candidates this run.</p>
      ) : (
        <ul className="entry-list">
          {outcomes.map((o, i) => (
            <li key={`${o.url}-${i}`} className="entry-row">
              <span className="entry-outcome muted">{o.outcome}</span>
              <span className="entry-title">{o.title || o.url}</span>
              <span className="entry-source muted small">
                {o.wouldMatchMembers && o.wouldMatchMembers.length > 0 ? `→ ${o.wouldMatchMembers.join(", ")}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
