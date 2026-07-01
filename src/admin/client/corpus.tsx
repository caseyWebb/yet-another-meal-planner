// The shared-corpus editor island (operator-admin) — one generic editor for the three
// remaining group-wide corpus tables not folded into Email Sources (aliases / flyer-terms /
// feeds); the table's identity, columns, PK, and add-form fields ride in the props. List +
// add + remove-by-PK, refetching after each write so the view is the authoritative server
// state. The in-flight mutation + its target + its failure are one `Action` union
// (one-at-a-time structural). The Feeds table additionally offers a read-only feed-probe
// test (per row + on the drafted URL), independent of the add/remove action. Matches the
// design mock's `CorpusEditor` (`ConfigScreen.jsx`): a `.cfg-table` with per-table cell
// rendering (feeds get a name+mono-url stacked cell, tabular weight, and chip tags; flyer
// terms + aliases render mono cells, aliases with an arrow between variant → canonical), a
// right-aligned actions cell (`.cfg-row-act`) holding the per-row probe (`.cfg-mini`/
// `.cfg-probe`) and the icon-only trash `RemoveButton`, and a `.cfg-add` panel below.

import { render, useState } from "hono/jsx/dom";
import { hc } from "hono/client";
import type { Child } from "hono/jsx";
import type { AdminApp } from "../app.js";
import { RemoveButton } from "../ui/kit.js";
import { ArrowRightIcon } from "../ui/icons.js";
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

  const probeCell = (key: string, url: string) => (
    <>
      <button class="cfg-mini" disabled={test.t === "testing"} onClick={() => runTest(url, key)}>
        {test.t === "testing" && test.key === key ? "testing…" : "test"}
      </button>
      {test.t === "result" && test.key === key ? <span class={`cfg-probe ${test.ok ? "ok" : "fail"}`}>{test.summary}</span> : null}
    </>
  );

  /** Per-table cell layout mirroring the mock's `renderCells` (design mock's `ConfigScreen.jsx`
   *  `GroupDiscovery`/`GroupFlyer`/`GroupAliases`) — feeds get a stacked name+mono-url cell,
   *  tabular weight, and chip tags; flyer terms render one mono cell; aliases render a mono
   *  variant → mono canonical pair with an arrow between. Any other table (defensive fallback,
   *  never hit by the three configured editors) falls back to plain text cells. */
  function rowCells(row: Record<string, unknown>): Child {
    if (config.slug === "feeds") {
      const tags = Array.isArray(row.tags) ? (row.tags as unknown[]) : [];
      return (
        <>
          <td>
            <div class="cfg-feed">
              <span class="cfg-feed-name">{cell(row.name) || "—"}</span>
              <span class="cfg-feed-url muted">{cell(row.url).replace(/^https?:\/\//, "")}</span>
            </div>
          </td>
          <td class="cfg-num">{Number(row.weight ?? 1).toFixed(1)}</td>
          <td>
            {tags.length ? (
              <span class="cfg-tags">
                {tags.map((t) => (
                  <span class="cfg-tag">{String(t)}</span>
                ))}
              </span>
            ) : (
              <span class="muted">—</span>
            )}
          </td>
        </>
      );
    }
    if (config.slug === "aliases") {
      return (
        <>
          <td class="cfg-mono">{cell(row.variant)}</td>
          <td class="cfg-mono cfg-canon">
            <ArrowRightIcon size={12} /> {cell(row.canonical)}
          </td>
        </>
      );
    }
    return (
      <>
        {rows.columns.map((c) => (
          <td class="cfg-mono">{cell(row[c])}</td>
        ))}
      </>
    );
  }

  /** The table's header labels — mirrors the mock's per-table `columns` arrays (feeds:
   *  feed/weight/tags; aliases: variant/canonical; flyer-terms: term). */
  const headLabels = config.slug === "feeds" ? ["feed", "weight", "tags"] : config.slug === "aliases" ? ["variant", "canonical"] : rows.columns;

  return (
    <div class="cfg-corpus">
      {action.t === "failed" ? (
        <div class="alert" data-variant="destructive">
          <section>
            {action.op.op === "add" ? "Add" : "Remove"} failed: {action.error}
          </section>
        </div>
      ) : null}

      <div class="cfg-table-wrap">
        <table class="cfg-table">
          <thead>
            <tr>
              {headLabels.map((h) => (
                <th>{h}</th>
              ))}
              <th class="cfg-th-act" />
            </tr>
          </thead>
          <tbody>
            {rows.rows.map((row) => {
              const key = String(row[config.pkColumn] ?? "");
              return (
                <tr>
                  {rowCells(row)}
                  <td class="cfg-row-act">
                    {config.testUrlColumn ? probeCell(key, String(row[config.testUrlColumn] ?? "")) : null}
                    <RemoveButton
                      disabled={busy}
                      onClick={() => remove(key)}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div class="cfg-add">
        <span class="cfg-add-label">Add</span>
        <div class="cfg-add-fields">
          {config.addFields.map((f) => (
            <input
              class={`input ${f.key === config.addFields[0]?.key && config.addFields.length > 1 ? "cfg-add-wide" : "cfg-add-norm"}`}
              type={f.kind === "number" ? "number" : "text"}
              placeholder={f.label}
              aria-label={f.label}
              value={draft[f.key] ?? ""}
              onInput={(e: Event) => setDraft({ ...draft, [f.key]: (e.target as HTMLInputElement).value })}
            />
          ))}
          <button class="btn" data-size="sm" disabled={busy} onClick={add}>
            {busy && action.t === "busy" && action.op.op === "add" ? "adding…" : "Add"}
          </button>
          {config.testUrlColumn ? (
            <button
              class="btn"
              data-variant="ghost"
              data-size="sm"
              disabled={test.t === "testing"}
              onClick={() => runTest(draft[config.testUrlColumn!] ?? "", "__draft__")}
            >
              Test url
            </button>
          ) : null}
        </div>
        {config.testUrlColumn && test.t === "result" && test.key === "__draft__" ? (
          <span class={`cfg-probe ${test.ok ? "ok" : "fail"}`}>{test.summary}</span>
        ) : null}
      </div>
    </div>
  );
}

// A Config group page may host more than one corpus editor (e.g. Discovery's Feeds editor
// alongside its calibration console), so this island mounts EVERY `[data-corpus-host]`
// element it finds, each paired with its own props script via a shared `data-id`.
for (const host of Array.from(document.querySelectorAll<HTMLElement>("[data-corpus-host]"))) {
  const id = host.dataset.id ?? "";
  const propsEl = document.getElementById(`corpus-props-${id}`) ?? document.getElementById("config-props");
  if (!propsEl) continue;
  const props = JSON.parse(propsEl.textContent ?? "{}") as { config: TableConfig; page: CorpusPage };
  host.replaceChildren();
  render(<CorpusEditor config={props.config} page={props.page} />, host);
}
