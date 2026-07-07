// Cooking log (member-app-core 7.9, D4): most-recent-first bounded list (recipe rows
// link + carry facet chips; non-recipe types get the type badge), a log-a-cook select
// over the cached index (through the dedupe-guarded POST /api/log), and per-row
// remove (the member correction). The log starts near-empty in production — the
// empty state matters.
import * as React from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  Button,
  EmptyState,
  IconPlus,
  IconTrash,
  NativeSelect,
  PageHead,
  RecipeFacets,
  toast,
} from "@grocery-agent/ui";
import { api } from "../lib/api";
import { useIndex, useLog, type LogRow } from "../lib/data";
import { fmtDay, isoToday } from "../lib/format";

export const Route = createFileRoute("/_app/log")({
  component: LogPage,
});

function LogPage() {
  const log = useLog();
  const index = useIndex();
  const qc = useQueryClient();
  const [slug, setSlug] = React.useState("");

  const entries = log.data?.entries ?? [];

  async function logCook(e: React.FormEvent) {
    e.preventDefault();
    if (!slug) return;
    const res = await api.api.log
      .$post({ json: { type: "recipe", recipe: slug, date: isoToday() } })
      .catch(() => null);
    if (res?.ok) {
      toast("Logged as cooked");
      setSlug("");
      await qc.invalidateQueries({ queryKey: ["log"] });
      await qc.invalidateQueries({ queryKey: ["plan"] }); // logging clears the planned row
      await qc.invalidateQueries({ queryKey: ["vibes"] });
    } else {
      toast("Couldn't log the cook — try again");
    }
  }

  const head = (
    <form className="field-inline log-add" onSubmit={logCook} data-testid="log-add">
      <NativeSelect className="select" aria-label="Recipe cooked" value={slug} onChange={(e) => setSlug(e.target.value)}>
        <option value="">Log a cook…</option>
        {(index.data?.recipes ?? []).map((r) => (
          <option key={r.slug} value={r.slug}>
            {r.title}
          </option>
        ))}
      </NativeSelect>
      <Button size="sm" type="submit" disabled={!slug}>
        <IconPlus /> Log
      </Button>
    </form>
  );

  return (
    <div data-testid="log-page">
      <PageHead
        title="Cooking log"
        sub={`${entries.length} recent meal${entries.length === 1 ? "" : "s"} — cooked and out.`}
        actions={head}
      />
      {log.data && entries.length === 0 ? (
        <EmptyState title="No history yet" sub="Log a cook and it shows up here." />
      ) : (
        <div className="log-list" data-testid="log-list">
          {entries.map((e) => (
            <LogRowView key={e.id} entry={e} />
          ))}
        </div>
      )}
    </div>
  );
}

function LogRowView({ entry }: { entry: LogRow }) {
  const qc = useQueryClient();

  async function remove() {
    const res = await api.api.log[":id"].$delete({ param: { id: String(entry.id) } }).catch(() => null);
    if (!res?.ok) toast("Couldn't remove the entry — try again");
    await qc.invalidateQueries({ queryKey: ["log"] });
    await qc.invalidateQueries({ queryKey: ["vibes"] }); // derived recency heals organically
  }

  const title = entry.title ?? entry.name ?? entry.recipe ?? "—";
  return (
    <div className="log-row" data-testid="log-row" data-id={entry.id}>
      <span className="log-date">{fmtDay(entry.date)}</span>
      <div className="log-main">
        {entry.recipe ? (
          <Link className="log-title" to="/recipe/$slug" params={{ slug: entry.recipe }}>
            {title}
          </Link>
        ) : (
          <span className="log-title plain">{title}</span>
        )}
        <div className="log-facets">
          <RecipeFacets protein={entry.protein} cuisine={entry.cuisine} />
          {entry.type !== "recipe" ? <span className={`log-type log-type-${entry.type}`}>{entry.type.replace("_", " ")}</span> : null}
        </div>
      </div>
      <button type="button" className="icon-btn" title="Remove" data-testid="log-remove" onClick={remove}>
        <IconTrash />
      </button>
    </div>
  );
}
