// Grocery (member-app-core 7.7 + member-app-grocery 5.x + member-app-differentiators
// 5.2/5.3, refactored by inline-substitution-hints): the page renders the DERIVED
// to-buy view — explicit and virtual (plan-derived) lines with `origin` attribution,
// pantry coverage, the `underived` notice — plus the P1 stored-row interactions, the
// order flow (preview → disposition → commit; ONLINE-ONLY), and the AISLE/CATEGORY
// grouping toggle over the ALWAYS-enriched to-buy read (?enrich=1) with the honest
// "Aisle unknown" bucket — never a fabricated aisle number; no multi-store picker
// (placements are the Kroger primary's only). The enriched read also carries each
// line's cheap cross-ingredient `substitutes[]` (siblings + `in_pantry` +
// `on_sale_hint`), rendered INLINE on the to-buy row (relation label, pantry/sale
// pills, a per-row Swap mapped to the real writes per line origin — add+remove /
// materialize+staged exclude — and a per-session dismiss); no separate substitutions
// panel. The same-identity price/availability alternatives (the slim
// `suggest_substitutions` op) surface instead in the ORDER DIALOG at preview time
// (reason pills with real prices, a per-row Swap that stages an order override).
import * as React from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  useGroceryAdd,
  useGroceryRemove,
  useGrocerySet,
  usePantryVerify,
} from "../lib/mutations";
import { useOnline } from "../lib/online";
import {
  Button,
  EmptyState,
  FacetChip,
  GroupHeading,
  IconAlert,
  IconCart,
  IconCheck,
  IconChevronRight,
  IconPlus,
  IconTrash,
  IconX,
  SegmentedControl,
  PageHead,
  toast,
} from "@grocery-agent/ui";
import { api, apiError } from "../lib/api";
import { PERISHABLE, STALE_DAYS, daysSince } from "../lib/format";
import {
  fetchSubstitutions,
  useGrocery,
  useProfile,
  useToBuy,
  type GroceryRow,
  type LineSuggestions,
  type OrderOutcome,
  type OrderRequest,
  type PantryCovered,
  type SiblingSuggestion,
  type SubstitutionAlternative,
  type ToBuyLine,
} from "../lib/data";

export const Route = createFileRoute("/_app/grocery")({
  component: GroceryPage,
});

const KIND_GROUPS: { kind: ToBuyLine["kind"]; label: string }[] = [
  { kind: "grocery", label: "Groceries" },
  { kind: "household", label: "Home goods" },
  { kind: "other", label: "Other" },
];

/** Refresh both grocery reads (the stored rows and the derived view share the prefix). */
async function refreshGrocery(qc: QueryClient): Promise<void> {
  await qc.invalidateQueries({ queryKey: ["grocery"] });
}

/**
 * MATERIALIZE a derived (plan-origin) line as an explicit `source:"menu"` row (D6): the
 * standard add upsert under the same canonical key, carrying the derived `for_recipes` —
 * so the stored row and the derived need merge (`origin:"both"` on the next read).
 * Class (b): the registry's grocery-add variables.
 */
function materializeVars(line: ToBuyLine): { name: string; source: string; for_recipes: string[] } {
  return { name: line.name, source: "menu", for_recipes: line.for_recipes };
}

/** A grouped rendering of the to-buy lines: label + optional department sub-groups. */
interface LineGroup {
  id: string;
  label: string;
  lines: ToBuyLine[];
  /** Sub-groups (the "Aisle unknown" bucket's departments); lines above render first. */
  subs?: { label: string; lines: ToBuyLine[] }[];
}

const KIND_LABEL: Record<ToBuyLine["kind"], string> = {
  grocery: "Groceries",
  household: "Home goods",
  other: "Other",
};

/**
 * Aisle-mode grouping (D6, client-side over the enriched read): numeric aisle groups
 * first; lines without a captured aisle collect in an EXPLICIT "Aisle unknown" bucket
 * sub-grouped by department — never a fabricated aisle number. With no resolvable
 * store location at all, groups fall back to department, then the kind buckets.
 */
function groupByAisle(lines: ToBuyLine[], hasLocation: boolean): LineGroup[] {
  if (!hasLocation) {
    // Department tiers (the graph fallback), then kind buckets for the rest.
    const byDept = new Map<string, ToBuyLine[]>();
    const rest: ToBuyLine[] = [];
    for (const l of lines) {
      const dept = l.placement?.department;
      if (dept) (byDept.get(dept) ?? byDept.set(dept, []).get(dept)!).push(l);
      else rest.push(l);
    }
    const groups: LineGroup[] = [...byDept.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([dept, ls]) => ({ id: `dept-${dept}`, label: dept, lines: ls }));
    for (const grp of KIND_GROUPS) {
      const ls = rest.filter((l) => l.kind === grp.kind);
      if (ls.length) groups.push({ id: grp.kind, label: `Category: ${grp.label}`, lines: ls });
    }
    return groups;
  }

  const byAisle = new Map<string, ToBuyLine[]>();
  const unknown: ToBuyLine[] = [];
  for (const l of lines) {
    const n = l.placement?.aisle_number;
    if (n) (byAisle.get(n) ?? byAisle.set(n, []).get(n)!).push(l);
    else unknown.push(l);
  }
  const groups: LineGroup[] = [...byAisle.entries()]
    .sort((a, b) => Number(a[0]) - Number(b[0]) || a[0].localeCompare(b[0]))
    .map(([n, ls]) => {
      const desc = ls.find((l) => l.placement?.aisle_description)?.placement?.aisle_description;
      return { id: `aisle-${n}`, label: `Aisle ${n}${desc ? ` · ${desc}` : ""}`, lines: ls };
    });
  if (unknown.length) {
    const byDept = new Map<string, ToBuyLine[]>();
    const noDept: ToBuyLine[] = [];
    for (const l of unknown) {
      const dept = l.placement?.department ?? (l.kind !== "grocery" ? KIND_LABEL[l.kind] : null);
      if (dept) (byDept.get(dept) ?? byDept.set(dept, []).get(dept)!).push(l);
      else noDept.push(l);
    }
    groups.push({
      id: "unknown",
      label: "Aisle unknown",
      lines: noDept,
      subs: [...byDept.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([label, ls]) => ({ label, lines: ls })),
    });
  }
  return groups;
}

