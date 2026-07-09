// Profile & preferences (member-app-core 7.10–7.12): three tabs over the profile
// area's ops. Taste — the DERIVED read (retrospective + favorites) beside the
// taste / dietary-principles markdown editors (class (a), If-Match with the
// rebase-on-412 flow) and the read-only owned-equipment card (D10: the mock's
// "Kitchen & household" free-text has no backing field). Preferences — planning
// knobs, SINGLE-select lunch strategy over the real vocab, dietary token fields,
// store + ZIP, ranked brands, all via the merge-patch op under If-Match.
// Night vibes — the palette (production vocabulary, D11), the reconciliation queue
// (kind-specific actions, D12), and the job-health-gated suggest trigger (D7).
import * as React from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  Button,
  Combobox,
  IconClock,
  IconPencil,
  IconPlus,
  IconSparkle,
  IconThermo,
  IconTrash,
  IconUp,
  IconDown,
  IconX,
  NativeSelect,
  PageHead,
  SegmentedControl,
  Textarea,
  ToggleChip,
  TokenField,
  toast,
} from "@yamp/ui";
import { api, apiError } from "../lib/api";
import {
  useProfile,
  useProposals,
  useRetrospective,
  useOverlay,
  useIndex,
  useVibes,
  type ProposalRow,
  type VibeRow,
} from "../lib/data";
import { useProposalConfirm, useVibeAdd, useVibeRemove } from "../lib/mutations";
import { useOnline } from "../lib/online";
import { mdToHtml } from "../lib/md";
import { capitalize, daysSince, relAge } from "../lib/format";

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
    ["vibes", "Night vibes"],
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

/** Read-only owned equipment (set through the agent's update_kitchen flow). */
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

/** Merge-patch under If-Match with ONE automatic rebase retry (merge-patches rebase
 *  trivially — the patch IS the intent), then invalidate the profile reads. */
async function patchPreferences(qc: QueryClient, patch: Record<string, unknown>): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const read = await api.api.profile.preferences.$get().catch(() => null);
    if (!read?.ok) break;
    const etag = read.headers.get("etag") ?? "";
    const res = await api.api.profile.preferences
      .$patch({ json: { patch } }, { headers: { "If-Match": etag } })
      .catch(() => null);
    if (!res) break;
    if (res.status === 412) continue; // raced — rebase on the fresh read and retry once
    if (!res.ok) {
      toast((await apiError(res)).message);
      return false;
    }
    await qc.invalidateQueries({ queryKey: ["profile"] });
    return true;
  }
  toast("Couldn't save preferences — try again");
  return false;
}

const AVOID_BASE = ["shellfish", "pork", "cilantro", "mushrooms", "blue cheese"];
const LIMIT_BASE = ["red meat", "added sugar", "dairy", "fried food"];
const LUNCH = ["leftovers", "buy", "mixed"] as const;

