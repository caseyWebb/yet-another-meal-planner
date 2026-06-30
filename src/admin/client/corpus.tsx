// The shared-corpus editor island (operator-admin) — one generic editor for all five tables
// (aliases / flyer-terms / feeds / senders / members); the table's identity, columns, PK, and
// add-form fields ride in the props. List + add + remove-by-PK, refetching after each write so the
// view is the authoritative server state. The in-flight mutation + its target + its failure are one
// `Action` union (one-at-a-time structural). The Feeds table additionally offers a read-only
// feed-probe test (per row + on the drafted URL), independent of the add/remove action.

import { render, useState } from "hono/jsx/dom";
import { hc } from "hono/client";
import type { AdminApp } from "../app.js";
import type { FeedProbeResult } from "../../discovery-probe.js";

const client = hc<AdminApp>(location.origin);

interface AddField {
  key: string;
  label: string;
  kind: "text" | "number" | "tags";
  required: boolean;
}
interface TableConfig {
  slug: string;
  pkColumn: string;
  addFields: AddField[];
  testUrlColumn?: string;
}
interface CorpusPage {
  table: string;
  columns: string[];
  rows: Record<string, unknown>[];
}

type Op = { op: "add" } | { op: "remove"; key: string };
type Action = { t: "idle" } | { t: "busy"; op: Op } | { t: "failed"; op: Op; error: string };
type Test = { t: "none" } | { t: "testing"; key: string } | { t: "result"; key: string; ok: boolean; summary: string };

function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

function buildBody(fields: AddField[], draft: Record<string, string>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const f of fields) {
    const raw = (draft[f.key] ?? "").trim();
    if (!raw && !f.required) continue;
    if (f.kind === "number") body[f.key] = Number(raw);
    else if (f.kind === "tags") body[f.key] = raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : [];
    else body[f.key] = raw;
  }
  return body;
}

function summarize(r: FeedProbeResult): string {
  const counts: Record<string, number> = {};
  for (const s of r.sample) counts[s.outcome] = (counts[s.outcome] ?? 0) + 1;
  const sample = Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", ");
  const feed = r.feed.reachable ? (r.feed.parsed ? `reachable, ${r.feed.itemCount} items` : "reachable, not parseable") : "unreachable";
  return r.sample.length ? `${feed} · sample: ${sample}` : feed;
}

async function readErr(res: { status: number; json: () => Promise<unknown> }): Promise<string> {
  const b = (await res.json().catch(() => null)) as { message?: string } | null;
  return b?.message ?? `HTTP ${res.status}`;
}

function CorpusEditor({ config, page }: { config: TableConfig; page: CorpusPage }) {
  const [rows, setRows] = useState<CorpusPage>(page);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [action, setAction] = useState<Action>({ t: "idle" });
  const [test, setTest] = useState<Test>({ t: "none" });

  const busy = action.t === "busy";

  async function refetch(): Promise<void> {
    const res = await client.admin.api.corpus[":table"].$get({ param: { table: config.slug } });
    if (res.ok) setRows((await res.json()) as CorpusPage);
  }

  async function add(): Promise<void> {
    for (const f of config.addFields) if (f.required && !(draft[f.key] ?? "").trim()) return;
    setAction({ t: "busy", op: { op: "add" } });
    const res = await client.admin.api.corpus[":table"].$post({ param: { table: config.slug }, json: buildBody(config.addFields, draft) });
    if (res.ok) {
      setDraft({});
      setAction({ t: "idle" });
      await refetch();
    } else {
      setAction({ t: "failed", op: { op: "add" }, error: await readErr(res) });
    }
  }

  async function remove(key: string): Promise<void> {
    setAction({ t: "busy", op: { op: "remove", key } });
    const res = await client.admin.api.corpus[":table"][":key"].$delete({ param: { table: config.slug, key } });
    if (res.ok) {
      setAction({ t: "idle" });
      await refetch();
    } else {
      setAction({ t: "failed", op: { op: "remove", key }, error: await readErr(res) });
    }
  }

  async function runTest(url: string, key: string): Promise<void> {
    if (!url.trim()) return;
    setTest({ t: "testing", key });
    const res = await client.admin.api.discovery["test-feed"].$post({ json: { url: url.trim() } });
    if (res.ok) {
      const r = (await res.json()) as FeedProbeResult;
      setTest({ t: "result", key, ok: r.feed.reachable, summary: summarize(r) });
    } else {
      setTest({ t: "result", key, ok: false, summary: await readErr(res) });
    }
  }

  const testCell = (key: string, url: string) => (
    <span class="log-actions">
      <button class="link" disabled={test.t === "testing"} onClick={() => runTest(url, key)}>
        {test.t === "testing" && test.key === key ? "testing…" : "test"}
      </button>
      {test.t === "result" && test.key === key ? (
        <span class={test.ok ? "muted small" : "small"} style={test.ok ? "" : "color:var(--danger)"}>
          {test.summary}
        </span>
      ) : null}
    </span>
  );

  return (
    <div>
      {action.t === "failed" ? (
        <div class="error">
          {action.op.op === "add" ? "Add" : "Remove"} failed: {action.error}
        </div>
      ) : null}
      <table>
        <thead>
          <tr>
            {rows.columns.map((c) => (
              <th>{c}</th>
            ))}
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.rows.map((row) => {
            const key = String(row[config.pkColumn] ?? "");
            return (
              <tr>
                {rows.columns.map((c) => (
                  <td class="small">{cell(row[c])}</td>
                ))}
                <td class="form-actions">
                  {config.testUrlColumn ? testCell(key, String(row[config.testUrlColumn] ?? "")) : null}
                  <button class="danger" disabled={busy} onClick={() => remove(key)}>
                    {busy && action.t === "busy" && action.op.op === "remove" && action.op.key === key ? "removing…" : "remove"}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div class="card-legacy">
        <h2>Add</h2>
        {config.addFields.map((f) => (
          <label>
            {f.label}
            {f.required ? "" : " (optional)"}
            <input
              type={f.kind === "number" ? "number" : "text"}
              value={draft[f.key] ?? ""}
              onInput={(e: Event) => setDraft({ ...draft, [f.key]: (e.target as HTMLInputElement).value })}
            />
          </label>
        ))}
        <div class="form-actions">
          <button disabled={busy} onClick={add}>
            {busy && action.t === "busy" && action.op.op === "add" ? "adding…" : "add"}
          </button>
          {config.testUrlColumn ? (
            <button class="link" disabled={test.t === "testing"} onClick={() => runTest(draft[config.testUrlColumn!] ?? "", "__draft__")}>
              test url
            </button>
          ) : null}
        </div>
        {config.testUrlColumn && test.t === "result" && test.key === "__draft__" ? (
          <p class={test.ok ? "muted small" : "small"} style={test.ok ? "" : "color:var(--danger)"}>
            {test.summary}
          </p>
        ) : null}
      </div>
    </div>
  );
}

const host = document.getElementById("config-island");
const propsEl = document.getElementById("config-props");
if (host && propsEl) {
  const props = JSON.parse(propsEl.textContent ?? "{}") as { config: TableConfig; page: CorpusPage };
  host.replaceChildren();
  render(<CorpusEditor config={props.config} page={props.page} />, host);
}
