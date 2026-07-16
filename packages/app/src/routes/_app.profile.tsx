// Profile & preferences (member-app-core 7.10–7.12): three tabs over the profile
// area's ops. Taste — the DERIVED read (retrospective + favorites) beside the
// taste / dietary-principles markdown editors (class (a), If-Match with the
// rebase-on-412 flow) and the read-only owned-equipment card (D10: the mock's
// "Kitchen & household" free-text has no backing field). Preferences — the Planning
// card's per-meal cadence steppers (0–7, `patch({cadence:{[meal]:n}})`) and the
// weekly-budget control (clearing writes `weekly_budget:null`; never 0-means-off),
// resurface/novelty sliders, dietary token fields, store + ZIP, and the
// Preferred-brands tier card (per-family { tiers, any_brand } objects, family-scoped
// patches), all via the merge-patch op under If-Match. Meal vibes — the meal-grouped
// palette (production vocabulary, D11), the pinned indicator (design-requests #4), the
// member-assignment layout reserved for band 5 (gated behind `SHOW_WHO`, hidden this
// band), and inline suggestions (D8): the standalone reconcile queue dissolved into
// row-attached wands (adjust_cadence / prune_vibe) + per-meal-group footer cards
// (add_vibe), all confirmed through `confirm_proposal`; `merge_recipes` never surfaces.
// No TOOLS/SCHEMAS/D1 delta — band 1 shipped every backing surface (cadence, weekly_budget,
// meal/members on vibes, the proposals feed).
import * as React from "react";
import { Link, createFileRoute, getRouteApi } from "@tanstack/react-router";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  Button,
  Combobox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  IconClock,
  IconDollarSign,
  IconPencil,
  IconPlus,
  IconSparkle,
  IconThermo,
  IconTrash,
  IconUp,
  IconDown,
  IconX,
  NativeSelect,
  Input,
  PageHead,
  Switch,
  Textarea,
  ToggleChip,
  TokenField,
  toast,
} from "@yamp/ui";
import { api, apiError, appFetch } from "../lib/api";
import {
  useProfile,
  useStoreAdapters,
  useProposals,
  useRetrospective,
  useOverlay,
  useIndex,
  useVibes,
  useAisleMap,
  type ProposalRow,
  type VibeRow,
  type StoreAdapterProjection,
} from "../lib/data";
import { useProposalConfirm, useVibeAdd, useVibeRemove } from "../lib/mutations";
import { useOnline } from "../lib/online";
import { patchPreferences } from "../lib/preferences";
import { mdToHtml } from "../lib/md";
import { capitalize, daysSince, relAge } from "../lib/format";
import type { AisleMapDocument } from "@yamp/contract";

export const Route = createFileRoute("/_app/profile")({
  component: ProfilePage,
});

type Tab = "taste" | "prefs" | "vibes";

function ProfilePage() {
  const [tab, setTab] = React.useState<Tab>("taste");
  const proposals = useProposals();
  const pendingN = proposals.data?.proposals.length ?? 0;

  const tabs: [Tab, string][] = [
    ["taste", "Taste profile"],
    ["prefs", "Preferences"],
    ["vibes", "Meal vibes"],
  ];

  return (
    <div data-testid="profile-page">
      <PageHead title="Profile & preferences" sub="How the agent plans for you. Editable here, used everywhere." />
      <nav className="prof-tabs" role="tablist">
        {tabs.map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            className={`prof-tab${tab === k ? " on" : ""}`}
            data-testid={`profile-tab-${k}`}
            onClick={() => setTab(k)}
          >
            {label}
            {k === "vibes" && pendingN ? <span className="prof-tab-badge">{pendingN}</span> : null}
          </button>
        ))}
      </nav>
      <div className="prof-tabpanel" role="tabpanel">
        {tab === "taste" ? <TasteTab /> : null}
        {tab === "prefs" ? <PrefsTab /> : null}
        {tab === "vibes" ? <VibesTab /> : null}
      </div>
    </div>
  );
}

// === Taste tab ====================================================================

function TasteTab() {
  const profile = useProfile();
  return (
    <section className="card prof-taste rounded-xl border bg-card p-6" data-testid="taste-tab">
      <header>
        <h3>
          <IconSparkle /> Taste profile
        </h3>
        <p>What the agent has learned about how you eat — and what you've told it in your own words.</p>
      </header>
      <div className="taste-cols">
        <div className="taste-read" data-testid="taste-read">
          <TasteRead />
        </div>
        <div className="taste-notes">
          <MdField field="taste" label="In your words" hint="guidance the agent reads" content={profile.data?.taste ?? null} />
          <MdField
            field="diet-principles"
            label="Dietary principles"
            hint="rules every plan respects"
            content={profile.data?.diet_principles ?? null}
          />
          <EquipmentCard owned={profile.data?.kitchen.owned ?? []} />
        </div>
      </div>
    </section>
  );
}

/** The derived taste read: the retrospective aggregation + overlay favorites (D10). */
function TasteRead() {
  const retro = useRetrospective("quarter");
  const overlay = useOverlay();
  const index = useIndex();
  const r = retro.data;
  if (!r) return null;

  const mix = (m: Record<string, number> | undefined) =>
    Object.entries(m ?? {}).sort((a, b) => b[1] - a[1]);
  const cuisines = mix(r.cuisine_mix);
  const proteins = mix(r.protein_mix);
  const favSlugs = new Set(
    Object.entries(overlay.data?.overlay ?? {})
      .filter(([, row]) => row.favorite)
      .map(([slug]) => slug),
  );
  const favRecipes = (index.data?.recipes ?? []).filter((x) => favSlugs.has(x.slug));
  const cooks = (r.recipes_cooked ?? []).reduce((n, x) => n + (x.count ?? 0), 0);
  const list = (arr: string[]) =>
    arr.length <= 1 ? (arr[0] ?? "") : `${arr.slice(0, -1).join(", ")} and ${arr[arr.length - 1]}`;

  const sentences: React.ReactNode[] = [];
  if (cuisines.length) {
    sentences.push(
      <React.Fragment key="mix">
        Across your recent cooks you lean <strong>{list(cuisines.slice(0, 2).map(([c]) => capitalize(c)))}</strong>
        {proteins.length ? (
          <>
            , usually built around <strong>{list(proteins.slice(0, 2).map(([p]) => p))}</strong>
          </>
        ) : null}
        .{" "}
      </React.Fragment>,
    );
  }
  if (favRecipes.length) {
    sentences.push(
      <React.Fragment key="favs">
        You keep coming back to <strong>{list(favRecipes.slice(0, 3).map((x) => x.title))}</strong>.{" "}
      </React.Fragment>,
    );
  }
  if (r.cadence?.cooks_per_week) {
    sentences.push(
      <React.Fragment key="cadence">
        You cook about <strong>{Math.round(r.cadence.cooks_per_week * 10) / 10} nights</strong> a week ({cooks} cooks
        this {r.period}).
      </React.Fragment>,
    );
  }

  const facet = (label: string, chips: React.ReactNode[]) =>
    chips.length ? (
      <div className="taste-facet">
        <span className="taste-facet-label">{label}</span>
        <div className="taste-chips">{chips}</div>
      </div>
    ) : null;

  return (
    <>
      <div className="taste-prose">
        <p>{sentences.length ? sentences : "Cook a few meals and the agent's read on your taste shows up here."}</p>
      </div>
      <div className="taste-facets">
        {facet(
          "Cuisines you cook",
          cuisines.slice(0, 5).map(([c, n]) => (
            <span className="taste-chip" key={c}>
              {capitalize(c)} <span className="taste-count">{n}</span>
            </span>
          )),
        )}
        {facet(
          "Proteins you reach for",
          proteins.slice(0, 5).map(([p, n]) => (
            <span className="taste-chip" key={p}>
              {p} <span className="taste-count">{n}</span>
            </span>
          )),
        )}
        {facet(
          "Go-to recipes",
          favRecipes.slice(0, 4).map((x) => (
            <Link className="taste-chip link" key={x.slug} to="/recipe/$slug" params={{ slug: x.slug }}>
              {x.title}
            </Link>
          )),
        )}
      </div>
    </>
  );
}

/** One class (a) markdown editor: view → edit → PUT under If-Match; a 412 keeps the
 *  draft, surfaces the rebase notice, and refreshes the precondition for the retry. */