function GroceryPage() {
  const grocery = useGrocery();
  // The grouping toggle (5.3) is a pure client-side render choice now — the read is
  // ALWAYS the enriched view (inline-substitution-hints D1/D2) so substitute hints
  // render under both modes, not just aisle mode.
  const [groupMode, setGroupMode] = React.useState<"category" | "aisle">("category");
  const toBuy = useToBuy(true);
  const profile = useProfile();
  const qc = useQueryClient();
  const online = useOnline();
  const setMutation = useGrocerySet();
  const removeMutation = useGroceryRemove();
  const [orderOpen, setOrderOpen] = React.useState(false);
  // The inline substitute hints' per-session client state (D6/D7): dismissals are
  // never persisted, and a cross-ingredient swap on a virtual (plan) row stages an
  // order-scoped exclude carried into the order dialog's preview/commit — nothing
  // persists server-side until the order is placed.
  const [dismissed, setDismissed] = React.useState<ReadonlySet<string>>(new Set());
  const [stagedExcludes, setStagedExcludes] = React.useState<ReadonlySet<string>>(new Set());

  const rows = grocery.data?.items ?? [];
  const view = toBuy.data;
  const lines = view?.to_buy ?? [];
  const inCart = rows.filter((g) => g.status === "in_cart");
  // Stored-row state joined onto the view lines (quantity annotation, note).
  const rowByName = new Map(rows.map((r) => [r.name.toLowerCase(), r]));

  // The order affordance renders only for a Kroger primary with a linked account (D7).
  const stores = (profile.data?.preferences?.stores ?? {}) as { primary?: string };
  const krogerPrimary = (stores.primary ?? "kroger").toLowerCase() === "kroger";
  const krogerReady = krogerPrimary && profile.data?.kroger.linked === true;

  function dismiss(keys: string[]) {
    setDismissed((cur) => new Set([...cur, ...keys]));
  }

  /** Cross-ingredient swap accept (inline list hint, D6/D7), mapped per line origin:
   *  an explicit row (`list`/`both`) is the real add + remove; a virtual (`plan`) row
   *  materializes the replacement and stages an order-scoped `exclude` of the
   *  original, applied at the eventual `place_order` — the plan itself is untouched. */
  async function swapSibling(line: ToBuyLine, sib: SiblingSuggestion, rowKey: string) {
    const origin = line.origin;
    // The replacement lands as an explicit row carrying the mock's provenance note.
    const added = await api.api.grocery.items
      .$post({ json: { name: sib.id, note: `swapped from ${line.name}` } })
      .catch(() => null);
    if (!added?.ok) {
      toast("Couldn't add the replacement — try again");
      return;
    }
    if (origin === "list" || origin === "both") {
      await api.api.grocery.items[":name"].$delete({ param: { name: line.name } }).catch(() => null);
    }
    if (origin === "plan" || origin === "both") {
      // A derived line has no row to remove (and removing a `both` row un-pins, not
      // un-plans): exclude it from THIS order only — the plan still lists it.
      setStagedExcludes((cur) => new Set([...cur, line.name]));
    }
    dismiss([rowKey]);
    toast(
      origin === "list"
        ? `Swapped ${line.name} for ${sib.label}`
        : `Added ${sib.label}; ${line.name} is excluded from this order — the plan still lists it`,
    );
    await refreshGrocery(qc);
  }

  function clearPurchased() {
    // Received is terminal REMOVAL (docs/TOOLS.md): drop each in_cart row — per-item
    // registry mutations (each queues independently offline; replay stays row-wise).
    for (const g of inCart) removeMutation.mutate({ name: g.name });
    toast("Purchased items cleared");
  }

  function markOrderPlaced() {
    // The user-asserted in_cart → ordered advance, per item (class (b) explicit set);
    // the shared W3 guard enforces the transition and stamps ordered_at. Failures
    // surface through the registry's error toast.
    for (const g of inCart) setMutation.mutate({ name: g.name, status: "ordered" });
    toast("Order marked placed");
  }

  const groups: LineGroup[] =
    groupMode === "aisle"
      ? groupByAisle(lines, view?.location != null)
      : KIND_GROUPS.map((grp) => ({
          id: grp.kind,
          label: `Category: ${grp.label}`,
          lines: lines.filter((l) => l.kind === grp.kind),
        })).filter((grp) => grp.lines.length > 0);

  const empty = view && lines.length === 0 && rows.length === 0;

  return (
    <div data-testid="grocery-page">
      <PageHead
        title="Grocery list"
        sub={`${lines.length} to buy${inCart.length ? ` · ${inCart.length} in cart` : ""}.`}
      />
      {lines.length > 0 ? (
        <div className="g-toolbar">
          <div className="g-groupmode" data-testid="group-mode">
            <SegmentedControl
              name="group-mode"
              value={groupMode}
              options={["category", "aisle"] as const}
              labelFor={(v) => (v === "aisle" ? "Aisle" : "Category")}
              onChange={setGroupMode}
            />
          </div>
          {/* Ordering is ONLINE-ONLY (D5/D10): disabled with a hint offline, never
              queued — reconnect re-enables, nothing auto-fires. */}
          {krogerReady ? (
            <Button
              size="sm"
              data-testid="order-open"
              disabled={!online}
              title={online ? undefined : "You're offline — ordering needs Kroger"}
              onClick={() => setOrderOpen(true)}
            >
              <IconCart /> Add all to Kroger cart
            </Button>
          ) : null}
        </div>
      ) : null}
      {orderOpen ? (
        <OrderPanel
          inCartCount={inCart.length}
          staged={{ excludes: stagedExcludes }}
          onClose={() => setOrderOpen(false)}
        />
      ) : null}
      {view?.pantry_covered.length ? <PantryHave covered={view.pantry_covered} /> : null}
      {view?.underived.length ? (
        <p className="g-underived" data-testid="grocery-underived">
          Ingredients for {view.underived.join(", ")} aren't derived yet — their items may be missing from this list.
        </p>
      ) : null}
      {empty ? (
        <>
          <EmptyState title="List is empty" sub="Add items, or plan a meal to pull ingredients in." />
          <AddRow />
        </>
      ) : (
        <>
          {groups.map((grp) => (
            <div className="g-group" key={grp.id} data-testid={`grocery-group-${grp.id}`}>
              <GroupHeading>{grp.label}</GroupHeading>
              {grp.lines.length ? (
                <ul className="g-list">
                  {grp.lines.map((l) => (
                    <ToBuyItem
                      key={l.key}
                      line={l}
                      row={rowByName.get(l.name.toLowerCase())}
                      online={online}
                      dismissed={dismissed}
                      onDismiss={dismiss}
                      onSwapSibling={(s, k) => void swapSibling(l, s, k)}
                    />
                  ))}
                </ul>
              ) : null}
              {grp.subs?.map((sub) => (
                <div className="g-subgroup" key={sub.label} data-testid="grocery-subgroup" data-dept={sub.label}>
                  <h3 className="g-subhead">{sub.label}</h3>
                  <ul className="g-list">
                    {sub.lines.map((l) => (
                      <ToBuyItem
                        key={l.key}
                        line={l}
                        row={rowByName.get(l.name.toLowerCase())}
                        online={online}
                        dismissed={dismissed}
                        onDismiss={dismiss}
                        onSwapSibling={(s, k) => void swapSibling(l, s, k)}
                      />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ))}
          <AddRow />
          {inCart.length ? (
            <div className="g-cart-group" data-testid="grocery-in-cart">
              <div className="group-h-row">
                <GroupHeading>In cart</GroupHeading>
                <span>
                  <Button variant="outline" size="sm" data-testid="mark-order-placed" onClick={markOrderPlaced}>
                    Mark order placed
                  </Button>{" "}
                  <Button variant="ghost" size="sm" data-testid="clear-purchased" onClick={clearPurchased}>
                    Clear purchased
                  </Button>
                </span>
              </div>
              <ul className="g-list dim">
                {inCart.map((g) => (
                  <InCartItem key={g.name} item={g} />
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

/** One to-buy line: explicit (P1 behaviors) or virtual (plan cue, pin, no remove — D6),
 *  plus its INLINE substitute hints (inline-substitution-hints D6/D7): each
 *  `line.substitutes[]` entry (present only on the enriched read) renders relation-
 *  labeled, with `in_pantry`/`on_sale_hint` pills, a per-row accept (Swap — the same
 *  add+remove / materialize+staged-exclude writes `swapSibling` always did) and a
 *  per-session dismiss. A line with no (or fully dismissed) substitutes renders with
 *  no extra container — the honest-sparsity contract (D6). */
function ToBuyItem({
  line,
  row,
  online,
  dismissed,
  onDismiss,
  onSwapSibling,
}: {
  line: ToBuyLine;
  row?: GroceryRow;
  online: boolean;
  dismissed: ReadonlySet<string>;
  onDismiss: (rowKeys: string[]) => void;
  onSwapSibling: (sib: SiblingSuggestion, rowKey: string) => void;
}) {
  const addMutation = useGroceryAdd();
  const setMutation = useGrocerySet();
  const removeMutation = useGroceryRemove();
  const virtual = line.origin === "plan";
  const visibleSubs = (line.substitutes ?? []).filter((s) => !dismissed.has(`${line.key}::sib:${s.id}`));

  function toggleCart() {
    if (virtual) {
      // A virtual line has no row to advance — materialize first (D6), then set
      // in-cart. Both fire immediately: the shared class (b) scope serializes them
      // (online and on replay), and both persist if the app closes offline between.
      addMutation.mutate(materializeVars(line));
    }
    setMutation.mutate({ name: line.name, status: "in_cart" });
  }

  return (
    <li
      className="g-item"
      data-testid="grocery-item"
      data-name={line.name}
      data-origin={line.origin}
    >
      <button
        type="button"
        className="g-check"
        aria-pressed={false}
        title="Mark in cart"
        data-testid="cart-toggle"
        onClick={toggleCart}
      >
        {null}
      </button>
      <div className="g-main">
        <div className="g-top">
          <span className="g-name">{line.name}</span>
          <span className="g-qty">
            {row ? row.quantity : line.assumed_quantity ? "1 (assumed)" : String(line.quantity)}
          </span>
        </div>
        <div className="g-sub">
          {virtual ? (
            <span className="g-origin" data-testid="origin-plan">
              from your plan
            </span>
          ) : (
            <FacetChip>
              <span className="g-src">{(row?.source ?? "menu").replace("_", "-")}</span>
            </FacetChip>
          )}
          {line.origin === "both" ? (
            <span className="g-origin" data-testid="origin-both">
              pinned · from your plan
            </span>
          ) : null}
          {line.for_recipes.length ? (
            <span className="g-for">
              for{" "}
              {line.for_recipes.map((s, i) => (
                <React.Fragment key={s}>
                  {i > 0 ? ", " : null}
                  <Link to="/recipe/$slug" params={{ slug: s }}>
                    {s}
                  </Link>
                </React.Fragment>
              ))}
            </span>
          ) : null}
          {line.note ? <span className="g-note">· {line.note}</span> : null}
        </div>
        {visibleSubs.length > 0 ? (
          <ul className="subs-list">
            {visibleSubs.map((sib) => {
              const rowKey = `${line.key}::sib:${sib.id}`;
              return (
                <li className="subs-row" key={sib.id} data-testid="subs-row" data-for={line.name}>
                  <div className="subs-swap">
                    <span className="subs-from">{line.name}</span>
                    <IconChevronRight />
                    <span className="subs-to">{sib.label}</span>
                    <span className="subs-why" data-testid="subs-relation">
                      {RELATION_LABEL[sib.relation.role]}
                      {sib.relation.via ? ` · via ${sib.relation.via}` : ""}
                    </span>
                    {sib.in_pantry ? (
                      <span className="subs-why" data-testid="subs-pantry-hit">
                        in your pantry
                      </span>
                    ) : null}
                    {sib.on_sale_hint ? (
                      <span className="subs-why" data-testid="subs-sale-hint">
                        on sale — ${sib.on_sale_hint.price.promo.toFixed(2)} at your store
                      </span>
                    ) : null}
                  </div>
                  <div className="subs-actions">
                    <Button
                      size="sm"
                      data-testid="subs-accept"
                      disabled={!online}
                      title={online ? undefined : "You're offline — substitutions need the store"}
                      onClick={() => onSwapSibling(sib, rowKey)}
                    >
                      Swap
                    </Button>
                    <Button size="sm" variant="ghost" data-testid="subs-dismiss" onClick={() => onDismiss([rowKey])}>
                      Keep
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
      {virtual ? (
        <button
          type="button"
          className="icon-btn"
          title="Keep on list (pin)"
          data-testid="grocery-pin"
          onClick={() => addMutation.mutate(materializeVars(line))}
        >
          <IconPlus />
        </button>
      ) : (
        <button
          type="button"
          className="icon-btn"
          title="Remove"
          data-testid="grocery-remove"
          onClick={() => removeMutation.mutate({ name: line.name })}
        >
          <IconTrash />
        </button>
      )}
    </li>
  );
}

/** An in-cart stored row (the P1 rendering: un-cart toggle, remove). */
function InCartItem({ item }: { item: GroceryRow }) {
  const setMutation = useGrocerySet();
  const removeMutation = useGroceryRemove();
  return (
    <li className="g-item in-cart" data-testid="grocery-item" data-name={item.name}>
      <button
        type="button"
        className="g-check"
        aria-pressed={true}
        title="Move back to list"
        data-testid="cart-toggle"
        onClick={() => setMutation.mutate({ name: item.name, status: "active" })}
      >
        <IconCheck />
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
        </div>
      </div>
      <button
        type="button"
        className="icon-btn"
        title="Remove"
        data-testid="grocery-remove"
        onClick={() => removeMutation.mutate({ name: item.name })}
      >
        <IconTrash />
      </button>
    </li>
  );
}

/** "Already in your pantry" — the view's coverage rows with verify / buy-fresh nudges. */
function PantryHave({ covered }: { covered: PantryCovered[] }) {
  const addMutation = useGroceryAdd();
  const verifyMutation = usePantryVerify();

  function verify(name: string) {
    verifyMutation.mutate(
      { items: [name] },
      { onSuccess: () => toast(`${name} verified`) },
    );
  }

  function buyFresh(item: PantryCovered) {
    // Materialize onto the list (the pantry still covers it in the view; at order time it
    // returns as a `partial` the member confirms — the include_partials intent).
    addMutation.mutate(
      { name: item.name, source: "menu", for_recipes: item.for_recipes },
      { onSuccess: () => toast(`${item.name} added to the list — confirm it at order time (pantry still has some)`) },
    );
  }

  const rank = (c: PantryCovered) => {
    const perish = PERISHABLE.has(c.on_hand.category ?? "");
    const stale = perish && c.on_hand.last_verified_at != null && daysSince(c.on_hand.last_verified_at) >= STALE_DAYS;
    return stale ? 0 : perish ? 1 : 2;
  };
  const sorted = [...covered].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));

  return (
    <section className="pantry-have" data-testid="pantry-have">
      <header className="ph-head">
        <div>
          <h2>
            <IconCheck /> Already in your pantry
          </h2>
          <p>
            Your planned recipes need these, but you already have them — no need to buy. Give the flagged
            perishables a quick check.
          </p>
        </div>
      </header>
      <ul className="ph-list">
        {sorted.map((c) => {
          const perish = PERISHABLE.has(c.on_hand.category ?? "");
          const days = c.on_hand.last_verified_at != null ? daysSince(c.on_hand.last_verified_at) : null;
          const stale = perish && days != null && days >= STALE_DAYS;
          return (
            <li className={`ph-item${stale ? " stale" : ""}`} key={c.name} data-testid="pantry-have-item" data-name={c.name}>
              <span className="ph-have" aria-hidden="true">
                <IconCheck />
              </span>
              <div className="ph-main">
                <div className="ph-top">
                  <span className="ph-name">{c.name}</span>
                  {c.on_hand.quantity ? <span className="ph-qty">{c.on_hand.quantity} on hand</span> : null}
                </div>
                <div className="ph-sub">
                  {c.for_recipes.length ? <span>needed for {c.for_recipes.join(", ")}</span> : null}
                  {stale ? (
                    <>
                      <span className="ph-sep">·</span>
                      <span className="ph-flag warn" data-testid="ph-stale-flag">
                        <IconAlert /> {days}d unchecked — verify
                      </span>
                    </>
                  ) : perish ? (
                    <>
                      <span className="ph-sep">·</span>
                      <span className="ph-flag">perishable</span>
                    </>
                  ) : null}
                </div>
              </div>
              {stale ? (
                <div className="ph-actions">
                  <Button size="sm" variant="outline" data-testid="ph-verify" onClick={() => verify(c.name)}>
                    <IconCheck /> Verify
                  </Button>
                  <Button size="sm" variant="ghost" data-testid="ph-buy" onClick={() => buyFresh(c)}>
                    Buy fresh
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ── Substitution rendering helpers, shared by the inline list hints (ToBuyItem, above)
// and the order dialog's alternatives (OrderPreview, below) — inline-substitution-
// hints D5-D7. ──────────────────────────────────────────────────────────────────────

/** Human unit price: base units (g/ml/ct) rendered in shopper units (oz / fl oz / ea). */
function unitPriceLabel(unitPrice: number | undefined, baseUnit: string | undefined): string | null {
  if (unitPrice === undefined || baseUnit === undefined) return null;
  if (baseUnit === "g") return `$${(unitPrice * 28.3495).toFixed(2)}/oz`;
  if (baseUnit === "ml") return `$${(unitPrice * 29.5735).toFixed(2)}/fl oz`;
  return `$${unitPrice.toFixed(2)}/ea`;
}

/** The alternative's reason pills — the CLOSED vocabulary, substantiated with numbers. */
function reasonPills(line: LineSuggestions, alt: SubstitutionAlternative): string[] {
  const pills: string[] = [];
  for (const r of alt.reasons) {
    if (r === "cheaper") {
      const a = unitPriceLabel(alt.unit_price, alt.base_unit);
      const c = unitPriceLabel(line.current?.unit_price, line.current?.base_unit);
      pills.push(a && c ? `cheaper — ${a} vs ${c}` : "cheaper");
    } else if (r === "on_sale") {
      pills.push(`on sale — $${alt.price.promo.toFixed(2)} (was $${alt.price.regular.toFixed(2)})`);
    } else {
      pills.push("in stock now");
    }
  }
  return pills;
}

const RELATION_LABEL: Record<SiblingSuggestion["relation"]["role"], string> = {
  satisfies: "can stand in",
  sibling: "same family",
  generalization: "the general form",
};

// ── The order panel (D7/D11): preview → disposition → commit over one endpoint. ──────

type OrderPhase =
  | { at: "loading" }
  | { at: "error"; message: string }
  | { at: "preview"; result: OrderOutcome }
  | { at: "committing"; result: OrderOutcome }
  | { at: "done"; result: OrderOutcome };

function OrderPanel({
  inCartCount,
  staged,
  onClose,
}: {
  inCartCount: number;
  /** An order-scoped exclude staged by an inline list-hint swap on a virtual (plan)
   *  row (D7): client state carried from the list into this dialog, applied at the
   *  preview/commit. Same-identity swaps are staged INSIDE this dialog now (the
   *  alternatives fetch below), not carried in from the list. */
  staged?: { excludes: ReadonlySet<string> };
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [phase, setPhase] = React.useState<OrderPhase>({ at: "loading" });
  // Dispositions, keyed by line name (the op resolves them through the canonical
  // funnel) — seeded with the inline hints' staged excludes.
  const [excluded, setExcluded] = React.useState<Set<string>>(new Set(staged?.excludes ?? []));
  const [quantities, setQuantities] = React.useState<Record<string, number>>({});
  const [picks, setPicks] = React.useState<Record<string, string>>({});
  const [confirmedPartials, setConfirmedPartials] = React.useState<Set<string>>(new Set());
  const [cartAcknowledged, setCartAcknowledged] = React.useState(false);
  // The same-identity alternatives (inline-substitution-hints D5), keyed by resolved
  // line name — fetched ONLINE-ONLY at preview time, best-effort: a failure here must
  // not block the order preview itself, it just shows no alternatives pills.
  const [alternatives, setAlternatives] = React.useState<Record<string, LineSuggestions>>({});

  // The order flow is ONLINE-ONLY (D7/D12): plain fetches through the typed client —
  // never a persisted/replayed mutation (the cart write is not idempotent).
  const post = React.useCallback(async (body: OrderRequest): Promise<OrderOutcome> => {
    const res = await api.api.grocery.order.$post({ json: body });
    if (!res.ok) throw await apiError(res);
    return (await res.json()) as OrderOutcome;
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    // The preview carries any staged exclude so the member reviews the REAL cart —
    // a plan-derived line swapped away inline drops before resolution.
    const stagedExcludes = staged?.excludes ?? new Set<string>();
    post({
      preview: true,
      ...(stagedExcludes.size ? { exclude: [...stagedExcludes] } : {}),
    })
      .then((result) => {
        if (cancelled) return;
        setPhase({ at: "preview", result });
        const names = result.resolved.map((l) => l.name);
        if (names.length === 0) return;
        // Best-effort — the preview itself already succeeded; a failure here simply
        // renders no alternatives pills (D5's scenario "No alternatives renders
        // nothing" degrades the same way as a fetch error).
        fetchSubstitutions({ names })
          .then((subs) => {
            if (cancelled) return;
            const byName: Record<string, LineSuggestions> = {};
            for (const line of subs.suggestions) byName[line.for.name] = line;
            setAlternatives(byName);
          })
          .catch(() => {});
      })
      .catch((e: { message?: string }) => {
        if (!cancelled) setPhase({ at: "error", message: e.message || "Preview failed" });
      });
    return () => {
      cancelled = true;
    };
    // staged is captured at open — the panel owns disposition state from here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post]);

  async function commit(preview: OrderOutcome) {
    setPhase({ at: "committing", result: preview });
    try {
      const result = await post({
        exclude: [...excluded],
        quantities,
        overrides: Object.entries(picks).map(([name, sku]) => ({ name, sku })),
        include_partials: [...confirmedPartials],
      });
      setPhase({ at: "done", result });
      // Refetch the truth: lines the cart actually took are now in_cart.
      await refreshGrocery(qc);
    } catch (e) {
      setPhase({ at: "error", message: (e as { message?: string }).message || "Order failed" });
    }
  }

  async function relinkKroger() {
    const res = await api.api.profile["kroger-login-url"].$get().catch(() => null);
    if (!res?.ok) {
      toast("Couldn't mint the Kroger link — try again");
      return;
    }
    const { url } = (await res.json()) as { url: string };
    window.open(url, "_blank", "noopener");
  }

  const staleCart = inCartCount > 0;
  const commitArmed = !staleCart || cartAcknowledged;

  return (
    <section className="order-panel" data-testid="order-panel">
      <header className="order-head">
        <div>
          <h2>
            <IconCart /> Kroger order
          </h2>
          <p>Review what an order would buy right now, sort out the flagged items, then send it to your cart.</p>
        </div>
        <button className="icon-btn" data-testid="order-close" title="Close" onClick={onClose}>
          <IconX />
        </button>
      </header>

      {staleCart ? (
        <div className="order-warn" data-testid="order-stale-warning">
          <IconAlert />
          {inCartCount} item{inCartCount === 1 ? "" : "s"} from a prior order {inCartCount === 1 ? "is" : "are"} still
          marked in-cart and never confirmed placed. The Kroger cart can't be read back — clear it in the Kroger app
          first so this order doesn't double-add.
          <label>
            <input
              type="checkbox"
              data-testid="order-stale-ack"
              checked={cartAcknowledged}
              onChange={(e) => setCartAcknowledged(e.target.checked)}
            />
            I've checked the Kroger cart
          </label>
        </div>
      ) : null}

      {phase.at === "loading" ? <p className="order-empty">Resolving your list against Kroger…</p> : null}
      {phase.at === "error" ? (
        <p className="order-empty" data-testid="order-error">
          {phase.message}
        </p>
      ) : null}

      {phase.at === "preview" || phase.at === "committing" ? (
        <OrderPreview
          result={phase.result}
          alternatives={alternatives}
          busy={phase.at === "committing"}
          excluded={excluded}
          setExcluded={setExcluded}
          quantities={quantities}
          setQuantities={setQuantities}
          picks={picks}
          setPicks={setPicks}
          confirmedPartials={confirmedPartials}
          setConfirmedPartials={setConfirmedPartials}
          commitArmed={commitArmed}
          onCommit={() => void commit(phase.result)}
        />
      ) : null}

      {phase.at === "done" ? <OrderResult result={phase.result} onRelink={() => void relinkKroger()} /> : null}
    </section>
  );
}

function priceLabel(l: { price?: { regular: number; promo: number }; on_sale?: boolean }): string | null {
  if (!l.price) return null;
  const effective = l.on_sale && l.price.promo > 0 ? l.price.promo : l.price.regular;
  return `$${effective.toFixed(2)}${l.on_sale ? " on sale" : ""}`;
}

function OrderPreview(props: {
  result: OrderOutcome;
  /** The slim substitution op's same-identity alternatives (inline-substitution-hints
   *  D5), keyed by resolved line name — empty until the online-only fetch resolves. */
  alternatives: Record<string, LineSuggestions>;
  busy: boolean;
  excluded: Set<string>;
  setExcluded: (v: Set<string>) => void;
  quantities: Record<string, number>;
  setQuantities: (v: Record<string, number>) => void;
  picks: Record<string, string>;
  setPicks: (v: Record<string, string>) => void;
  confirmedPartials: Set<string>;
  setConfirmedPartials: (v: Set<string>) => void;
  commitArmed: boolean;
  onCommit: () => void;
}) {
  const { result } = props;
  const toggleExclude = (name: string) => {
    const next = new Set(props.excluded);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    props.setExcluded(next);
  };
  const togglePartial = (name: string) => {
    const next = new Set(props.confirmedPartials);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    props.setConfirmedPartials(next);
  };
  /** Same-identity swap accept (D5/D7): stages a `place_order` `override` — no server
   *  state changes until the order commit, where the forced SKU is revalidated. */
  const acceptAlternative = (name: string, alt: SubstitutionAlternative) => {
    props.setPicks({ ...props.picks, [name]: alt.sku });
    toast(`Swap staged — ${name} orders as ${alt.brand || alt.description} at the next Kroger order`);
  };

  return (
    <div data-testid="order-preview">
      {result.underived.length ? (
        <p className="order-empty" data-testid="order-underived">
          Not derived yet (items missing from this order): {result.underived.join(", ")}
        </p>
      ) : null}

      {result.resolved.length ? (
        <ul className="order-list">
          {result.resolved.map((l) => {
            const excluded = props.excluded.has(l.name);
            const price = priceLabel(l);
            const lineSugg = props.alternatives[l.name];
            const alt = lineSugg?.alternatives[0];
            // An alternatives row only when there is something to say (a reason, or the
            // current pick reads out of stock) — never a swap for swap's sake (D5,
            // reused from the panel's same filter).
            const showAlt = alt && (alt.reasons.length > 0 || lineSugg?.status === "current_unavailable");
            return (
              <React.Fragment key={l.name}>
                <li className={`order-row${excluded ? " excluded" : ""}`} data-testid="order-line" data-name={l.name}>
                  <div className="order-line">
                    <span className="order-name">{l.name}</span>
                    <span className="order-pick">
                      {l.brand}
                      {l.size ? ` · ${l.size}` : ""}
                    </span>
                    {price ? <span className={`order-price${l.on_sale ? " sale" : ""}`}>{price}</span> : null}
                  </div>
                  <div className="order-actions">
                    {l.assumed_quantity ? (
                      <span className="order-qty" data-testid="order-qty">
                        qty{" "}
                        <input
                          className="input"
                          type="number"
                          min={1}
                          max={99}
                          aria-label={`Quantity for ${l.name}`}
                          value={props.quantities[l.name] ?? l.quantity}
                          disabled={excluded || props.busy}
                          onChange={(e) => {
                            const n = Number(e.target.value);
                            if (Number.isInteger(n) && n >= 1 && n <= 99) {
                              props.setQuantities({ ...props.quantities, [l.name]: n });
                            }
                          }}
                        />
                      </span>
                    ) : (
                      <span className="order-qty">qty {l.quantity}</span>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      data-testid="order-exclude"
                      disabled={props.busy}
                      onClick={() => toggleExclude(l.name)}
                    >
                      {excluded ? "Include" : "Skip"}
                    </Button>
                  </div>
                </li>
                {showAlt ? (
                  <li className="subs-row" data-testid="subs-row" data-for={l.name}>
                    <div className="subs-swap">
                      <span className="subs-from">{l.name}</span>
                      {lineSugg!.status === "current_unavailable" ? (
                        <span className="subs-why warn" data-testid="subs-out-of-stock">
                          out of stock
                        </span>
                      ) : null}
                      <IconChevronRight />
                      <span className="subs-to">
                        {alt!.brand ? `${alt!.brand} · ` : ""}
                        {alt!.description}
                        {alt!.size ? ` · ${alt!.size}` : ""}
                      </span>
                      {reasonPills(lineSugg!, alt!).map((p) => (
                        <span className="subs-why" key={p} data-testid="subs-reason">
                          {p}
                        </span>
                      ))}
                    </div>
                    <div className="subs-actions">
                      {props.picks[l.name] === alt!.sku ? (
                        <Button size="sm" variant="outline" disabled data-testid="subs-staged">
                          Staged for the next order
                        </Button>
                      ) : (
                        <Button size="sm" data-testid="subs-accept" onClick={() => acceptAlternative(l.name, alt!)}>
                          Swap
                        </Button>
                      )}
                    </div>
                  </li>
                ) : null}
              </React.Fragment>
            );
          })}
        </ul>
      ) : (
        <p className="order-empty">Nothing to buy — the pantry covers the plan.</p>
      )}

      {result.checkpoint.length ? (
        <>
          <h3 className="order-section-h">Needs a decision</h3>
          <ul className="order-list" data-testid="order-checkpoint">
            {result.checkpoint.map((cp) => (
              <li className="order-row" key={cp.name} data-testid="order-checkpoint-item" data-name={cp.name}>
                <div className="order-line">
                  <span className="order-name">{cp.name}</span>
                  <span className="order-pick">{cp.message}</span>
                </div>
                {cp.kind === "ambiguous" && cp.candidates?.length ? (
                  <ul className="order-cands">
                    {cp.candidates.slice(0, 5).map((cand) => (
                      <li key={cand.sku}>
                        <label>
                          <input
                            type="radio"
                            name={`cand-${cp.name}`}
                            data-testid="order-cand"
                            data-sku={cand.sku}
                            checked={props.picks[cp.name] === cand.sku}
                            disabled={props.busy}
                            onChange={() => props.setPicks({ ...props.picks, [cp.name]: cand.sku })}
                          />
                          {cand.brand}
                          {cand.size ? ` · ${cand.size}` : ""} · ${" "}
                          {(cand.on_sale && cand.price.promo > 0 ? cand.price.promo : cand.price.regular).toFixed(2)}
                        </label>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="order-pick">left out of this order unless you pick a product</span>
                )}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {result.partials.length ? (
        <>
          <h3 className="order-section-h">Pantry says you have these</h3>
          <ul className="order-list" data-testid="order-partials">
            {result.partials.map((p) => (
              <li className="order-row" key={p.name} data-testid="order-partial" data-name={p.name}>
                <div className="order-line">
                  <span className="order-name">{p.name}</span>
                  {p.for_recipes.length ? <span className="order-pick">for {p.for_recipes.join(", ")}</span> : null}
                </div>
                <label className="order-qty">
                  <input
                    type="checkbox"
                    data-testid="order-partial-confirm"
                    checked={props.confirmedPartials.has(p.name)}
                    disabled={props.busy}
                    onChange={() => togglePartial(p.name)}
                  />
                  buy anyway
                </label>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <div className="order-foot">
        <Button data-testid="order-commit" disabled={!props.commitArmed || props.busy} onClick={props.onCommit}>
          {props.busy ? "Sending…" : "Send to Kroger cart"}
        </Button>
      </div>
    </div>
  );
}

/** The post-commit report: each write rendered independently and honestly (D7). */
function OrderResult({ result, onRelink }: { result: OrderOutcome; onRelink: () => void }) {
  const carted = result.cart.written;
  return (
    <div className="order-result" data-testid="order-result">
      <div className={`order-result-row ${carted ? "ok" : "fail"}`} data-testid="order-result-cart">
        {carted ? <IconCheck /> : <IconAlert />}
        {carted ? (
          <span>
            {result.cart.count ?? result.resolved.length} item{(result.cart.count ?? result.resolved.length) === 1 ? "" : "s"} sent to the Kroger cart.
          </span>
        ) : (
          <span>
            The cart was NOT written
            {result.cart.code === "reauth_required"
              ? " — Kroger needs to be re-linked."
              : result.cart.error
                ? ` — ${result.cart.error}`
                : "."}{" "}
            The items stay on your to-buy list.
            {result.cart.code === "reauth_required" ? (
              <>
                {" "}
                <Button size="sm" variant="outline" data-testid="order-relink" onClick={onRelink}>
                  Re-link Kroger
                </Button>
              </>
            ) : null}
          </span>
        )}
      </div>
      <div className={`order-result-row ${result.list.advanced ? "ok" : ""}`} data-testid="order-result-list">
        {result.list.advanced ? <IconCheck /> : <IconAlert />}
        <span>
          {result.list.advanced
            ? "The carted items moved to the In cart group."
            : "The list was not advanced — nothing is marked in-cart."}
        </span>
      </div>
      {result.checkpoint.length ? (
        <div className="order-result-row" data-testid="order-result-checkpoint">
          <IconAlert />
          <span>Not carted (needs a decision): {result.checkpoint.map((c) => c.name).join(", ")}.</span>
        </div>
      ) : null}
    </div>
  );
}

/** The keyboard-driven add row, rendered at the BOTTOM of the list (the mock). */
function AddRow() {
  const addMutation = useGroceryAdd();
  const [name, setName] = React.useState("");
  const [qty, setQty] = React.useState("");
  const nameRef = React.useRef<HTMLInputElement>(null);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    // Fire-and-clear: the optimistic row is the feedback (offline it queues; a
    // failure surfaces through the registry's error toast).
    addMutation.mutate({ name: name.trim(), ...(qty.trim() ? { quantity: qty.trim() } : {}) });
    setName("");
    setQty("");
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
      {/* Hidden submit: a form with two text inputs and no submit button gets no
          implicit Enter submission — this keeps the mock's press-Enter-to-add. */}
      <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
    </form>
  );
}
