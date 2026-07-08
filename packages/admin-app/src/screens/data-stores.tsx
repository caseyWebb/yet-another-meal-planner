// Data › Stores (operator-data-explorer): the shared registry list + the per-store
// identity/SKU/notes detail, ported from the SSR pages/data.tsx. Pure reads — the list
// renders `storesQuery` as-is and the detail assembles identity PrettyKV, the cached-SKU
// table (scoped to the store's `location_id`), and the tag-convention note groups.
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Badge, Card, DataTable, ErrorBanner, Item, ItemGroup, PrettyKV } from "../components/kit";
import { ChevronLeftIcon, ChevronRightIcon, StoreIcon } from "../components/icons";
import { storesQuery, storeDetailQuery, type StoresData, type StoreDetailData } from "../lib/queries";
import { assertNever } from "../lib/assert";
import { DataShell, queryErrorMessage } from "./data";

type StoreListEntry = StoresData["stores"][number];
type StoreNoteGroup = keyof StoreDetailData["notes"];
type StoreNoteRow = StoreDetailData["notes"][StoreNoteGroup][number];

// --- Stores list ----------------------------------------------------------------

const StoresList = ({ stores }: { stores: StoreListEntry[] }) => (
  <>
    <p className="recipe-hint muted small">{stores.length} stores in the shared registry</p>
    {stores.length === 0 ? (
      <p className="muted">No stores in the shared registry.</p>
    ) : (
      <ItemGroup className="recipe-list">
        {stores.map((s) => (
          <Link key={s.slug} className="item-link" to="/data/stores/$slug" params={{ slug: s.slug }}>
            <Item
              outline
              className="recipe-item"
              media={
                <span className="store-ico">
                  <StoreIcon size={16} />
                </span>
              }
              title={<span className="rtitle">{s.name}</span>}
              actions={
                <div className="ritem-trail">
                  {s.chain ? <Badge variant="secondary">{s.chain}</Badge> : null}
                  <ChevronRightIcon size={16} />
                </div>
              }
            >
              <div className="rsub">
                <span className="rslug">{s.slug}</span>
                <span className="rfacets">
                  {s.domain ? <span className="rfacet">{s.domain}</span> : null}
                  <span className="rfacet">{s.notes_count} notes</span>
                  {s.skus_count > 0 ? <span className="rfacet">{s.skus_count} SKUs</span> : null}
                </span>
              </div>
            </Item>
          </Link>
        ))}
      </ItemGroup>
    )}
  </>
);

export function StoresScreen() {
  const query = useQuery(storesQuery);
  const body = (() => {
    switch (query.status) {
      case "pending":
        return <p className="screen-loading">Loading …</p>;
      case "error":
        return <ErrorBanner message={queryErrorMessage(query.error)} />;
      case "success":
        return <StoresList stores={query.data.stores} />;
      default:
        return assertNever(query);
    }
  })();

  return (
    <DataShell active="stores">
      <h2>Stores</h2>
      {body}
    </DataShell>
  );
}

// --- Store detail ----------------------------------------------------------------

const STORE_NOTE_GROUPS: StoreNoteGroup[] = ["layout", "location", "stock", "general"];

const STORE_NOTE_GROUP_LABEL: Record<StoreNoteGroup, string> = {
  layout: "Layout",
  location: "Where-it-hides",
  stock: "Stock",
  general: "General",
};

const StoreNoteCards = ({ notes }: { notes: StoreNoteRow[] }) => (
  <div className="rd-notes">
    {notes.map((n) => (
      <div key={n.id} className="rd-note">
        <div className="rd-note-head">
          <span className="rd-note-author">@{n.author}</span>
          {n.private ? <Badge variant="outline">private</Badge> : null}
          {n.tags.map((t) => (
            <span key={t} className="rfacet">
              {t}
            </span>
          ))}
          <span className="rd-note-time muted small">{n.created_at ?? ""}</span>
        </div>
        <div className="rd-note-body">{n.body}</div>
      </div>
    ))}
  </div>
);

const StoreDetail = ({ payload }: { payload: StoreDetailData }) => {
  const identity = {
    chain: payload.chain,
    label: payload.label,
    domain: payload.domain,
    address: payload.address,
    location_id: payload.location_id,
  };
  const noteCount = STORE_NOTE_GROUPS.reduce((n, g) => n + payload.notes[g].length, 0);

  return (
    <DataShell active="stores" detail>
      <Link className="link-action rd-back" to="/data/stores">
        <ChevronLeftIcon size={15} /> All stores
      </Link>

      <div className="rd-head">
        <div>
          <h2 className="rd-title">{payload.name}</h2>
          <div className="rd-slug">{payload.slug}</div>
        </div>
        {payload.chain ? <Badge variant="secondary">{payload.chain}</Badge> : null}
      </div>

      <p className="group-label">Identity</p>
      <Card>
        <PrettyKV obj={identity} />
      </Card>

      <p className="group-label">
        Cached SKUs <span className="muted small">sku_cache · location {payload.location_id ?? "—"}</span>
      </p>
      {payload.skus.length > 0 ? (
        <Card className="usage-card">
          <DataTable
            columns={[
              { key: "ingredient", label: "Ingredient" },
              { key: "brand", label: "Brand" },
              { key: "size", label: "Size", align: "right" },
              { key: "sku", label: "SKU" },
              { key: "last_used", label: "Last used", align: "right" },
            ]}
            rows={payload.skus.map((k) => ({
              ingredient: k.ingredient,
              brand: k.brand ?? "—",
              size: k.size ?? "—",
              sku: <span className="sku-code">{k.sku}</span>,
              last_used: <span className="muted small">{k.last_used ?? "—"}</span>,
            }))}
          />
        </Card>
      ) : (
        <p className="muted" style={{ marginTop: 0 }}>
          No cached SKUs —{" "}
          {payload.location_id ? "none looked up yet at this location." : "not a Kroger location, so SKU lookups don't apply here."}
        </p>
      )}

      <p className="group-label">
        Store notes <span className="muted small">({noteCount})</span>
      </p>
      {STORE_NOTE_GROUPS.map((g) =>
        payload.notes[g].length === 0 ? null : (
          <div key={g} className="store-note-group">
            <div className="store-note-label">{STORE_NOTE_GROUP_LABEL[g]}</div>
            <StoreNoteCards notes={payload.notes[g]} />
          </div>
        ),
      )}
    </DataShell>
  );
};

export function StoreDetailScreen({ slug }: { slug: string }) {
  const query = useQuery(storeDetailQuery(slug));
  switch (query.status) {
    case "pending":
      return <p className="screen-loading">Loading …</p>;
    case "error":
      return <ErrorBanner message={queryErrorMessage(query.error)} />;
    case "success":
      return <StoreDetail payload={query.data} />;
    default:
      return assertNever(query);
  }
}