function MdField(props: { field: "taste" | "diet-principles"; label: string; hint?: string; content: string | null }) {
  const qc = useQueryClient();
  const online = useOnline();
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [etag, setEtag] = React.useState("");
  const [notice, setNotice] = React.useState<string | null>(null);

  const endpoint = props.field === "taste" ? api.api.profile.taste : api.api.profile["diet-principles"];

  async function openEditor() {
    const res = await endpoint.$get().catch(() => null);
    if (!res?.ok) {
      toast("Couldn't load the latest version — try again");
      return;
    }
    const body = (await res.json()) as { content: string | null };
    setDraft(body.content ?? "");
    setEtag(res.headers.get("etag") ?? "");
    setNotice(null);
    setEditing(true);
  }

  async function save() {
    const res = await endpoint
      .$put({ json: { content: draft } }, { headers: { "If-Match": etag } })
      .catch(() => null);
    if (!res) {
      toast("Couldn't save — try again");
      return;
    }
    if (res.status === 412) {
      // Lost the race (D8): refetch the representation, re-present with the draft kept.
      const fresh = await endpoint.$get().catch(() => null);
      if (fresh?.ok) {
        setEtag(fresh.headers.get("etag") ?? "");
        setNotice("This changed elsewhere since you opened it — review your edit, then save again to overwrite.");
      }
      return;
    }
    if (!res.ok) {
      toast((await apiError(res)).message);
      return;
    }
    setEditing(false);
    setNotice(null);
    toast("Saved");
    await qc.invalidateQueries({ queryKey: ["profile"] });
  }

  return (
    <div className="prof-md-field" data-field={props.field} data-testid={`md-field-${props.field}`}>
      <div className="prof-md-head">
        <label>
          {props.label}
          {props.hint ? <span className="muted"> — {props.hint}</span> : null}
        </label>
        {!editing ? (
          // Class (a) editing is ONLINE-ONLY (D5): the read-fresh -> If-Match loop
          // requires a live server, so the affordance disables with a hint offline.
          <Button
            variant="ghost"
            size="sm"
            data-testid={`md-edit-${props.field}`}
            disabled={!online}
            title={online ? undefined : "You're offline — editing needs the server"}
            onClick={openEditor}
          >
            <IconPencil /> Edit
          </Button>
        ) : null}
      </div>
      {editing ? (
        <div className="prof-md-edit">
          <Textarea className="textarea" rows={6} aria-label={props.label} value={draft} onChange={(e) => setDraft(e.target.value)} />
          {notice ? (
            <p className="prof-md-notice" role="alert" data-testid="md-rebase-notice">
              {notice}
            </p>
          ) : null}
          <div className="prof-md-actions">
            <span className="muted small">Markdown — **bold**, *italic*, - lists</span>
            <span className="prof-md-btns">
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button size="sm" data-testid={`md-save-${props.field}`} onClick={save}>
                Save
              </Button>
            </span>
          </div>
        </div>
      ) : (
        <div
          className="prof-md md"
          data-testid={`md-view-${props.field}`}
          dangerouslySetInnerHTML={{ __html: mdToHtml(props.content) || '<p class="muted">Nothing yet.</p>' }}
        />
      )}
    </div>
  );
}

/** Read-only owned equipment (set through the agent's update_pantry equip/unequip ops). */
function EquipmentCard({ owned }: { owned: string[] }) {
  return (
    <div className="prof-md-field" data-testid="equipment-card">
      <div className="prof-md-head">
        <label>
          Kitchen equipment <span className="muted">— set with the agent</span>
        </label>
      </div>
      {owned.length ? (
        <div className="taste-chips">
          {owned.map((slug) => (
            <span className="taste-chip" key={slug}>
              {slug.replace(/-/g, " ")}
            </span>
          ))}
        </div>
      ) : (
        <p className="muted small">No equipment recorded yet.</p>
      )}
    </div>
  );
}

// === Preferences tab ==============================================================

const AVOID_BASE = ["shellfish", "pork", "cilantro", "mushrooms", "blue cheese"];
const LIMIT_BASE = ["red meat", "added sugar", "dairy", "fried food"];

/** The per-meal cadence steppers' meals, in weekly order (breakfast → dinner). */
const CADENCE_MEALS = [
  ["breakfast", "Breakfast"],
  ["lunch", "Lunch"],
  ["dinner", "Dinner"],
] as const;

const appRoute = getRouteApi("/_app");

