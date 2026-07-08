// The shared-corpus editor (ported from the SSR client/corpus.tsx island) — one generic
// editor for the group-wide corpus tables not folded into Email Sources (feeds /
// flyer-terms); the table's identity, columns, PK, and add-form fields ride in the config.
// List + add + remove-by-PK over the ["corpus", table] query, invalidated after each write
// so the view is the authoritative server state. The Feeds table additionally offers a
// read-only feed-probe test (per row + on the drafted URL) as its own mutation, independent
// of the add/remove pair.

import * as React from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { api, apiError, apiErrorOf, unwrap } from "../../lib/api";
import { corpusQuery, queryClient, type CorpusData } from "../../lib/queries";
import { assertNever } from "../../lib/assert";
import { Input } from "@grocery-agent/ui";
import { Button, ErrorBanner, RemoveButton } from "../../components/kit";

export interface AddField {
  key: string;
  label: string;
  kind: "text" | "number" | "tags";
  required: boolean;
}

export interface TableConfig {
  slug: string;
  pkColumn: string;
  addFields: AddField[];
  testUrlColumn?: string;
}

type FeedProbeResult = InferResponseType<(typeof api.admin.api.discovery)["test-feed"]["$post"]>;

function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

function buildBody(fields: AddField[], draft: Record<string, string>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const f of fields) {
    const raw = (draft[f.key] ?? "").trim();
    if (!raw && !f.required) continue;
    if (f.kind === "number") body[f.key] = Number(raw);
    else if (f.kind === "tags")
      body[f.key] = raw
        ? raw
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
    else body[f.key] = raw;
  }
  return body;
}

function summarize(r: FeedProbeResult): string {
  const counts: Record<string, number> = {};
  for (const s of r.sample) counts[s.outcome] = (counts[s.outcome] ?? 0) + 1;
  const sample = Object.entries(counts)
    .map(([k, v]) => `${v} ${k}`)
    .join(", ");
  const feed = r.feed.reachable
    ? r.feed.parsed
      ? `reachable, ${r.feed.itemCount} items`
      : "reachable, not parseable"
    : "unreachable";
  return r.sample.length ? `${feed} · sample: ${sample}` : feed;
}

/** The editor over its own ["corpus", table] query (each Config group may host several). */
export function CorpusEditor({ config }: { config: TableConfig }) {
  const q = useQuery(corpusQuery(config.slug));
  switch (q.status) {
    case "pending":
      return <p className="muted">Loading…</p>;
    case "error":
      return <ErrorBanner message={apiErrorOf(q.error)?.message ?? String(q.error)} />;
    case "success":
      return <CorpusEditorBody config={config} page={q.data} />;
    default:
      return assertNever(q);
  }
}