function PrefsTab() {
  const profile = useProfile();
  const qc = useQueryClient();
  const prefs = (profile.data?.preferences ?? {}) as Record<string, unknown>;

  const nights = typeof prefs.default_cooking_nights === "number" ? String(prefs.default_cooking_nights) : null;
  const lunch = typeof prefs.lunch_strategy === "string" ? prefs.lunch_strategy : null;
  const rte = typeof prefs.ready_to_eat_default_action === "string" ? prefs.ready_to_eat_default_action : null;
  const rotation = (prefs.rotation ?? {}) as Record<string, unknown>;
  const dietary = (prefs.dietary ?? {}) as { avoid?: string[]; limit?: string[] };
  const stores = (prefs.stores ?? {}) as Record<string, unknown>;
  const brands = (prefs.brands ?? {}) as Record<string, string[]>;

  const patch = (p: Record<string, unknown>) => void patchPreferences(qc, p);

  return (
    <div className="prof-grid" data-testid="prefs-tab">
      <section className="card prof-card rounded-xl border bg-card p-6">
        <header>
          <h3>Planning</h3>
        </header>
        <section className="prof-fields">
          <div className="prof-field">
            <label>Cooking nights per week</label>
            <SegmentedControl
              name="default_cooking_nights"
              value={nights as "2" | "3" | "4" | "5" | null}
              options={["2", "3", "4", "5"] as const}
              onChange={(v) => patch({ default_cooking_nights: Number(v) })}
            />
          </div>
          <div className="prof-field">
            <label>Lunch strategy</label>
            <SegmentedControl
              name="lunch_strategy"
              value={lunch as (typeof LUNCH)[number] | null}
              options={LUNCH}
              onChange={(v) => patch({ lunch_strategy: v })}
            />
          </div>
          <div className="prof-field">
            <label>Ready-to-eat items</label>
            <SegmentedControl
              name="ready_to_eat_default_action"
              value={rte as "opt-in" | "auto-add" | null}
              options={["opt-in", "auto-add"] as const}
              onChange={(v) => patch({ ready_to_eat_default_action: v })}
            />
          </div>
          <div className="prof-field">
            <label>Resurface recipes after</label>
            <NativeSelect
              className="select"
              value={String(rotation.resurface_after_days ?? "")}
              onChange={(e) => patch({ rotation: { resurface_after_days: Number(e.target.value) } })}
            >
              <option value="" disabled>
                pick…
              </option>
              {[21, 30, 45].map((d) => (
                <option key={d} value={d}>
                  {d} days
                </option>
              ))}
            </NativeSelect>
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

      <section className="card prof-card prof-card-wide rounded-xl border bg-card p-6">
        <header>
          <h3>Store</h3>
        </header>
        <section className="prof-fields">
          <div className="prof-fields-row">
            <div className="prof-field">
              <label>Preferred store</label>
              <div className="prof-static" data-testid="preferred-store">
                {typeof stores.preferred_location === "string" && stores.preferred_location ? (
                  stores.preferred_location
                ) : typeof stores.primary === "string" && stores.primary ? (
                  <>
                    {capitalize(stores.primary)} <span className="muted">— no location set</span>
                  </>
                ) : (
                  <span className="muted">none linked</span>
                )}
              </div>
            </div>
            <div className="prof-field">
              <label>ZIP</label>
              <input
                className="input p-zip"
                aria-label="ZIP"
                defaultValue={typeof stores.location_zip === "string" ? stores.location_zip : ""}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v !== (stores.location_zip ?? "")) patch({ stores: { location_zip: v } });
                }}
              />
            </div>
          </div>
          <BrandsField brands={brands} onPatch={(brandsPatch) => patch({ brands: brandsPatch })} />
        </section>
      </section>
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

