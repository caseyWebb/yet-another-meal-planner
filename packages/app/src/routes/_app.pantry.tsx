// Pantry (member-app-core 7.8): the needs-verification section (perishable
// categories + the 7-day staleness threshold, CLIENT-derived from served fields
// exactly like the mock), category groups, add form, qty edit (pantry `add` upsert),
// verify, remove. Renders comfortably at ~100+ rows (plain grouped lists, no
// per-row queries).
import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Button,
  EmptyState,
  GroupHeading,
  IconAlert,
  IconCheck,
  IconPlus,
  IconTrash,
  PageHead,
} from "@grocery-agent/ui";
import { usePantry, type PantryRow } from "../lib/data";
import { usePantryOps, usePantryVerify } from "../lib/mutations";
import { PERISHABLE, STALE_DAYS, daysSince } from "../lib/format";

export const Route = createFileRoute("/_app/pantry")({
  component: PantryPage,
});

function isStale(p: PantryRow): boolean {
  return (
    PERISHABLE.has(p.category ?? "") &&
    typeof p.last_verified_at === "string" &&
    daysSince(p.last_verified_at) >= STALE_DAYS
  );
}

function PantryPage() {
  const pantry = usePantry();
  const items = pantry.data?.items ?? [];

  const stale = items
    .filter(isStale)
    .sort((a, b) => daysSince(b.last_verified_at ?? "") - daysSince(a.last_verified_at ?? ""));
  const staleNames = new Set(stale.map((p) => p.name));
  const rest = items.filter((p) => !staleNames.has(p.name));
  const cats = new Map<string, PantryRow[]>();
  for (const p of rest) {
    const c = p.category ?? "other";
    cats.set(c, [...(cats.get(c) ?? []), p]);
  }
  const order = [...cats.keys()].sort();

  return (
    <div data-testid="pantry-page">
      <PageHead
        title="Pantry"
        sub={`${items.length} item${items.length === 1 ? "" : "s"} on hand${stale.length ? ` · ${stale.length} to verify` : ""}.`}
        actions={<AddForm />}
      />
      {pantry.data && items.length === 0 ? (
        <EmptyState title="Pantry is empty" sub="Add what you keep on hand so the agent can plan around it." />
      ) : (
        <>
          {stale.length ? (
            <section className="verify-section" data-testid="verify-section">
              <header className="verify-head">
                <h2>
                  <IconAlert /> Needs verification
                </h2>
                <p>Perishables you haven't checked in a while — they may be spoiled or used up. Verify to keep, or remove.</p>
              </header>
              {stale.map((p) => (
                <PantryItem key={p.name} item={p} stale />
              ))}
            </section>
          ) : null}
          {order.map((c) => (
            <div className="pantry-group" key={c} data-testid="pantry-group" data-category={c}>
              <GroupHeading>{c}</GroupHeading>
              {(cats.get(c) ?? []).map((p) => (
                <PantryItem key={p.name} item={p} />
              ))}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function PantryItem({ item, stale = false }: { item: PantryRow; stale?: boolean }) {
  const pantryOps = usePantryOps();
  const pantryVerify = usePantryVerify();
  const [qty, setQty] = React.useState(item.quantity ?? "");
  React.useEffect(() => setQty(item.quantity ?? ""), [item.quantity]);

  // Qty edit is the pantry `add` upsert (canonical-id keyed, merge rule preserves added_at).
  function commitQty() {
    if ((item.quantity ?? "") === qty) return;
    pantryOps.mutate({ operations: [{ op: "add", item: { name: item.name, quantity: qty, category: item.category } }] });
  }

  return (
    <div className={`pantry-item${stale ? " stale" : ""}`} data-testid="pantry-item" data-name={item.name}>
      <div className="pantry-main">
        <span className="pantry-name">{item.name}</span>
        {item.prepared_from ? <span className="pantry-prep">from {item.prepared_from}</span> : null}
        {stale ? (
          <span className="pantry-stale">{daysSince(item.last_verified_at ?? "")}d unchecked</span>
        ) : item.last_verified_at ? (
          <span className="pantry-verified">verified {item.last_verified_at}</span>
        ) : null}
      </div>
      <input
        className="input pantry-qty"
        value={qty}
        aria-label="Quantity"
        data-testid="pantry-qty"
        onChange={(e) => setQty(e.target.value)}
        onBlur={commitQty}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
      {stale ? (
        <Button size="sm" variant="outline" data-testid="pantry-verify" onClick={() => pantryVerify.mutate({ items: [item.name] })}>
          <IconCheck /> Verify
        </Button>
      ) : (
        <button
          type="button"
          className="icon-btn"
          title="Mark verified today"
          data-testid="pantry-verify"
          onClick={() => pantryVerify.mutate({ items: [item.name] })}
        >
          <IconCheck />
        </button>
      )}
      <button
        type="button"
        className="icon-btn"
        title="Remove"
        data-testid="pantry-remove"
        onClick={() => pantryOps.mutate({ operations: [{ op: "remove", name: item.name }] })}
      >
        <IconTrash />
      </button>
    </div>
  );
}

function AddForm() {
  const pantryOps = usePantryOps();
  const [name, setName] = React.useState("");
  const [category, setCategory] = React.useState("");
  const [qty, setQty] = React.useState("");

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    // Fire-and-clear (offline it queues; failures toast via the registered defaults).
    pantryOps.mutate({
      operations: [
        {
          op: "add",
          item: {
            name: name.trim(),
            category: category.trim().toLowerCase() || "other",
            ...(qty.trim() ? { quantity: qty.trim() } : {}),
          },
        },
      ],
    });
    setName("");
    setCategory("");
    setQty("");
  }

  return (
    <form className="field-inline pantry-add" onSubmit={onSubmit} data-testid="pantry-add">
      <input className="input" placeholder="Add to pantry…" autoComplete="off" aria-label="Item" value={name} onChange={(e) => setName(e.target.value)} />
      <input className="input p-cat" placeholder="category" autoComplete="off" aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)} />
      <input className="input p-qty" placeholder="qty" autoComplete="off" aria-label="Quantity" value={qty} onChange={(e) => setQty(e.target.value)} />
      <Button size="sm" type="submit">
        <IconPlus /> Add
      </Button>
    </form>
  );
}