function PrefsTab() {
  const profile = useProfile();
  const qc = useQueryClient();
  // The deployment profile from the shell's whoami loader — gates the SaaS-only
  // Curated-collection card (self-hosted deployments have no curated tier to hide).
  const { profile: deployProfile } = appRoute.useLoaderData();
  const prefs = (profile.data?.preferences ?? {}) as Record<string, unknown>;

  // The server always exports `cadence` as a { breakfast, lunch, dinner } map (the
  // read-time derivation fills it when unset), so read straight through.
  const cadence = (prefs.cadence ?? {}) as Record<string, unknown>;
  const budget = typeof prefs.weekly_budget === "number" ? prefs.weekly_budget : null;
  const rotation = (prefs.rotation ?? {}) as Record<string, unknown>;
  const dietary = (prefs.dietary ?? {}) as { avoid?: string[]; limit?: string[] };
  const brands = (prefs.brands ?? {}) as Record<string, BrandTierValue>;

  const patch = (p: Record<string, unknown>) => void patchPreferences(qc, p);

  return (
    <div className="prof-grid" data-testid="prefs-tab">
      <section className="card prof-card rounded-xl border bg-card p-6">
        <header>
          <h3>Planning</h3>
        </header>
        <section className="prof-fields">
          {/* Per-meal weekly cadence (0–7 each) — a per-key merge patch. NOT the mock's
              richer "typical week" per-night grid (that needs unshipped storage). */}
          <div className="prof-field">
            <label>Weekly cadence</label>
            <div className="cadence-row">
              {CADENCE_MEALS.map(([meal, label]) => {
                const n = typeof cadence[meal] === "number" ? (cadence[meal] as number) : 0;
                return (
                  <div className="cadence-item" data-testid="cadence-item" data-meal={meal} key={meal}>
                    <span className="cadence-meal">{label}</span>
                    <div className="nights-step">
                      <button
                        type="button"
                        className="step-btn"
                        data-testid="cadence-dec"
                        aria-label={`One fewer ${label.toLowerCase()} per week`}
                        disabled={n <= 0}
                        onClick={() => patch({ cadence: { [meal]: n - 1 } })}
                      >
                        −
                      </button>
                      <span className="nights-n" data-testid="cadence-n">
                        {n}
                      </span>
                      <button
                        type="button"
                        className="step-btn"
                        data-testid="cadence-inc"
                        aria-label={`One more ${label.toLowerCase()} per week`}
                        disabled={n >= 7}
                        onClick={() => patch({ cadence: { [meal]: n + 1 } })}
                      >
                        +
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="prof-field">
            <label>
              Resurface recipes after <span className="muted">({String(rotation.resurface_after_days ?? "default")}d)</span>
            </label>
            <input
              type="range"
              className="input"
              min={14}
              max={60}
              step={1}
              defaultValue={typeof rotation.resurface_after_days === "number" ? rotation.resurface_after_days : 30}
              onMouseUp={(e) => patch({ rotation: { resurface_after_days: Number((e.target as HTMLInputElement).value) } })}
              onTouchEnd={(e) => patch({ rotation: { resurface_after_days: Number((e.target as HTMLInputElement).value) } })}
            />
          </div>
          <div className="prof-field">
            <label>
              Novelty boost <span className="muted">({String(rotation.novelty_boost ?? "default")})</span>
            </label>
            <input
              type="range"
              className="input"
              min={0.1}
              max={0.5}
              step={0.05}
              defaultValue={typeof rotation.novelty_boost === "number" ? rotation.novelty_boost : 0.2}
              onMouseUp={(e) => patch({ rotation: { novelty_boost: Number((e.target as HTMLInputElement).value) } })}
              onTouchEnd={(e) => patch({ rotation: { novelty_boost: Number((e.target as HTMLInputElement).value) } })}
            />
          </div>
          {/* Weekly budget (design-requests #3): unset is first-class — clearing writes
              `weekly_budget: null` (deletes the key), never 0-means-off. Placed last. */}
          <BudgetField stored={budget} onPatch={patch} />
        </section>
      </section>

      <section className="card prof-card rounded-xl border bg-card p-6">
        <header>
          <h3>Dietary</h3>
          <p>Filters every plan and grocery run.</p>
        </header>
        <section className="prof-fields">
          <DietField
            label="Avoid entirely"
            field="avoid"
            values={dietary.avoid ?? []}
            base={AVOID_BASE}
            onChange={(next) => patch({ dietary: { avoid: next } })}
          />
          <DietField
            label="Limit"
            field="limit"
            values={dietary.limit ?? []}
            base={LIMIT_BASE}
            onChange={(next) => patch({ dietary: { limit: next } })}
          />
        </section>
      </section>

      {deployProfile === "saas" ? (
        <CuratedCard hidden={prefs.curated_hide === true} onPatch={patch} />
      ) : null}

      <StoreCard />

      <BrandsCard brands={brands} onPatch={(brandsPatch) => patch({ brands: brandsPatch })} />
    </div>
  );
}

/**
 * The "Curated collection" card (design request #10, Decision 9 — SaaS only): one
 * household-scoped toggle over `preferences.curated_hide` through the tab's shared
 * merge-patch path. On = shown (the default; clearing writes `curated_hide: null`, the
 * merge-patch DELETE); off writes `curated_hide: true` and hides the whole curated tier
 * from every member of the household. No confirm dialog — the off state carries the
 * reversibility copy instead (nothing is deleted; rows return on re-enable).
 */
function CuratedCard({ hidden, onPatch }: { hidden: boolean; onPatch: (p: Record<string, unknown>) => void }) {
  return (
    <section className="card prof-card rounded-xl border bg-card p-6" data-testid="curated-card">
      <header>
        <h3>Curated collection</h3>
        <p>
          A starter set of recipes we maintain. They're marked in your cookbook; turn this off to hide them
          for your whole household.
        </p>
      </header>
      <section className="prof-fields">
        <div className="prof-field">
          <div className="flex items-center gap-3">
            <Switch
              checked={!hidden}
              aria-label="Show the curated collection"
              data-testid="curated-toggle"
              onCheckedChange={(on) => onPatch({ curated_hide: on ? null : true })}
            />
            <label>{hidden ? "Hidden" : "Shown"}</label>
          </div>
          <p className="prof-help">Applies to everyone in your household</p>
          {hidden ? (
            <p className="prof-help" data-testid="curated-reversible">
              They'll reappear if you turn this back on — nothing is deleted.
            </p>
          ) : null}
        </div>
      </section>
    </section>
  );
}

type StoreTab = "kroger" | "instacart" | "satellites" | "offline";

function StoreCard() {
  const projection = useStoreAdapters();
  const qc = useQueryClient();
  const online = useOnline();
  const [tab, setTab] = React.useState<StoreTab>("kroger");
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const adapters = projection.data?.adapters;
  const tabs: [StoreTab, string][] = [
    ["kroger", "Kroger"],
    ["instacart", "Instacart"],
    ["satellites", "Satellites"],
    ["offline", "Offline"],
  ];

  async function openKrogerLink() {
    const res = await api.api.profile["kroger-login-url"].$get().catch(() => null);
    if (!res?.ok) return void toast("Couldn't start Kroger connection — try again");
    const { url } = (await res.json()) as { url: string };
    window.location.assign(url);
  }

  async function disconnect() {
    const res = await appFetch("/api/profile/kroger-connection", { method: "DELETE" }).catch(() => null);
    if (!res?.ok) return void toast("Couldn't disconnect Kroger — try again");
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["store-adapters"] }),
      qc.invalidateQueries({ queryKey: ["profile"] }),
      qc.invalidateQueries({ queryKey: ["grocery", "to-buy", "enriched"] }),
    ]);
    window.dispatchEvent(new Event("yamp:store-adapter-changed"));
    toast("Kroger disconnected");
  }

  return (
    <section className="card prof-card prof-card-wide store-card rounded-xl border bg-card p-6" data-testid="store-card">
      <header>
        <h3>Store</h3>
        <p>Choose how this household shops. Connection state is checked live.</p>
      </header>
      {!online ? <p className="store-offline-hint">You're offline — store changes need the server.</p> : null}
      <nav className="store-tabs" role="tablist" aria-label="Store adapters">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={`store-tab${tab === key ? " on" : ""}`}
            data-testid={`store-tab-${key}`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </nav>
      {!adapters ? <p className="muted">Loading store adapters…</p> : null}
      {adapters && tab === "kroger" ? (
        <section className="store-panel" role="tabpanel" data-testid="store-panel-kroger">
          <div className="store-summary">
            <div>
              <strong>{adapters.kroger.linked ? "Connected" : "Not connected"}</strong>
              {adapters.kroger.preferred ? (
                <p data-testid="kroger-preferred">
                  {adapters.kroger.preferred.name}
                  {adapters.kroger.preferred.address ? <span>{adapters.kroger.preferred.address}</span> : null}
                </p>
              ) : (
                <p className="muted">Choose a preferred Kroger location before ordering.</p>
              )}
            </div>
            <div className="store-actions">
              <Button size="sm" variant="outline" disabled={!online} onClick={() => void openKrogerLink()}>
                {adapters.kroger.linked ? "Reconnect" : "Connect"}
              </Button>
              {adapters.kroger.linked ? (
                <Button size="sm" variant="ghost" disabled={!online} onClick={() => void disconnect()}>
                  Disconnect
                </Button>
              ) : null}
              <Button size="sm" data-testid="kroger-location-open" disabled={!online} onClick={() => setPickerOpen(true)}>
                Choose location
              </Button>
            </div>
          </div>
          <KrogerLocationModal open={pickerOpen} onOpenChange={setPickerOpen} />
        </section>
      ) : null}
      {adapters && tab === "instacart" ? (
        <section className="store-panel" role="tabpanel" data-testid="store-panel-instacart">
          <strong>{adapters.instacart.available ? "Available" : "Not configured"}</strong>
          <p>{adapters.instacart.available
            ? "Shop from Grocery by opening an Instacart Marketplace page. You choose a retailer and review matches there."
            : "Your operator can enable an Instacart Marketplace handoff with an approved API key."}</p>
          <p className="muted">Yamp does not link an Instacart account, choose a retailer, fill a cart, or observe checkout.</p>
        </section>
      ) : null}
      {adapters && tab === "satellites" ? (
        <section className="store-panel" role="tabpanel" data-testid="store-panel-satellites">
          <strong>Freshness unavailable</strong>
          <p>Status will appear after a Satellite reports its retailer-session freshness.</p>
          {adapters.satellites.stores.map((store) => (
            <p key={store.slug}>{store.name} · status unavailable</p>
          ))}
          <p className="muted">Satellite management is not available in the member app yet.</p>
          <p className="store-links">
            <a href="https://github.com/caseyWebb/yet-another-meal-planner/blob/main/docs/SELF_HOSTING.md" target="_blank" rel="noreferrer">Adapter authoring guide</a>
          </p>
        </section>
      ) : null}
      {adapters && tab === "offline" ? (
        <OfflineStorePanel adapter={adapters.offline} online={online} qc={qc} />
      ) : null}
    </section>
  );
}

function OfflineStorePanel({
  adapter,
  online,
  qc,
}: {
  adapter: StoreAdapterProjection["adapters"]["offline"];
  online: boolean;
  qc: QueryClient;
}) {
  return (
    <section className="store-panel" role="tabpanel" data-testid="store-panel-offline">
      {adapter.selection_unavailable ? (
        <p role="alert">Your selected Offline store ({adapter.selected_slug}) is no longer available.</p>
      ) : null}
      {adapter.stores.length ? (
        <ul className="offline-store-list">
          {adapter.stores.map((store) => (
            <li key={store.slug} data-testid="offline-store" data-store-slug={store.slug}>
              <span>
                <strong>{store.display_name}</strong>
                {store.display_name !== store.shared_name ? <small>{store.nickname ? "Household nickname" : "Store label"} · shared store: {store.shared_name}</small> : null}
                {store.address ? <small>{store.address}</small> : null}
                <small>{store.aisle_map.state === "mapped" ? `${store.aisle_map.aisle_count} aisles mapped` : store.aisle_map.state === "stale" ? `Map may be out of date · ${store.aisle_map.aisle_count} aisles` : "Map not set up"}</small>
              </span>
              {store.selected ? (
                <span className="store-selected">Selected</span>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!online}
                  onClick={() => void patchPreferences(qc, { stores: { primary: store.slug, fulfillment: null } }, true)}
                >
                  Use this store
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No Offline grocery stores are registered yet.</p>
      )}
      {adapter.stores.find((store) => store.selected) ? <OfflineStoreDetails key={adapter.stores.find((store) => store.selected)!.slug} store={adapter.stores.find((store) => store.selected)!} online={online} qc={qc} /> : null}
    </section>
  );
}

function OfflineStoreDetails({ store, online, qc }: { store: StoreAdapterProjection["adapters"]["offline"]["stores"][number]; online: boolean; qc: QueryClient }) {
  const map = useAisleMap(store.slug);
  const [nickname, setNickname] = React.useState(store.nickname ?? "");
  type Draft = { client_id: string; aisle_id: string; label: string; sections: string; visibility: "shared" | "private" };
  const draftsOf = React.useCallback((entries: AisleMapDocument["mine"] | AisleMapDocument["effective"], visibility?: "shared") => entries.map((entry) => ({ client_id: crypto.randomUUID(), aisle_id: entry.aisle_id, label: entry.label, sections: entry.sections.join(", "), visibility: visibility ?? entry.visibility })), []);
  const [entries, setEntries] = React.useState<Draft[]>([]);
  const [loadedEtag, setLoadedEtag] = React.useState<string | null>(null);
  const [comparison, setComparison] = React.useState<AisleMapDocument | null>(null);
  const [dirty, setDirty] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => { if (map.data && loadedEtag === null) { setEntries(draftsOf(map.data.mine)); setLoadedEtag(map.data.etag); } }, [draftsOf, loadedEtag, map.data]);
  const changeEntries = (fn: (current: Draft[]) => Draft[]) => { setEntries(fn); setDirty(true); };
  const saveMap = async () => {
    if (!map.data || !loadedEtag || !online) return;
    setSaving(true);
    try {
      const res = await appFetch(`/api/stores/${encodeURIComponent(store.slug)}/aisle-map`, { method: "PUT", headers: { "Content-Type": "application/json", "If-Match": loadedEtag }, body: JSON.stringify({ entries: entries.map(({ client_id: _clientId, ...entry }) => ({ ...entry, sections: entry.sections.split(",").map((s) => s.trim()).filter(Boolean) })) }) });
      if (res.status === 412) { const fresh = await res.json() as AisleMapDocument; setComparison(fresh); qc.setQueryData(["aisle-map", store.slug], fresh); toast("The community map changed. Your draft is preserved for comparison."); return; }
      if (!res.ok) throw await apiError(res);
      const saved = await res.json() as AisleMapDocument;
      qc.setQueryData(["aisle-map", store.slug], saved); setEntries(draftsOf(saved.mine)); setLoadedEtag(saved.etag); setComparison(null); setDirty(false);
      await Promise.all([qc.invalidateQueries({ queryKey: ["store-adapters"] }), qc.invalidateQueries({ queryKey: ["grocery"] })]);
      toast("Aisle map saved");
    } catch (error) { toast(error instanceof Error ? error.message : "Couldn't save the aisle map"); }
    finally { setSaving(false); }
  };
  return <section className="offline-store-details" aria-label={`${store.display_name} details`}>
    <h3>Household name</h3><p className="muted">Shared identity: {store.shared_name}{store.address ? ` · ${store.address}` : ""}</p>
    <div className="inline-fields"><Input aria-label="Household store nickname" value={nickname} onChange={(event) => setNickname(event.target.value)} placeholder="Optional private nickname" disabled={!online} /><Button variant="outline" disabled={!online || nickname.trim() === (store.nickname ?? "")} onClick={() => void patchPreferences(qc, { stores: { nicknames: { [store.slug]: nickname.trim() || null } } }, true)}>Save nickname</Button></div>
    <h3>Community map</h3>
    {map.data ? <><p>{map.data.summary.state === "unknown" ? "No shared aisle map yet." : map.data.summary.state === "stale" ? "Map may be out of date." : `${map.data.summary.aisle_count} mapped aisles.`}</p><ul>{map.data.effective.map((entry) => <li key={entry.aisle_id}><strong>Aisle {entry.label}</strong> · {entry.sections.join(", ")}</li>)}</ul>
      <div className="aisle-editor"><h3>Your map contribution</h3>{entries.length === 0 && map.data.effective.length ? <Button variant="outline" disabled={!online} onClick={() => { setEntries(draftsOf(map.data!.effective, "shared")); setDirty(true); }}>Use current map as a starting point</Button> : null}
      {comparison ? <aside role="alert"><strong>Fresh community version ({comparison.etag})</strong><ul>{comparison.effective.map((entry) => <li key={entry.aisle_id}>Aisle {entry.label} · {entry.sections.join(", ")}</li>)}</ul><div className="inline-fields"><Button variant="outline" onClick={() => { setLoadedEtag(comparison.etag); setComparison(null); }}>Keep your draft and use fresh version</Button><Button variant="ghost" onClick={() => { setEntries(draftsOf(comparison.mine)); setLoadedEtag(comparison.etag); setComparison(null); setDirty(false); }}>Replace draft with fresh contribution</Button></div></aside> : null}
      {entries.map((entry, index) => <div className="aisle-editor-row" key={entry.client_id}><Input aria-label={`Aisle ${index + 1} label`} value={entry.label} onChange={(event) => changeEntries((cur) => cur.map((row) => row.client_id === entry.client_id ? { ...row, label: event.target.value, aisle_id: event.target.value } : row))} /><Input aria-label={`Aisle ${index + 1} sections`} value={entry.sections} onChange={(event) => changeEntries((cur) => cur.map((row) => row.client_id === entry.client_id ? { ...row, sections: event.target.value } : row))} /><NativeSelect aria-label={`Aisle ${index + 1} visibility`} value={entry.visibility} onChange={(event) => changeEntries((cur) => cur.map((row) => row.client_id === entry.client_id ? { ...row, visibility: event.target.value as "shared" | "private" } : row))}><option value="shared">Shared</option><option value="private">Private</option></NativeSelect><Button variant="ghost" aria-label={`Move aisle ${index + 1} up`} disabled={index === 0} onClick={() => changeEntries((cur) => { const next = [...cur]; [next[index - 1], next[index]] = [next[index]!, next[index - 1]!]; return next; })}><IconUp /></Button><Button variant="ghost" aria-label={`Move aisle ${index + 1} down`} disabled={index === entries.length - 1} onClick={() => changeEntries((cur) => { const next = [...cur]; [next[index], next[index + 1]] = [next[index + 1]!, next[index]!]; return next; })}><IconDown /></Button><Button variant="ghost" onClick={() => changeEntries((cur) => cur.filter((row) => row.client_id !== entry.client_id))}>Remove</Button></div>)}
      <div className="inline-fields"><Button variant="outline" disabled={!online} onClick={() => changeEntries((cur) => [...cur, { client_id: crypto.randomUUID(), aisle_id: String(cur.length + 1), label: String(cur.length + 1), sections: "", visibility: "shared" }])}>Add aisle</Button><Button disabled={!online || saving || !dirty || comparison !== null} title={!online ? "Reconnect to edit the map" : comparison ? "Resolve the fresh-map comparison first" : undefined} onClick={() => void saveMap()}>{saving ? "Saving…" : "Save your map"}</Button></div>{!online ? <p className="muted">Reconnect to save nickname or map changes. These edits are never queued.</p> : null}</div></> : <p>Loading aisle map…</p>}
  </section>;
}

function KrogerLocationModal({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const qc = useQueryClient();
  const [zip, setZip] = React.useState("");
  const [locations, setLocations] = React.useState<
    NonNullable<StoreAdapterProjection["adapters"]["kroger"]["preferred"]>[]
  >([]);
  const [state, setState] = React.useState<"idle" | "loading" | "empty" | "error">("idle");
  const [message, setMessage] = React.useState("");
  const searchGeneration = React.useRef(0);
  const searchAbort = React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    if (open) return;
    searchGeneration.current++;
    searchAbort.current?.abort();
    searchAbort.current = null;
  }, [open]);
  React.useEffect(
    () => () => {
      searchGeneration.current++;
      searchAbort.current?.abort();
    },
    [],
  );

  async function search(event: React.FormEvent) {
    event.preventDefault();
    const generation = ++searchGeneration.current;
    searchAbort.current?.abort();
    searchAbort.current = null;
    setLocations([]);
    setMessage("");
    if (!/^\d{5}$/.test(zip)) {
      setState("error");
      setMessage("Enter exactly five ZIP digits.");
      return;
    }
    const controller = new AbortController();
    searchAbort.current = controller;
    setState("loading");
    const res = await appFetch(`/api/profile/kroger-locations?zip=${encodeURIComponent(zip)}`, {
      signal: controller.signal,
    }).catch(() => null);
    if (generation !== searchGeneration.current) return;
    if (!res?.ok) {
      setLocations([]);
      const errorMessage = res ? (await apiError(res)).message : "Search failed — try again.";
      if (generation !== searchGeneration.current) return;
      setState("error");
      setMessage(errorMessage);
      return;
    }
    const body = (await res.json()) as { locations: (typeof locations)[number][] };
    if (generation !== searchGeneration.current) return;
    setLocations(body.locations);
    setState(body.locations.length ? "idle" : "empty");
  }

  async function choose(location: (typeof locations)[number]) {
    const saved = await patchPreferences(
      qc,
      {
        stores: {
          primary: "kroger",
          fulfillment: null,
          location_zip: location.zip,
          preferred_location: location.location_id,
          preferred_location_name: location.name,
          preferred_location_address: location.address,
        },
      },
      true,
    );
    if (saved) onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="kroger-location-modal" data-testid="kroger-location-modal">
        <DialogHeader>
          <DialogTitle>Choose a Kroger location</DialogTitle>
          <DialogDescription>Search by ZIP, then select one exact provider location.</DialogDescription>
        </DialogHeader>
        <form className="kroger-location-search" onSubmit={(event) => void search(event)}>
          <label htmlFor="kroger-location-zip">ZIP code</label>
          <div>
            <input id="kroger-location-zip" className="input" inputMode="numeric" maxLength={5} value={zip} onChange={(event) => setZip(event.target.value)} />
            <Button type="submit">{state === "loading" ? "Searching…" : "Search"}</Button>
          </div>
        </form>
        {state === "empty" ? <p data-testid="kroger-location-empty">No Kroger locations were returned for that ZIP.</p> : null}
        {state === "error" ? <p role="alert" data-testid="kroger-location-error">{message}</p> : null}
        {locations.length ? (
          <ul className="kroger-location-results">
            {locations.map((location) => (
              <li key={location.location_id}>
                <button type="button" data-testid="kroger-location-result" data-location-id={location.location_id} onClick={() => void choose(location)}>
                  <strong>{location.name}</strong><span>{location.address}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The weekly-budget control (design-requests #3): unset is a first-class state, not a 0.
 * Clearing the field (or emptying it) writes `weekly_budget: null` — the merge-patch DELETE
 * — so the Spend retrospective's budget line simply doesn't render; a numeric value writes
 * `Math.max(0, Math.round(n))`, formatted back on blur. Local draft seeded once from the
 * stored value (the parent re-renders on patch, but a reload remounts with the fresh read).
 */
function BudgetField({ stored, onPatch }: { stored: number | null; onPatch: (p: Record<string, unknown>) => void }) {
  const [draft, setDraft] = React.useState(stored != null ? String(stored) : "");
  // The draft seeds from `stored` on mount — but a mount that RACES the profile read (a
  // reload that lands this control before the `["profile"]` query resolves) would seed from a
  // null value and then never reflect the loaded budget. Sync the draft whenever the server
  // value changes: refetches here only follow a committed patch, so this reflects the fresh
  // read (and the "reload remounts with the fresh read" invariant this control assumes) without
  // ever clobbering in-progress typing (no background poll moves `stored` mid-edit).
  React.useEffect(() => {
    setDraft(stored != null ? String(stored) : "");
  }, [stored]);
  const isSet = draft.trim() !== "";

  function commit() {
    const t = draft.trim();
    if (t === "") {
      setDraft("");
      onPatch({ weekly_budget: null });
      return;
    }
    const n = Number(t);
    if (!Number.isFinite(n)) {
      // Non-numeric input reverts to the stored value rather than writing garbage.
      setDraft(stored != null ? String(stored) : "");
      return;
    }
    const v = Math.max(0, Math.round(n));
    setDraft(String(v));
    onPatch({ weekly_budget: v });
  }

  function clear() {
    setDraft("");
    onPatch({ weekly_budget: null });
  }

  return (
    <div className="prof-field" data-testid="budget-field">
      <label>Weekly grocery budget</label>
      <div className="budget-input">
        <span className="budget-prefix">$</span>
        <input
          className="input"
          inputMode="decimal"
          placeholder="No budget"
          aria-label="Weekly grocery budget in dollars"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
        />
        {isSet ? (
          <button type="button" className="budget-clear" title="Clear budget" aria-label="Clear budget" onClick={clear}>
            ×
          </button>
        ) : null}
      </div>
      {isSet ? (
        <p className="prof-help">Drawn on your Spend retrospective — weeks over budget get flagged.</p>
      ) : (
        <p className="prof-help budget-off" data-testid="budget-off">
          No budget set — the budget line simply won't render.
        </p>
      )}
    </div>
  );
}

function DietField(props: {
  label: string;
  field: string;
  values: string[];
  base: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <div className="prof-field" data-testid={`diet-${props.field}`}>
      <label>{props.label}</label>
      <TokenField values={props.values} onRemove={(v) => props.onChange(props.values.filter((x) => x !== v))}>
        <div className="token-add combobox-wrap">
          <Combobox
            options={props.base.filter((v) => !props.values.includes(v)).map((v) => ({ value: v, label: v }))}
            placeholder={`${props.label.split(" ")[0]}…`}
            ariaLabel={`Add to ${props.label.toLowerCase()}`}
            allowCustom
            emptyText="Type to add your own"
            onSelect={(v) => {
              const val = v.trim().toLowerCase();
              if (val && !props.values.includes(val)) props.onChange([...props.values, val]);
            }}
          />
        </div>
      </TokenField>
    </div>
  );
}

// === Preferred-brands management card =============================================

/** A `preferences.brands` family as the API serves it: the canonical tier object
 *  ({ tiers, any_brand }, both fields present on a read). */
type BrandTierValue = { tiers?: string[][]; any_brand?: boolean };

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/**
 * The Preferred-brands management card (brand-tier model): per-family cards of
 * ordered tiers — brands in one tier are equally fine (cheapest wins), earlier tiers
 * are tried first, and the per-family "Any brand" toggle makes exhaustion fall back
 * to cheapest instead of asking. Every edit is a FAMILY-SCOPED merge-patch of the
 * canonical tier object over the page's If-Match PATCH (`{ brands: { term: value } }`;
 * remove-family writes `null`; the any-brand toggle patches `{ any_brand }` alone so
 * the stored tiers are preserved by the merge). A brand-new family and a trailing
 * "+ Add a fallback tier" are LOCAL drafts until their first brand lands — the
 * storage model has no empty tiers and no all-empty family.
 */
function BrandsCard(props: {
  brands: Record<string, BrandTierValue>;
  onPatch: (p: Record<string, unknown>) => void;
}) {
  const [cat, setCat] = React.useState("");
  // Locally-drafted families (added here, no brand written yet) and per-family
  // trailing draft tiers. Keyed by the term as rendered; cleared on first write
  // (the server echoes the family back under its normalized key).
  const [drafts, setDrafts] = React.useState<string[]>([]);
  const [pending, setPending] = React.useState<Record<string, boolean>>({});

  const families: [string, BrandTierValue][] = [
    ...Object.entries(props.brands),
    ...drafts.filter((t) => !(t in props.brands)).map((t): [string, BrandTierValue] => [t, {}]),
  ];

  const clearLocal = (term: string) => {
    setDrafts((d) => d.filter((t) => t !== term));
    setPending((p) => ({ ...p, [term]: false }));
  };

  /** Persist a family's tier structure: collapse emptied tiers; an all-empty,
   *  non-any family clears to `null` (back to ambiguous). */
  function writeTiers(term: string, tiers: string[][], anyBrand: boolean) {
    const kept = tiers.filter((t) => t.length > 0);
    clearLocal(term);
    if (kept.length === 0 && !anyBrand) props.onPatch({ [term]: null });
    else props.onPatch({ [term]: { tiers: kept, any_brand: anyBrand } });
  }

  function moveBrand(term: string, tierIdx: number, name: string, dir: -1 | 1) {
    const v = props.brands[term] ?? {};
    const tiers = (v.tiers ?? []).map((t) => [...t]);
    if (!tiers[tierIdx]?.includes(name)) return;
    tiers[tierIdx] = tiers[tierIdx].filter((b) => b !== name);
    const j = tierIdx + dir;
    // Past-edge creates a new tier of its own (pages/09 §2); mid-ladder joins the
    // neighbor tier.
    if (j < 0) tiers.unshift([name]);
    else if (j >= tiers.length) tiers.push([name]);
    else tiers[j] = [...tiers[j], name];
    const next = tiers.filter((t) => t.length > 0);
    if (JSON.stringify(next) === JSON.stringify(v.tiers ?? [])) return; // no-op move (alone at the edge)
    writeTiers(term, next, v.any_brand === true);
  }

  function removeBrand(term: string, tierIdx: number, name: string) {
    const v = props.brands[term] ?? {};
    const tiers = (v.tiers ?? []).map((t, i) => (i === tierIdx ? t.filter((b) => b !== name) : [...t]));
    writeTiers(term, tiers, v.any_brand === true);
  }

  function addBrand(term: string, tierIdx: number, raw: string) {
    const name = raw.trim();
    if (!name) return;
    const v = props.brands[term] ?? {};
    const tiers = (v.tiers ?? []).map((t) => [...t]);
    if (tiers.some((t) => t.some((b) => b.toLowerCase() === name.toLowerCase()))) {
      toast(`${name} is already in this family's tiers`);
      return;
    }
    if (tierIdx >= tiers.length) tiers.push([name]); // the trailing draft tier
    else tiers[tierIdx] = [...tiers[tierIdx], name];
    // "Set brand preferences" on a don't-care family: the first brand replaces the
    // pure any-brand state with a ladder (a family that ALREADY had tiers keeps its
    // any-brand terminal fallback).
    const hadTiers = (v.tiers ?? []).length > 0;
    writeTiers(term, tiers, v.any_brand === true && hadTiers);
  }

  function toggleAny(term: string, on: boolean) {
    const v = props.brands[term];
    if (!v) {
      // A drafted family: its first write. On = the standing don't-care.
      clearLocal(term);
      if (on) props.onPatch({ [term]: { tiers: [], any_brand: true } });
      return;
    }
    if (!on && (v.tiers ?? []).length === 0) {
      // Nothing to fall back on — the all-empty state is unrepresentable, so open
      // the tier editor instead of writing ({ tiers: [], any_brand: false } is
      // rejected by the API; the family stays don't-care until a brand lands).
      setPending((p) => ({ ...p, [term]: true }));
      return;
    }
    // Partial family patch — the stored tiers are preserved by the merge.
    props.onPatch({ [term]: { any_brand: on } });
  }

  function addFamily(e: React.FormEvent) {
    e.preventDefault();
    const term = cat.trim().toLowerCase();
    if (!term) return;
    if (term in props.brands || drafts.includes(term)) {
      toast("That category is already here");
      return;
    }
    setDrafts((d) => [...d, term]);
    setPending((p) => ({ ...p, [term]: true }));
    setCat("");
  }

  return (
    <section className="card prof-card prof-card-wide rounded-xl border bg-card p-6" data-testid="brands-card">
      <header>
        <h3>Preferred brands</h3>
        <p>
          Grouped into tiers — <strong>yamp</strong> tries your top tier first, then falls back. Brands in the same
          tier are equally fine, so the cheapest wins. “Any brand” lets price always decide.
        </p>
      </header>
      <section className="prof-fields">
        <div className="brand-list">
          {families.map(([term, v]) => {
            const tiers = v.tiers ?? [];
            const any = v.any_brand === true;
            const draftTier = pending[term] === true;
            const shownTiers: string[][] = draftTier ? [...tiers, []] : tiers;
            return (
              <div className="brand-cat-card" key={term} data-testid="brand-family" data-term={term}>
                <div className="brand-cat-head">
                  <span className="brand-cat-name">{term.replace(/_/g, " ")}</span>
                  <div className="brand-cat-head-actions">
                    <button
                      type="button"
                      className="brand-any-toggle"
                      aria-pressed={any}
                      data-testid="brand-any-toggle"
                      onClick={() => toggleAny(term, !any)}
                    >
                      Any brand
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      title="Remove category"
                      aria-label={`Remove ${term.replace(/_/g, " ")}`}
                      data-testid="brand-family-remove"
                      onClick={() => {
                        clearLocal(term);
                        if (term in props.brands) props.onPatch({ [term]: null });
                      }}
                    >
                      <IconTrash />
                    </button>
                  </div>
                </div>
                {shownTiers.length ? (
                  <div className="brand-tiers">
                    {shownTiers.map((tier, ti) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: tiers have no identity beyond position
                      <div className="brand-tier" key={ti} data-testid="brand-tier">
                        <div className="brand-tier-head">
                          <span className="brand-tier-label">{ordinal(ti + 1)} choice</span>
                          {tier.length > 1 ? <span className="brand-tier-note">either works — cheapest wins</span> : null}
                        </div>
                        <div className="brand-tier-chips">
                          {tier.map((b) => (
                            <span className="brand-chip2" key={b} data-testid="brand-chip" data-brand={b}>
                              <span>{b}</span>
                              <span className="brand-chip2-ctrls">
                                <button
                                  type="button"
                                  title="Prefer more (higher tier)"
                                  aria-label={`Move ${b} up a tier`}
                                  onClick={() => moveBrand(term, ti, b, -1)}
                                >
                                  <IconUp />
                                </button>
                                <button
                                  type="button"
                                  title="Prefer less (lower tier)"
                                  aria-label={`Move ${b} down a tier`}
                                  onClick={() => moveBrand(term, ti, b, 1)}
                                >
                                  <IconDown />
                                </button>
                                <button
                                  type="button"
                                  title="Remove"
                                  aria-label={`Remove ${b}`}
                                  onClick={() => removeBrand(term, ti, b)}
                                >
                                  <IconX />
                                </button>
                              </span>
                            </span>
                          ))}
                          <form
                            className="brand-chip-add"
                            onSubmit={(e) => {
                              e.preventDefault();
                              const input = (e.target as HTMLFormElement).elements.namedItem("brand") as HTMLInputElement;
                              addBrand(term, ti, input.value);
                              input.value = "";
                            }}
                          >
                            <input
                              name="brand"
                              className="input"
                              placeholder="add brand…"
                              autoComplete="off"
                              aria-label="Add brand to this tier"
                            />
                          </form>
                        </div>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="brand-add-tier"
                      data-testid="brand-add-tier"
                      disabled={draftTier}
                      onClick={() => setPending((p) => ({ ...p, [term]: true }))}
                    >
                      <IconPlus /> Add a fallback tier
                    </button>
                  </div>
                ) : null}
                {any ? (
                  <div className="brand-any-state" data-testid="brand-any-state">
                    <span className="brand-any-badge">
                      <IconDollarSign /> Any brand — cheapest wins
                    </span>
                    {tiers.length === 0 && !draftTier ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        data-testid="brand-set-prefs"
                        onClick={() => setPending((p) => ({ ...p, [term]: true }))}
                      >
                        Set brand preferences
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
          <form className="brand-cat-add" onSubmit={addFamily} data-testid="brand-family-add">
            <input
              className="input"
              placeholder="Add a category — e.g. coffee, eggs, tortillas"
              autoComplete="off"
              aria-label="New category"
              value={cat}
              onChange={(e) => setCat(e.target.value)}
            />
            <Button size="sm" type="submit">
              <IconPlus /> Add category
            </Button>
          </form>
        </div>
      </section>
    </section>
  );
}

// === Meal vibes tab ===============================================================

const WEATHER_VOCAB = ["grill", "cold-comfort", "wet"] as const;
const SEASONS = ["spring", "summer", "fall", "winter"] as const;
const CUISINES = ["japanese", "indian", "chinese", "french", "american", "korean", "thai", "italian", "vietnamese", "mediterranean"];
const PROTEINS = ["fish", "chicken", "beef", "pork", "shellfish", "egg", "tofu", "vegetarian", "vegan"];
const CADENCES = [7, 10, 14, 21, 30, 45];

/** The closed meal set a vibe carries, in weekly order — the grouping + the add form's
 *  Meal select. */
const VIBE_MEALS = [
  ["breakfast", "Breakfast"],
  ["lunch", "Lunch"],
  ["dinner", "Dinner"],
] as const;
type VibeMeal = (typeof VIBE_MEALS)[number][0];

/** Member assignment (design-requests #6, D29) is band 5's wiring — the full layout ships
 *  here but stays gated behind this flag (there is no member roster in the member app
 *  pre-band-5, so no stub roster renders). Typed `boolean` so the gated JSX still checks. */
const SHOW_WHO: boolean = false;

function mealOf(v: unknown): VibeMeal {
  return v === "breakfast" || v === "lunch" || v === "dinner" ? v : "dinner";
}

/** The row-attached suggestion's Apply label (adjust_cadence names the target cadence). */
function suggestApplyLabel(p: ProposalRow): string {
  if (p.kind === "prune_vibe") return "Retire";
  const days = typeof p.payload.cadence_days === "number" ? p.payload.cadence_days : null;
  return days ? `Adjust to ${days}d` : "Adjust";
}

function statusOf(v: VibeRow): { k: "overdue" | "due" | "soon" | "ok"; label: string; d: number } {
  const cadence = v.cadence_days ?? null;
  let d = 0;
  if (cadence && cadence > 0) {
    const anchor = v.last_satisfied ?? (v.created_at ? v.created_at.slice(0, 10) : null);
    if (anchor) d = daysSince(anchor) / cadence;
  }
  if (d >= 1.5) return { k: "overdue", label: "Overdue", d };
  if (d >= 1) return { k: "due", label: "Due now", d };
  if (d >= 0.6) return { k: "soon", label: "Due soon", d };
  return { k: "ok", label: v.last_satisfied ? "On track" : "New", d };
}

function VibesTab() {
  const vibes = useVibes();
  const proposals = useProposals();
  const qc = useQueryClient();
  const [adding, setAdding] = React.useState(false);

  const rows = vibes.data?.vibes ?? [];
  // D8: merge_recipes NEVER surfaces on the member vibes tab (corpus curation stays
  // agent-side) — filter it out entirely before anything renders.
  const props = (proposals.data?.proposals ?? []).filter((p) => p.kind !== "merge_recipes");

  // Inline suggestions (the standalone queue dissolved): adjust_cadence / prune_vibe are
  // row-attached, joined to a palette row by proposal.target === vibe.vibe (the phrase);
  // add_vibe becomes a per-meal-group footer card, grouped by its payload meal. The phrase
  // join is safe because vibe phrases are unique within a palette; a proposal whose target
  // matches no current row renders nowhere (adjusting a vanished vibe is moot).
  const rowSuggest = new Map<string, ProposalRow>();
  const addSuggest: Record<VibeMeal, ProposalRow[]> = { breakfast: [], lunch: [], dinner: [] };
  for (const p of props) {
    if ((p.kind === "adjust_cadence" || p.kind === "prune_vibe") && p.target && !rowSuggest.has(p.target)) {
      rowSuggest.set(p.target, p);
    } else if (p.kind === "add_vibe") {
      addSuggest[mealOf(p.payload.meal)].push(p);
    }
  }
  const anythingToShow = rows.length > 0 || props.length > 0;

  return (
    <section className="palette-plain" data-testid="vibes-tab">
      <header className="palette-head">
        <div>
          <h3>
            <IconSparkle /> Meal-vibe palette
          </h3>
          <p>
            The <em>shapes</em> of your week — repeatable meal ideas across breakfast, lunch, and dinner, not exact
            recipes. Each is a saved search with a cadence; the planner samples them by weather and how overdue they are.
          </p>
        </div>
        <div className="palette-head-actions">
          <Button variant="outline" size="sm" data-testid="vibe-add-open" onClick={() => setAdding(true)}>
            <IconPlus /> Add a vibe
          </Button>
        </div>
      </header>

      {adding ? (
        <div className="vibe-row adding" data-testid="vibe-add-form">
          <VibeForm
            onDone={async () => {
              setAdding(false);
              await qc.invalidateQueries({ queryKey: ["vibes"] });
            }}
            onCancel={() => setAdding(false)}
          />
        </div>
      ) : null}

      <div className="vibe-list" data-testid="vibe-list">
        {anythingToShow ? (
          VIBE_MEALS.map(([meal, label]) => {
            const mrows = rows.filter((v) => mealOf(v.meal) === meal);
            const adds = addSuggest[meal];
            return (
              <div className="vibe-group" data-testid="vibe-group" data-meal={meal} key={meal}>
                <h4 className="vibe-group-h">{label}</h4>
                {mrows.map((v) => (
                  <VibeRowView key={v.id} vibe={v} suggestion={rowSuggest.get(v.vibe)} />
                ))}
                {!mrows.length ? (
                  <p className="vibe-group-empty" data-testid="vibe-group-empty">
                    No {meal} vibes yet.
                  </p>
                ) : null}
                {adds.map((p) => (
                  <AddSuggestCard key={p.id} proposal={p} />
                ))}
              </div>
            );
          })
        ) : (
          <p className="muted-line" data-testid="palette-empty">
            No meal vibes yet. Add one to shape your weekly proposals — or let the suggestions above seed it.
          </p>
        )}
      </div>
      {rows.length ? (
        <div className="palette-foot">
          <Button asChild data-testid="palette-plan-week">
            <Link to="/propose">
              <IconSparkle /> Plan a week from these
            </Link>
          </Button>
        </div>
      ) : null}
    </section>
  );
}

/** A per-meal-group footer card for an `add_vibe` proposal (D8 inline suggestions). Add
 *  upserts the vibe into the palette; Dismiss records a durable rejection — both through
 *  the existing `confirm_proposal` registry mutation. */
function AddSuggestCard({ proposal }: { proposal: ProposalRow }) {
  const confirmMutation = useProposalConfirm();
  const vibe = typeof proposal.payload.vibe === "string" ? proposal.payload.vibe : proposal.target ?? "this vibe";

  function confirm(accept: boolean) {
    // 409 (already resolved elsewhere) is converged inside the registered mutationFn.
    confirmMutation.mutate({ id: proposal.id, accept }, { onSuccess: () => (accept ? toast("Added to your palette") : undefined) });
  }

  return (
    <div className="vibe-add-suggest" data-testid="vibe-add-suggest" data-kind="add_vibe">
      <div className="vas-main">
        <div className="vas-title">
          <IconSparkle />
          <span>Add “{vibe}”?</span>
        </div>
        {proposal.rationale ? <div className="vas-why">{proposal.rationale}</div> : null}
      </div>
      <div className="vas-actions">
        <Button size="sm" data-testid="add-suggest-add" onClick={() => confirm(true)}>
          <IconPlus /> Add
        </Button>
        <Button size="sm" variant="ghost" data-testid="add-suggest-dismiss" onClick={() => confirm(false)}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}

/** A small pin glyph for the pinned indicator (no `IconPin` in @yamp/ui). */
function PinGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 17v5" />
      <path d="M9 10.8a2 2 0 0 1-1.1 1.8l-1.8.9A2 2 0 0 0 5 15.2V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.8a2 2 0 0 0-1.1-1.7l-1.8-.9A2 2 0 0 1 15 10.8V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
    </svg>
  );
}

function VibeRowView({ vibe, suggestion }: { vibe: VibeRow; suggestion?: ProposalRow }) {
  const qc = useQueryClient();
  const online = useOnline();
  const confirmMutation = useProposalConfirm();
  const [editing, setEditing] = React.useState(false);
  const [suggestOpen, setSuggestOpen] = React.useState(false);
  const st = statusOf(vibe);
  const meter = (Math.min(st.d, 2) / 2) * 100;
  const f = vibe.facets ?? {};
  const pinned = Boolean(vibe.pinned);
  const members = vibe.members ?? [];

  function confirmSuggestion(accept: boolean) {
    if (!suggestion) return;
    confirmMutation.mutate({ id: suggestion.id, accept }, { onSuccess: () => (accept ? toast("Palette updated") : undefined) });
  }

  return (
    <div className={`vibe-row${pinned ? " pinned" : ""}`} data-testid="vibe-row" data-vibe={vibe.id}>
      <div className="vibe-top">
        <div className="vibe-headline">
          <span className="vibe-name">{vibe.vibe}</span>
          {pinned ? (
            <span
              className="vibe-pin"
              data-testid="vibe-pin"
              title="Pinned — the planner places this every week, regardless of cadence debt"
            >
              <PinGlyph /> Pinned
            </span>
          ) : null}
          <span className="vibe-status" data-k={st.k}>
            {st.label}
          </span>
          {/* Member-assignment row tag — reserved for band 5 (hidden this band). */}
          {SHOW_WHO && members.length ? (
            <span className="vibe-who-tag" title={`For ${members.join(", ")} — only planned when they're eating that week`}>
              <span className="who-stack">
                {members.map((m) => (
                  <span className="who-ava-sm" key={m}>
                    {m.slice(0, 1).toUpperCase()}
                  </span>
                ))}
              </span>
              {members.join(", ")}
            </span>
          ) : null}
        </div>
        <div className="vibe-row-actions">
          {suggestion ? (
            <button
              type="button"
              className="icon-btn vibe-wand"
              data-testid="vibe-wand"
              title="Suggestion from your cooking"
              aria-label="Suggestion from your cooking"
              onClick={() => setSuggestOpen((o) => !o)}
            >
              <IconSparkle />
            </button>
          ) : null}
          <button
            type="button"
            className="icon-btn"
            title={online ? "Edit vibe" : "You're offline — editing needs the server"}
            data-testid="vibe-edit"
            disabled={!online}
            onClick={() => setEditing((e) => !e)}
          >
            <IconPencil />
          </button>
        </div>
      </div>
      {suggestion && suggestOpen ? (
        <div className="vibe-suggest" data-testid="vibe-suggest" data-kind={suggestion.kind}>
          <div className="vibe-suggest-cap">
            <IconSparkle /> Suggestion from your cooking
          </div>
          {suggestion.rationale ? <p>{suggestion.rationale}</p> : null}
          <div className="vibe-suggest-actions">
            <Button size="sm" data-testid="suggest-apply" onClick={() => confirmSuggestion(true)}>
              {suggestion.kind === "prune_vibe" ? <IconTrash /> : null}
              {suggestApplyLabel(suggestion)}
            </Button>
            <Button size="sm" variant="ghost" data-testid="suggest-dismiss" onClick={() => confirmSuggestion(false)}>
              Dismiss
            </Button>
          </div>
        </div>
      ) : null}
      <div className="vibe-meta">
        {typeof f.cuisine === "string" ? <span className="facet">{f.cuisine}</span> : null}
        {typeof f.protein === "string" ? (
          <span className="facet" data-kind="protein">
            {f.protein}
          </span>
        ) : null}
        {typeof f.max_time_total === "number" ? <span className="facet">≤ {f.max_time_total} min</span> : null}
        {(vibe.season ?? []).map((s) => (
          <span className="facet vibe-season" key={s}>
            {s}
          </span>
        ))}
        {vibe.cadence_days ? (
          <span className="vibe-cadence">
            <IconClock /> every {vibe.cadence_days} days
          </span>
        ) : null}
        <span className="vibe-last">{vibe.last_satisfied ? `cooked ${relAge(vibe.last_satisfied)}` : "never cooked from this"}</span>
      </div>
      <div className="vibe-debt" title="cadence debt — how overdue this vibe is">
        <span className="vibe-debt-fill" data-k={st.k} style={{ width: `${meter}%` }} />
      </div>
      {(vibe.weather_affinity ?? []).length ? (
        <div className="vibe-wx">
          <span className="vibe-wx-label">
            <IconThermo /> Weather fit
          </span>
          <div className="vibe-wx-chips">
            {(vibe.weather_affinity ?? []).map((t) => (
              <span className="wxchip on" key={t}>
                {t}
              </span>
            ))}
          </div>
        </div>
      ) : null}
      {editing ? (
        <VibeForm
          vibe={vibe}
          onDone={async () => {
            setEditing(false);
            await qc.invalidateQueries({ queryKey: ["vibes"] });
          }}
          onCancel={() => setEditing(false)}
        />
      ) : null}
    </div>
  );
}

/** Create/edit form over the PRODUCTION vocabulary (D11): closed weather enum,
 *  season list, facets, cadence, pinned. Edit is class (a): If-Match from the raw
 *  row's GET; create is the class (b)-shaped POST (duplicate → conflict toast). */
function VibeForm(props: { vibe?: VibeRow; onDone: () => Promise<void>; onCancel: () => void }) {
  const vibeAdd = useVibeAdd();
  const vibeRemove = useVibeRemove();
  const v = props.vibe;
  const f = v?.facets ?? {};
  const [text, setText] = React.useState(v?.vibe ?? "");
  const [meal, setMeal] = React.useState<VibeMeal>(mealOf(v?.meal));
  const [cuisine, setCuisine] = React.useState(typeof f.cuisine === "string" ? f.cuisine : "");
  const [protein, setProtein] = React.useState(typeof f.protein === "string" ? f.protein : "");
  const [maxTime, setMaxTime] = React.useState(typeof f.max_time_total === "number" ? String(f.max_time_total) : "");
  const [seasons, setSeasons] = React.useState<string[]>(v?.season ?? []);
  const [cadence, setCadence] = React.useState(v?.cadence_days ? String(v.cadence_days) : "14");
  const [weather, setWeather] = React.useState<string[]>(v?.weather_affinity ?? []);
  const [pinned, setPinned] = React.useState(Boolean(v?.pinned));

  function payload() {
    const facets: Record<string, unknown> = {};
    if (cuisine) facets.cuisine = cuisine;
    if (protein) facets.protein = protein;
    if (maxTime) facets.max_time_total = Number(maxTime);
    return {
      vibe: text.trim(),
      meal,
      facets,
      cadence_days: Number(cadence),
      pinned,
      season: seasons,
      weather_affinity: weather,
    };
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    if (v) {
      // Edit is class (a) — ONLINE-ONLY, imperative (D5): precondition on the raw
      // row (GET /vibes/:id → ETag → PATCH); never a queued mutation.
      const read = await api.api.vibes[":id"].$get({ param: { id: v.id } }).catch(() => null);
      if (!read?.ok) {
        toast("Couldn't load the vibe — try again");
        return;
      }
      const etag = read.headers.get("etag") ?? "";
      const args = { param: { id: v.id }, json: payload() };
      const res = await api.api.vibes[":id"].$patch(args, { headers: { "If-Match": etag } }).catch(() => null);
      if (!res?.ok) {
        toast(res?.status === 412 ? "This vibe changed elsewhere — reopen and retry" : "Couldn't save the vibe");
        return;
      }
      await props.onDone();
      return;
    }
    // Create is the class (b)-shaped POST — a registry mutation (duplicate → the
    // defaults' conflict toast). Fire-and-close; offline it queues.
    vibeAdd.mutate(payload());
    await props.onDone();
  }

  async function remove() {
    if (!v) return;
    vibeRemove.mutate({ id: v.id });
    await props.onDone();
  }

  return (
    <form className="vibe-edit" onSubmit={save} data-testid="vibe-form">
      <input
        className="input vibe-name-in"
        placeholder="Describe the meal — “Sunday sauce”, “savory eggs”…"
        autoComplete="off"
        aria-label="Vibe"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="vibe-edit-grid">
        <label className="vibe-edit-f">
          <span>Meal</span>
          <NativeSelect className="select" aria-label="Meal" value={meal} onChange={(e) => setMeal(mealOf(e.target.value))}>
            {VIBE_MEALS.map(([m, label]) => (
              <option key={m} value={m}>
                {label}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="vibe-edit-f">
          <span>Cuisine</span>
          <NativeSelect className="select" value={cuisine} onChange={(e) => setCuisine(e.target.value)}>
            <option value="">any cuisine</option>
            {CUISINES.map((c) => (
              <option key={c} value={c}>
                {capitalize(c)}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="vibe-edit-f">
          <span>Protein</span>
          <NativeSelect className="select" value={protein} onChange={(e) => setProtein(e.target.value)}>
            <option value="">any protein</option>
            {PROTEINS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="vibe-edit-f">
          <span>Max time</span>
          <NativeSelect className="select" value={maxTime} onChange={(e) => setMaxTime(e.target.value)}>
            <option value="">any time</option>
            {[20, 30, 45, 75].map((t) => (
              <option key={t} value={t}>
                ≤ {t} min
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="vibe-edit-f">
          <span>Cadence</span>
          <NativeSelect className="select" value={cadence} onChange={(e) => setCadence(e.target.value)}>
            {CADENCES.map((d) => (
              <option key={d} value={d}>
                every {d} days
              </option>
            ))}
          </NativeSelect>
        </label>
      </div>
      <div className="vibe-wx">
        <span className="vibe-wx-label">
          <IconThermo /> Weather fit
        </span>
        <div className="vibe-wx-chips">
          {WEATHER_VOCAB.map((t) => (
            <ToggleChip
              key={t}
              className="wxchip"
              on={weather.includes(t)}
              onToggle={() => setWeather((w) => (w.includes(t) ? w.filter((x) => x !== t) : [...w, t]))}
            >
              {t}
            </ToggleChip>
          ))}
        </div>
      </div>
      <div className="vibe-wx">
        <span className="vibe-wx-label">Season</span>
        <div className="vibe-wx-chips">
          {SEASONS.map((s) => (
            <ToggleChip
              key={s}
              className="wxchip"
              on={seasons.includes(s)}
              onToggle={() => setSeasons((x) => (x.includes(s) ? x.filter((y) => y !== s) : [...x, s]))}
            >
              {s}
            </ToggleChip>
          ))}
        </div>
        <label className="note-priv">
          <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} /> Pinned (weekly
          intent)
        </label>
      </div>
      {/* "Who's it for" (design-requests #6, D29) — the full layout ships here but is gated
          behind SHOW_WHO; band 5 wires the roster + flips the flag. No stub roster renders. */}
      {SHOW_WHO ? (
        <div className="vibe-wx">
          <span className="vibe-wx-label">Who's it for</span>
          <div className="vibe-who">
            <button type="button" className="who-chip everyone" aria-pressed={true}>
              Everyone
            </button>
          </div>
          <p className="vibe-who-help">Only planned when they're eating that week.</p>
        </div>
      ) : null}
      <div className="vibe-edit-actions">
        {v ? (
          <Button type="button" variant="ghost" size="sm" data-testid="vibe-delete" onClick={remove}>
            <IconTrash /> Delete
          </Button>
        ) : (
          <span />
        )}
        <span className="vibe-edit-btns">
          <Button type="button" variant="ghost" size="sm" onClick={props.onCancel}>
            Cancel
          </Button>
          <Button type="submit" size="sm" data-testid="vibe-save" disabled={!text.trim()}>
            {v ? "Save vibe" : "Add vibe"}
          </Button>
        </span>
      </div>
    </form>
  );
}
