// Email Sources (ported from the SSR client/email-sources.tsx island, Discovery group) — a
// presentation-layer consolidation of the `members` and `senders` shared-corpus tables into
// ONE interleaved list, each row tagged "member" (someone in the friend group) or "automated
// forward" (a third-party newsletter/service set up to auto-forward here). No schema change:
// two ["corpus", table] reads behind one list. Adding/removing a row routes to the correct
// underlying table based on the row's own `kind` (for remove) or the add form's selected
// `kind` (for add); every write invalidates BOTH tables so the merged list is always the
// authoritative server state.

import * as React from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, apiErrorOf, unwrap } from "../../lib/api";
import { corpusQuery, queryClient, type CorpusData } from "../../lib/queries";
import { Input, NativeSelect } from "@grocery-agent/ui";
import { Badge, Button, ErrorBanner, ItemGroup, RemoveButton } from "../../components/kit";

type Kind = "member" | "automated";

interface Row {
  address: string;
  kind: Kind;
}

function toRows(kind: Kind, page: CorpusData): Row[] {
  return page.rows.map((r) => ({ address: String((r as Record<string, unknown>).address ?? ""), kind }));
}

function tableFor(kind: Kind): "members" | "senders" {
  return kind === "member" ? "members" : "senders";
}

export function EmailSourcesEditor() {
  const membersQ = useQuery(corpusQuery("members"));
  const sendersQ = useQuery(corpusQuery("senders"));

  if (membersQ.status === "error" || sendersQ.status === "error") {
    const err = membersQ.error ?? sendersQ.error;
    return <ErrorBanner message={apiErrorOf(err)?.message ?? String(err)} />;
  }
  if (membersQ.status === "pending" || sendersQ.status === "pending") return <p className="muted">Loading…</p>;
  return <EmailSourcesBody members={membersQ.data} senders={sendersQ.data} />;
}

function EmailSourcesBody({ members, senders }: { members: CorpusData; senders: CorpusData }) {
  const rows: Row[] = [...toRows("member", members), ...toRows("automated", senders)];
  const [draft, setDraft] = React.useState<{ address: string; kind: Kind }>({ address: "", kind: "member" });

  const invalidateBoth = () => {
    void queryClient.invalidateQueries({ queryKey: ["corpus", "members"] });
    void queryClient.invalidateQueries({ queryKey: ["corpus", "senders"] });
  };

  const addMut = useMutation({
    mutationFn: (input: { address: string; kind: Kind }) =>
      unwrap(api.admin.api.corpus[":table"].$post({ param: { table: tableFor(input.kind) }, json: { address: input.address } })),
    onSuccess: (_data, input) => setDraft({ address: "", kind: input.kind }),
    onSettled: invalidateBoth,
  });

  const removeMut = useMutation({
    mutationFn: (row: Row) =>
      unwrap(api.admin.api.corpus[":table"][":key"].$delete({ param: { table: tableFor(row.kind), key: row.address } })),
    onSettled: invalidateBoth,
  });

  const busy = addMut.isPending || removeMut.isPending;
  const failure = addMut.isError
    ? { op: "Add", error: apiErrorOf(addMut.error)?.message ?? String(addMut.error) }
    : removeMut.isError
      ? { op: "Remove", error: apiErrorOf(removeMut.error)?.message ?? String(removeMut.error) }
      : null;

  function add(): void {
    const address = draft.address.trim();
    if (!address) return;
    removeMut.reset();
    addMut.mutate({ address, kind: draft.kind });
  }

  function remove(row: Row): void {
    addMut.reset();
    removeMut.mutate(row);
  }

  return (
    <div className="cfg-corpus">
      <p className="cfg-help muted small">
        Mail forwarded from these addresses skips taste-matching and is imported directly. <strong>Members</strong> are
        people in your group sharing recipes they like; <strong>automated forwards</strong> are third-party newsletters
        or services you've set up to forward here.
      </p>

      {failure ? <ErrorBanner message={`${failure.op} failed: ${failure.error}`} /> : null}

      <ItemGroup className="ai-list">
        {rows.map((row) => (
          <div key={`${row.kind}:${row.address}`} className="item ai-row">
            <section className="item-body">
              <span className="ai-addr">{row.address}</span>
            </section>
            <aside className="item-actions">
              <Badge variant="outline">{row.kind === "member" ? "member" : "automated"}</Badge>
              <RemoveButton disabled={busy} onClick={() => remove(row)} />
            </aside>
          </div>
        ))}
      </ItemGroup>

      <div className="cfg-add">
        <span className="cfg-add-label">Add address</span>
        <div className="cfg-add-fields">
          <Input
            className="cfg-add-wide"
            type="text"
            placeholder="email address"
            aria-label="email address"
            value={draft.address}
            onChange={(e) => setDraft({ ...draft, address: e.currentTarget.value })}
          />
          <NativeSelect
            className="cfg-add-norm"
            aria-label="kind"
            value={draft.kind}
            onChange={(e) => setDraft({ ...draft, kind: e.currentTarget.value as Kind })}
          >
            <option value="member">member</option>
            <option value="automated">automated forward</option>
          </NativeSelect>
          <Button size="sm" disabled={busy} onClick={add}>
            {addMut.isPending ? "adding…" : "Add"}
          </Button>
        </div>
      </div>
    </div>
  );
}