function CorpusEditorBody({ config, page }: { config: TableConfig; page: CorpusData }) {
  const [draft, setDraft] = React.useState<Record<string, string>>({});

  const addMut = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      unwrap(api.admin.api.corpus[":table"].$post({ param: { table: config.slug }, json: body })),
    onSuccess: () => setDraft({}),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["corpus", config.slug] }),
  });

  const removeMut = useMutation({
    mutationFn: (key: string) =>
      unwrap(api.admin.api.corpus[":table"][":key"].$delete({ param: { table: config.slug, key } })),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["corpus", config.slug] }),
  });

  // The read-only feed probe: an HTTP failure is a probe RESULT (ok:false + message), not a
  // mutation error — mirrors the SSR island's Test union.
  const testMut = useMutation({
    mutationFn: async ({ url }: { url: string; key: string }) => {
      const res = await api.admin.api.discovery["test-feed"].$post({ json: { url: url.trim() } });
      if (!res.ok) return { ok: false, summary: (await apiError(res)).message || `HTTP ${res.status}` };
      const r = (await res.json()) as FeedProbeResult;
      return { ok: r.feed.reachable, summary: summarize(r) };
    },
  });

  const busy = addMut.isPending || removeMut.isPending;
  const failure = addMut.isError
    ? { op: "Add", error: apiErrorOf(addMut.error)?.message ?? String(addMut.error) }
    : removeMut.isError
      ? { op: "Remove", error: apiErrorOf(removeMut.error)?.message ?? String(removeMut.error) }
      : null;

  function add(): void {
    for (const f of config.addFields) if (f.required && !(draft[f.key] ?? "").trim()) return;
    removeMut.reset();
    addMut.mutate(buildBody(config.addFields, draft));
  }

  function remove(key: string): void {
    addMut.reset();
    removeMut.mutate(key);
  }

  function runTest(url: string, key: string): void {
    if (!url.trim()) return;
    testMut.mutate({ url, key });
  }

  const testing = testMut.isPending;
  const testResultFor = (key: string) =>
    testMut.isSuccess && testMut.variables?.key === key ? testMut.data : null;

  const probeCell = (key: string, url: string) => {
    const result = testResultFor(key);
    return (
      <>
        <button type="button" className="cfg-mini" disabled={testing} onClick={() => runTest(url, key)}>
          {testing && testMut.variables?.key === key ? "testing…" : "test"}
        </button>
        {result ? <span className={`cfg-probe ${result.ok ? "ok" : "fail"}`}>{result.summary}</span> : null}
      </>
    );
  };

  /** Per-table cell layout (the SSR island's `rowCells`) — feeds get a stacked name+mono-url
   *  cell, tabular weight, and chip tags; any other table falls back to plain mono cells.
   *  (The SSR's aliases branch is not ported — the Aliases group retired into Normalization.) */
  function rowCells(row: Record<string, unknown>): React.ReactNode {
    if (config.slug === "feeds") {
      const tags = Array.isArray(row.tags) ? (row.tags as unknown[]) : [];
      return (
        <>
          <td>
            <div className="cfg-feed">
              <span className="cfg-feed-name">{cell(row.name) || "—"}</span>
              <span className="cfg-feed-url muted">{cell(row.url).replace(/^https?:\/\//, "")}</span>
            </div>
          </td>
          <td className="cfg-num">{Number(row.weight ?? 1).toFixed(1)}</td>
          <td>
            {tags.length ? (
              <span className="cfg-tags">
                {tags.map((t, i) => (
                  <span key={`${String(t)}-${i}`} className="cfg-tag">
                    {String(t)}
                  </span>
                ))}
              </span>
            ) : (
              <span className="muted">—</span>
            )}
          </td>
        </>
      );
    }
    return (
      <>
        {page.columns.map((c) => (
          <td key={c} className="cfg-mono">
            {cell(row[c])}
          </td>
        ))}
      </>
    );
  }

  /** The table's header labels (feeds: feed/weight/tags; otherwise the read's columns). */
  const headLabels = config.slug === "feeds" ? ["feed", "weight", "tags"] : page.columns;

  return (
    <div className="cfg-corpus">
      {failure ? <ErrorBanner message={`${failure.op} failed: ${failure.error}`} /> : null}

      <div className="cfg-table-wrap">
        <table className="cfg-table">
          <thead>
            <tr>
              {headLabels.map((h) => (
                <th key={h}>{h}</th>
              ))}
              <th className="cfg-th-act" />
            </tr>
          </thead>
          <tbody>
            {page.rows.map((row) => {
              const key = String((row as Record<string, unknown>)[config.pkColumn] ?? "");
              return (
                <tr key={key}>
                  {rowCells(row as Record<string, unknown>)}
                  <td className="cfg-row-act">
                    {config.testUrlColumn
                      ? probeCell(key, String((row as Record<string, unknown>)[config.testUrlColumn] ?? ""))
                      : null}
                    <RemoveButton disabled={busy} onClick={() => remove(key)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="cfg-add">
        <span className="cfg-add-label">Add</span>
        <div className="cfg-add-fields">
          {config.addFields.map((f) => (
            <Input
              key={f.key}
              className={f.key === config.addFields[0]?.key && config.addFields.length > 1 ? "cfg-add-wide" : "cfg-add-norm"}
              type={f.kind === "number" ? "number" : "text"}
              placeholder={f.label}
              aria-label={f.label}
              value={draft[f.key] ?? ""}
              onChange={(e) => setDraft({ ...draft, [f.key]: e.currentTarget.value })}
            />
          ))}
          <Button size="sm" disabled={busy} onClick={add}>
            {addMut.isPending ? "adding…" : "Add"}
          </Button>
          {config.testUrlColumn ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={testing}
              onClick={() => runTest(draft[config.testUrlColumn as string] ?? "", "__draft__")}
            >
              Test url
            </Button>
          ) : null}
        </div>
        {config.testUrlColumn && testResultFor("__draft__") ? (
          <span className={`cfg-probe ${testResultFor("__draft__")?.ok ? "ok" : "fail"}`}>
            {testResultFor("__draft__")?.summary}
          </span>
        ) : null}
      </div>
    </div>
  );
}