function BrandsField(props: { brands: Record<string, string[]>; onPatch: (p: Record<string, unknown>) => void }) {
  const [cat, setCat] = React.useState("");
  const [brand, setBrand] = React.useState("");

  function move(term: string, name: string, dir: -1 | 1) {
    const ranks = [...(props.brands[term] ?? [])];
    const i = ranks.indexOf(name);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ranks.length) return;
    [ranks[i], ranks[j]] = [ranks[j], ranks[i]];
    props.onPatch({ [term]: ranks });
  }

  function remove(term: string, name: string | null) {
    const ranks = (props.brands[term] ?? []).filter((b) => b !== name);
    // Dropping the last ranked brand clears the term entirely (null = back to ambiguous).
    props.onPatch({ [term]: name === null || ranks.length === 0 ? null : ranks });
  }

  function add(e: React.FormEvent) {
    e.preventDefault();
    const term = cat.trim().toLowerCase();
    if (!term) return;
    const ranks = [...(props.brands[term] ?? [])];
    if (brand.trim()) ranks.push(brand.trim());
    props.onPatch({ [term]: ranks });
    setCat("");
    setBrand("");
  }

  return (
    <div className="prof-field prof-field-full" data-testid="brands-field">
      <label>
        Preferred brands <span className="muted">— ranked; the agent tries #1 first</span>
      </label>
      <div className="brand-list">
        {Object.entries(props.brands).map(([term, ranks]) => {
          const items: (string | null)[] = ranks.length ? ranks : [null];
          const ranked = items.length > 1;
          return (
            <div className="brand-row" key={term}>
              <span className="brand-cat">{term}</span>
              <ol className="brand-rank">
                {items.map((b, i) => (
                  <li className="brand-chip" key={b ?? "any"}>
                    {ranked ? <span className="brand-rank-n">{i + 1}</span> : null}
                    <span className="brand-val">{b ?? <span className="muted">any</span>}</span>
                    <span className="brand-ctrls">
                      {ranked && b ? (
                        <>
                          <button type="button" className="brand-ctrl" title="More preferred" aria-label="Rank up" disabled={i === 0} onClick={() => move(term, b, -1)}>
                            <IconUp />
                          </button>
                          <button type="button" className="brand-ctrl" title="Less preferred" aria-label="Rank down" disabled={i === items.length - 1} onClick={() => move(term, b, 1)}>
                            <IconDown />
                          </button>
                        </>
                      ) : null}
                      <button type="button" className="brand-x" title="Remove" onClick={() => remove(term, b)}>
                        <IconX />
                      </button>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          );
        })}
        <form className="brand-add" onSubmit={add}>
          <input className="input brand-in-cat" placeholder="category" autoComplete="off" aria-label="Brand category" value={cat} onChange={(e) => setCat(e.target.value)} />
          <input className="input brand-in-name" placeholder="brand" autoComplete="off" aria-label="Brand" value={brand} onChange={(e) => setBrand(e.target.value)} />
          <Button size="icon" className="size-7" type="submit" title="Add brand" aria-label="Add brand">
            <IconPlus />
          </Button>
        </form>
      </div>
    </div>
  );
}

// === Night vibes tab ==============================================================

const WEATHER_VOCAB = ["grill", "cold-comfort", "wet"] as const;
const SEASONS = ["spring", "summer", "fall", "winter"] as const;
const CUISINES = ["japanese", "indian", "chinese", "french", "american", "korean", "thai", "italian", "vietnamese", "mediterranean"];
const PROTEINS = ["fish", "chicken", "beef", "pork", "shellfish", "egg", "tofu", "vegetarian", "vegan"];
const CADENCES = [7, 10, 14, 21, 30, 45];

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
  const online = useOnline();
  const [adding, setAdding] = React.useState(false);

  async function suggest() {
    const res = await api.api.vibes.suggest.$post({ json: {} }).catch(() => null);
    if (!res?.ok) {
      toast("Couldn't get suggestions — try again");
      return;
    }
    const body = (await res.json()) as { throttled: boolean; enqueued?: number };
    if (body.throttled) {
      // The quiet throttled state (D7): the derivation ran recently — nothing to spend.
      toast("Suggestions are fresh — check back tomorrow");
    } else {
      toast(body.enqueued ? `${body.enqueued} new suggestion${body.enqueued === 1 ? "" : "s"}` : "No new suggestions right now");
      await qc.invalidateQueries({ queryKey: ["proposals"] });
    }
  }

  const rows = vibes.data?.vibes ?? [];
  return (
    <section className="palette-plain" data-testid="vibes-tab">
      <header className="palette-head">
        <div>
          <h3>
            <IconSparkle /> Night-vibe palette
          </h3>
          <p>
            The <em>shapes</em> of your week — archetypes you repeat, not exact meals. Each is a saved search with a
            cadence; the planner samples them by weather and how overdue they are.
          </p>
        </div>
        <div className="palette-head-actions">
          {/* Suggest is ONLINE-ONLY (D5): a gated trigger, never queued or replayed. */}
          <Button
            variant="outline"
            size="sm"
            data-testid="vibe-suggest"
            disabled={!online}
            title={online ? undefined : "You're offline — suggestions need the server"}
            onClick={suggest}
          >
            <IconSparkle /> Suggest from your cooking
          </Button>
          <Button variant="outline" size="sm" data-testid="vibe-add-open" onClick={() => setAdding(true)}>
            <IconPlus /> Add a vibe
          </Button>
        </div>
      </header>

      <ReconcileQueue proposals={proposals.data?.proposals ?? []} />

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
        {rows.length ? (
          rows.map((v) => <VibeRowView key={v.id} vibe={v} />)
        ) : (
          <p className="muted-line" data-testid="palette-empty">
            No night vibes yet. Add one to shape your weekly proposals — or let the suggestions above seed it.
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

/** D12: kind-specific actions only — no synthetic action without a backing op. */
function actionLabel(p: ProposalRow): string {
  if (p.kind === "add_vibe") return "Add vibe";
  if (p.kind === "prune_vibe") return "Retire";
  const days = typeof p.payload.cadence_days === "number" ? p.payload.cadence_days : null;
  return days ? `Adjust to ${days}d` : "Adjust";
}

function proposalTitle(p: ProposalRow): string {
  if (p.kind === "merge_recipes") {
    // Corpus curation (recipe-dedup): name BOTH recipes from the payload.
    const titles = Array.isArray(p.payload.titles) ? p.payload.titles.filter((t): t is string => typeof t === "string") : [];
    return titles.length === 2 ? `Merge “${titles[0]}” & “${titles[1]}”?` : `Merge ${p.target ?? p.id}?`;
  }
  const vibe = typeof p.payload.vibe === "string" ? p.payload.vibe : p.target ?? p.id;
  if (p.kind === "add_vibe") return `Add “${vibe}”`;
  if (p.kind === "prune_vibe") return `Retire “${p.target ?? vibe}”`;
  return `Adjust “${p.target ?? vibe}”`;
}

function ReconcileQueue({ proposals }: { proposals: ProposalRow[] }) {
  const confirmMutation = useProposalConfirm();
  if (!proposals.length) return null;

  function confirm(id: string, accept: boolean) {
    // Registry mutation: 409 (already resolved elsewhere) counts as converged inside
    // the registered mutationFn; a replay the server rejects toasts via the defaults.
    confirmMutation.mutate(
      { id, accept },
      { onSuccess: () => (accept ? toast("Palette updated") : undefined) },
    );
  }

  return (
    <div className="rec-panel" data-testid="reconcile-queue">
      <header className="rec-head">
        <h4>
          <IconSparkle /> Suggestions from your cooking
        </h4>
        <p>
          Where your palette (what you said) and your cooking log (what you did) have drifted apart. Confirm to update
          your palette.
        </p>
      </header>
      <ul className="rec-list">
        {proposals.map((p) => (
          <li className="rec-row" key={p.id} data-testid="proposal-row" data-kind={p.kind}>
            <div className="rec-main">
              <div className="rec-title">{proposalTitle(p)}</div>
              {p.rationale ? <p className="rec-why">{p.rationale}</p> : null}
              {p.kind === "merge_recipes" ? (
                <p className="rec-why" data-testid="merge-chat-hint">
                  Merging happens with your agent in chat — dismiss to keep both recipes.
                </p>
              ) : null}
            </div>
            <div className="rec-actions">
              {/* D12: no synthetic action without a backing op — the app has no merge
                  operation, so a merge_recipes row offers Dismiss only (confirm-reject);
                  accept's meaning ("the merge was performed") exists only in chat. */}
              {p.kind !== "merge_recipes" ? (
                <Button size="sm" data-testid="proposal-accept" onClick={() => confirm(p.id, true)}>
                  {p.kind === "add_vibe" ? <IconPlus /> : p.kind === "prune_vibe" ? <IconTrash /> : null}
                  {actionLabel(p)}
                </Button>
              ) : null}
              <Button size="sm" variant="ghost" data-testid="proposal-dismiss" onClick={() => confirm(p.id, false)}>
                Dismiss
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function VibeRowView({ vibe }: { vibe: VibeRow }) {
  const qc = useQueryClient();
  const online = useOnline();
  const [editing, setEditing] = React.useState(false);
  const st = statusOf(vibe);
  const meter = (Math.min(st.d, 2) / 2) * 100;
  const f = vibe.facets ?? {};

  return (
    <div className="vibe-row" data-testid="vibe-row" data-vibe={vibe.id}>
      <div className="vibe-top">
        <div className="vibe-headline">
          <span className="vibe-name">{vibe.vibe}</span>
          <span className="vibe-status" data-k={st.k}>
            {st.label}
          </span>
        </div>
        <div className="vibe-row-actions">
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
        placeholder="Describe the night — “Sunday sauce”, “fast noodles”…"
        autoComplete="off"
        aria-label="Vibe"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="vibe-edit-grid">
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
