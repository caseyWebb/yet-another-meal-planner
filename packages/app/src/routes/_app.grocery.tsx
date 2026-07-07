// Grocery list (member-app-core 7.7, D9): explicit rows only — category grouping
// (kind → Groceries / Home goods / Other, the mock's no-store mode), bottom add-row,
// per-item EXPLICIT in-cart set (optimistic) + remove, source facet + for_recipes
// links, and the "In cart" group whose "Clear purchased" removes each in_cart row
// (received is terminal removal). No store picker / aisles / substitutions / order
// placement / pantry cross-reference — later phases.
import * as React from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  Button,
  EmptyState,
  FacetChip,
  GroupHeading,
  IconCheck,
  IconPlus,
  IconTrash,
  PageHead,
  toast,
} from "@grocery-agent/ui";
import { api, apiError } from "../lib/api";
import { useGrocery, type GroceryRow } from "../lib/data";

export const Route = createFileRoute("/_app/grocery")({
  component: GroceryPage,
});

const KIND_GROUPS: { kind: GroceryRow["kind"]; label: string }[] = [
  { kind: "grocery", label: "Groceries" },
  { kind: "household", label: "Home goods" },
  { kind: "other", label: "Other" },
];

/** EXPLICIT in-cart set (never a toggle — D8), optimistic on the grocery cache. */
async function setInCart(qc: QueryClient, name: string, inCart: boolean): Promise<void> {
  qc.setQueryData<{ items: GroceryRow[] }>(["grocery"], (cur) =>
    cur
      ? { items: cur.items.map((i) => (i.name === name ? { ...i, status: inCart ? "in_cart" : "active" } : i)) }
      : cur,
  );
  const args = { param: { name }, json: { status: inCart ? "in_cart" : "active" } };
  const res = await api.api.grocery.items[":name"].$patch(args).catch(() => null);
  if (!res || !res.ok) {
    if (res) toast((await apiError(res)).message);
    else toast("Couldn't update the item — try again");
  }
  await qc.invalidateQueries({ queryKey: ["grocery"] });
}

async function removeItem(qc: QueryClient, name: string): Promise<void> {
  const res = await api.api.grocery.items[":name"].$delete({ param: { name } }).catch(() => null);
  if (!res?.ok) toast("Couldn't remove the item — try again");
  await qc.invalidateQueries({ queryKey: ["grocery"] });
}

function GroceryPage() {
  const grocery = useGrocery();
  const qc = useQueryClient();

  const items = grocery.data?.items ?? [];
  // The member surface treats `ordered` rows as gone-to-the-order-flow: they render
  // in no P1 group (order tracking is P3), matching the mock's active/in-cart split.
  const active = items.filter((g) => g.status === "active");
  const inCart = items.filter((g) => g.status === "in_cart");

  async function clearPurchased() {
    // Received is terminal REMOVAL (docs/TOOLS.md): drop each in_cart row.
    for (const g of inCart) {
      await api.api.grocery.items[":name"].$delete({ param: { name: g.name } }).catch(() => null);
    }
    toast("Purchased items cleared");
    await qc.invalidateQueries({ queryKey: ["grocery"] });
  }

  const groups = KIND_GROUPS.map((grp) => ({
    ...grp,
    items: active.filter((g) => g.kind === grp.kind),
  })).filter((grp) => grp.items.length > 0);

  return (
    <div data-testid="grocery-page">
      <PageHead
        title="Grocery list"
        sub={`${active.length} to buy${inCart.length ? ` · ${inCart.length} in cart` : ""}.`}
      />
      {grocery.data && items.length === 0 ? (
        <>
          <EmptyState title="List is empty" sub="Add items, or plan a meal to pull ingredients in." />
          <AddRow />
        </>
      ) : (
        <>
          {groups.map((grp) => (
            <div className="g-group" key={grp.kind} data-testid={`grocery-group-${grp.kind}`}>
              <GroupHeading>Category: {grp.label}</GroupHeading>
              <ul className="g-list">
                {grp.items.map((g) => (
                  <GroceryItem key={g.name} item={g} />
                ))}
              </ul>
            </div>
          ))}
          <AddRow />
          {inCart.length ? (
            <div className="g-cart-group" data-testid="grocery-in-cart">
              <div className="group-h-row">
                <GroupHeading>In cart</GroupHeading>
                <Button variant="ghost" size="sm" data-testid="clear-purchased" onClick={clearPurchased}>
                  Clear purchased
                </Button>
              </div>
              <ul className="g-list dim">
                {inCart.map((g) => (
                  <GroceryItem key={g.name} item={g} />
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function GroceryItem({ item }: { item: GroceryRow }) {
  const qc = useQueryClient();
  const carted = item.status === "in_cart";
  return (
    <li className={`g-item${carted ? " in-cart" : ""}`} data-testid="grocery-item" data-name={item.name}>
      <button
        type="button"
        className="g-check"
        aria-pressed={carted}
        title={carted ? "Move back to list" : "Mark in cart"}
        data-testid="cart-toggle"
        onClick={() => void setInCart(qc, item.name, !carted)}
      >
        {carted ? <IconCheck /> : null}
      </button>
      <div className="g-main">
        <div className="g-top">
          <span className="g-name">{item.name}</span>
          <span className="g-qty">{item.quantity}</span>
        </div>
        <div className="g-sub">
          <FacetChip>
            <span className="g-src">{item.source.replace("_", "-")}</span>
          </FacetChip>
          {item.for_recipes.length ? (
            <span className="g-for">
              for{" "}
              {item.for_recipes.map((s, i) => (
                <React.Fragment key={s}>
                  {i > 0 ? ", " : null}
                  <Link to="/recipe/$slug" params={{ slug: s }}>
                    {s}
                  </Link>
                </React.Fragment>
              ))}
            </span>
          ) : null}
          {item.note ? <span className="g-note">· {item.note}</span> : null}
        </div>
      </div>
      <button
        type="button"
        className="icon-btn"
        title="Remove"
        data-testid="grocery-remove"
        onClick={() => void removeItem(qc, item.name)}
      >
        <IconTrash />
      </button>
    </li>
  );
}

/** The keyboard-driven add row, rendered at the BOTTOM of the list (the mock). */
function AddRow() {
  const qc = useQueryClient();
  const [name, setName] = React.useState("");
  const [qty, setQty] = React.useState("");
  const nameRef = React.useRef<HTMLInputElement>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const res = await api.api.grocery.items
      .$post({ json: { name: name.trim(), ...(qty.trim() ? { quantity: qty.trim() } : {}) } })
      .catch(() => null);
    if (res?.ok) {
      setName("");
      setQty("");
      await qc.invalidateQueries({ queryKey: ["grocery"] });
    } else {
      toast("Couldn't add the item — try again");
    }
    nameRef.current?.focus();
  }

  return (
    <form className="g-add-row" onSubmit={onSubmit} data-testid="grocery-add-row">
      <span className="g-add-plus" aria-hidden="true">
        <IconPlus />
      </span>
      <input
        ref={nameRef}
        className="input"
        placeholder="Add an item — press Enter"
        autoComplete="off"
        aria-label="Item name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <input
        className="input g-qty-in"
        placeholder="qty"
        autoComplete="off"
        aria-label="Quantity"
        value={qty}
        onChange={(e) => setQty(e.target.value)}
      />
    </form>
  );
}
