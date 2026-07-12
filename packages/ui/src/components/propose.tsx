// Propose-flow primitives (member-app-propose / shared-propose-orchestration), transcribed from
// the design bundle's app-propose-ui.js markup + app-propose.css and cut to the D8/D20 shared
// control set: per-meal steppers, variety bar + commit, and the slot card with its swap menu,
// facet chips + popovers, pick list, per-slot vibe panel, sides EDITING, and why / flag chips,
// plus the empty-slot state with clearable pins. The D8 cuts (adventurousness slider, protein
// wants, freeform phrase, global re-roll, per-slot lock + exclude) are absent from this shared
// surface — the same component on both hosts (D20). Presentational: the controller owns the
// client propose session and every callback; nothing here holds server state. Router-agnostic
// (slot titles render through `renderTitle`).
import * as React from "react";
import { Button } from "./button";
import {
  IconAlert,
  IconBack,
  IconCalendar,
  IconCheck,
  IconPencil,
  IconSearch,
  IconSparkle,
  IconSwap,
  IconX,
} from "./icons";

const cap = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

/** A compact swap candidate (the endpoint's alternate lite row). */
export interface ProposeAlt {
  slug: string;
  title: string;
  protein: string | null;
  cuisine: string | null;
  time_total: number | null;
}

/** One slot as the card renders it — mapped by the page from the endpoint's slot. */
export interface ProposeSlotView {
  /** Stable render key (a vibe can legitimately fill two nights). */
  key: string;
  vibeId: string;
  vibeLabel: string;
  /** The member typed over this night's vibe (`slots[].vibe`). */
  vibeEdited: boolean;
  weatherCategory: string | null;
  main: {
    slug: string;
    title: string;
    description: string | null;
    protein: string | null;
    cuisine: string | null;
    time_total: number | null;
  } | null;
  emptyReason: string | null;
  locked: boolean;
  pinnedProtein: string | null;
  pinnedCuisine: string | null;
  /** The explicit per-night time pin: absent = follow the vibe/global, null = "Any time". */
  timePin: { explicit: boolean; value: number | null };
  why: string[];
  sides: string[];
  flags: { type: "waste" | "meal-prep" | "side"; label: string }[];
  alternates: ProposeAlt[];
  altSimilar: ProposeAlt | null;
  altDifferent: ProposeAlt | null;
}

/** Which in-card panel is open (one at a time, page-owned). */
export type SlotPanel = "swap" | "list" | "vibe" | "sides" | "facet-protein" | "facet-cuisine" | "facet-time" | null;

/** The mock's time tiers for the per-night cap popover. */
export const TIME_TIERS: { value: number; label: string }[] = [
  { value: 20, label: "≤ 20 min" },
  { value: 30, label: "≤ 30 min" },
  { value: 45, label: "≤ 45 min" },
  { value: 60, label: "≤ 60 min" },
];

// ── controls row ────────────────────────────────────────────────────────────

/** One meal's slot-count stepper. */
export const MEAL_KEYS = ["breakfast", "lunch", "dinner"] as const;
export type MealKey = (typeof MEAL_KEYS)[number];

function MealStep(props: { meal: MealKey; value: number; min: number; max: number; onChange: (n: number) => void }) {
  const label = props.meal.charAt(0).toUpperCase() + props.meal.slice(1);
  return (
    <div className="nights-step" data-meal={props.meal}>
      <span className="nudge-label">{label}</span>
      <button
        type="button"
        className="step-btn"
        aria-label={`Fewer ${props.meal}`}
        data-testid={`meals-${props.meal}-dec`}
        disabled={props.value <= props.min}
        onClick={() => props.onChange(Math.max(props.min, props.value - 1))}
      >
        −
      </button>
      <span className="nights-n" data-testid={`meals-${props.meal}-n`}>
        {props.value}
      </span>
      <button
        type="button"
        className="step-btn"
        aria-label={`More ${props.meal}`}
        data-testid={`meals-${props.meal}-inc`}
        disabled={props.value >= props.max}
        onClick={() => props.onChange(Math.min(props.max, props.value + 1))}
      >
        +
      </button>
    </div>
  );
}

/** The per-meal steppers (D20 shared control set): one stepper per breakfast / lunch / dinner —
 *  the request's `meals` map. Replaces the single "Nights" stepper. All three are SYMMETRIC and
 *  open at 0 (0–6); the old 2-floor was an artifact of the single-"Nights" control. A 0/0/0 week
 *  degrades to the empty state with commit disabled. */
export function MealsStepper(props: {
  meals: { breakfast: number; lunch: number; dinner: number };
  max?: number;
  onChange: (meal: MealKey, n: number) => void;
}) {
  const max = props.max ?? 6;
  return (
    <div className="meals-stepper" data-testid="meals-stepper">
      {MEAL_KEYS.map((meal) => (
        <MealStep
          key={meal}
          meal={meal}
          value={props.meals[meal]}
          min={0}
          max={max}
          onChange={(n) => props.onChange(meal, n)}
        />
      ))}
    </div>
  );
}

// ── variety bar + commit ────────────────────────────────────────────────────

export function VarietyBar(props: {
  nights: number;
  cuisines: number;
  proteins: number;
  proteinHist: [string, number][];
  onCommit: () => void;
  committing?: boolean;
}) {
  return (
    <div className="variety-bar" data-testid="variety-bar">
      <div className="variety-stats">
        <span className="vstat">
          <strong>{props.nights}</strong> nights
        </span>
        <span className="vstat">
          <strong>{props.cuisines}</strong> cuisines
        </span>
        <span className="vstat">
          <strong>{props.proteins}</strong> proteins
        </span>
        <div className="pv-hist">
          {props.proteinHist.map(([p, n]) => (
            <span className={`pv-chip${n > 1 ? " rep" : ""}`} key={p}>
              {p}
              {n > 1 ? ` ×${n}` : ""}
            </span>
          ))}
        </div>
      </div>
      <Button type="button" data-testid="propose-commit" disabled={props.committing || props.nights === 0} onClick={props.onCommit}>
        <IconCalendar /> Commit to meal plan
      </Button>
    </div>
  );
}

// ── slot card ───────────────────────────────────────────────────────────────

const CARET = (
  <svg className="facet-caret" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m6 9 6 6 6-6" />
  </svg>
);

function FacetChipButton(props: {
  slotKey: string;
  kind: "protein" | "cuisine" | "time";
  text: string;
  pinned: boolean;
  onOpen: () => void;
  onClear: () => void;
}) {
  return (
    <button
      type="button"
      className={`facet facet-btn${props.pinned ? " pinned" : ""}`}
      data-kind={props.kind === "protein" ? "protein" : undefined}
      data-testid={`facet-${props.kind}`}
      title={`Filter this night by ${props.kind}`}
      onClick={props.onOpen}
    >
      <span className="facet-txt">{props.text}</span>
      {props.pinned ? (
        <span
          className="facet-x"
          role="button"
          aria-label={`Clear ${props.kind} filter`}
          title="Clear filter"
          data-testid={`facet-clear-${props.kind}`}
          onClick={(e) => {
            e.stopPropagation();
            props.onClear();
          }}
        >
          <IconX />
        </span>
      ) : (
        CARET
      )}
    </button>
  );
}

function FacetPopover(props: {
  kind: "protein" | "cuisine" | "time";
  options: { value: string; label: string }[];
  current: string | null;
  clearLabel: string;
  searchable: boolean;
  onPick: (value: string | null) => void;
}) {
  const [q, setQ] = React.useState("");
  const rows = props.options.filter((o) => !q || o.label.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="facet-pop" data-facet={props.kind} data-testid={`facet-pop-${props.kind}`}>
      <div className="facet-pop-head">Filter by {props.kind}</div>
      {props.searchable ? (
        <input
          className="facet-pop-search"
          placeholder={`Filter ${props.kind}…`}
          autoComplete="off"
          spellCheck={false}
          aria-label={`Filter ${props.kind}`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      ) : null}
      <div className="facet-pop-list">
        {rows.map((o) => (
          <button
            key={o.value}
            type="button"
            className={`facet-opt${props.current === o.value ? " on" : ""}`}
            data-testid={`facet-opt-${o.value}`}
            onClick={() => props.onPick(o.value)}
          >
            <span>{o.label}</span>
            {props.current === o.value ? <IconCheck /> : null}
          </button>
        ))}
      </div>
      <div className="facet-pop-sep" />
      <button
        type="button"
        className={`facet-opt clear${props.current == null ? " on" : ""}`}
        data-testid="facet-opt-clear"
        onClick={() => props.onPick(null)}
      >
        {props.clearLabel}
      </button>
    </div>
  );
}

export function SlotCard(props: {
  slot: ProposeSlotView;
  panel: SlotPanel;
  onPanel: (panel: SlotPanel) => void;
  proteins: string[];
  cuisines: string[];
  palettePresets: string[];
  renderTitle: (slug: string, title: string) => React.ReactNode;
  onSwapTo: (slug: string) => void;
  onFacetPick: (kind: "protein" | "cuisine", value: string | null) => void;
  /** number = cap this night; null = explicit "Any time"; undefined (clear) = follow the vibe. */
  onTimePick: (value: number | null | undefined) => void;
  onVibeApply: (text: string) => void;
  onVibeReset: () => void;
  /** Sides editing (D20): replace this slot's side titles WHOLESALE. Absent = sides read-only. */
  onSidesChange?: (sides: string[]) => void;
}) {
  const s = props.slot;
  const toggle = (panel: SlotPanel) => props.onPanel(props.panel === panel ? null : panel);

  const vibeLabel = (
    <span className={`slot-vibe${s.vibeEdited ? " edited" : ""}`} title={s.vibeEdited ? "Changed from the assigned vibe" : undefined}>
      {s.vibeLabel}
    </span>
  );

  const facetPanel =
    props.panel === "facet-protein" ? (
      <FacetPopover
        kind="protein"
        options={props.proteins.map((p) => ({ value: p, label: p }))}
        current={s.pinnedProtein}
        clearLabel="Any protein"
        searchable
        onPick={(v) => {
          props.onFacetPick("protein", v);
          props.onPanel(null);
        }}
      />
    ) : props.panel === "facet-cuisine" ? (
      <FacetPopover
        kind="cuisine"
        options={props.cuisines.map((c) => ({ value: c, label: cap(c) }))}
        current={s.pinnedCuisine}
        clearLabel="Any cuisine"
        searchable
        onPick={(v) => {
          props.onFacetPick("cuisine", v);
          props.onPanel(null);
        }}
      />
    ) : props.panel === "facet-time" ? (
      <FacetPopover
        kind="time"
        options={TIME_TIERS.map((t) => ({ value: String(t.value), label: t.label }))}
        current={s.timePin.explicit && s.timePin.value != null ? String(s.timePin.value) : null}
        clearLabel="Any time"
        searchable={false}
        onPick={(v) => {
          // The popover's "Any time" is the EXPLICIT null pin (lifts the vibe's own cap);
          // the chip's × (onClear below) is the true clear back to the vibe default.
          props.onTimePick(v === null ? null : Number(v));
          props.onPanel(null);
        }}
      />
    ) : null;

  const timePinned = s.timePin.explicit;
  const timeText = timePinned
    ? s.timePin.value != null
      ? `≤ ${s.timePin.value} min`
      : "any time"
    : s.main?.time_total != null
      ? `${s.main.time_total} min`
      : "time";

  const facetChips = (
    <div className="slot-facets">
      <FacetChipButton
        slotKey={s.key}
        kind="protein"
        text={s.pinnedProtein ?? s.main?.protein ?? "protein"}
        pinned={!!s.pinnedProtein}
        onOpen={() => toggle("facet-protein")}
        onClear={() => props.onFacetPick("protein", null)}
      />
      <FacetChipButton
        slotKey={s.key}
        kind="cuisine"
        text={s.pinnedCuisine ?? s.main?.cuisine ?? "cuisine"}
        pinned={!!s.pinnedCuisine}
        onOpen={() => toggle("facet-cuisine")}
        onClear={() => props.onFacetPick("cuisine", null)}
      />
      <FacetChipButton
        slotKey={s.key}
        kind="time"
        text={timeText}
        pinned={timePinned}
        onOpen={() => toggle("facet-time")}
        onClear={() => props.onTimePick(undefined)}
      />
    </div>
  );

  const pickList = (head: string) => (
    <div className="slot-alts" data-testid="slot-alts">
      <div className="slot-alts-head">{head}</div>
      {s.alternates.length ? (
        s.alternates.map((a) => (
          <button
            key={a.slug}
            type="button"
            className="alt-row"
            data-testid={`slot-alt-${a.slug}`}
            onClick={() => {
              props.onSwapTo(a.slug);
              props.onPanel(null);
            }}
          >
            <span className="alt-title">{a.title}</span>
            <span className="alt-facets">
              {a.protein ? (
                <span className="facet" data-kind="protein">
                  {a.protein}
                </span>
              ) : null}
              {a.cuisine ? <span className="facet">{a.cuisine}</span> : null}
            </span>
          </button>
        ))
      ) : (
        <p className="muted small">No other recipes fit this vibe under your current filters.</p>
      )}
    </div>
  );

  // ── the over-constrained / unfillable night: reason + clearable pins in place ──
  if (!s.main) {
    return (
      <article className="slot-card empty-slot" data-testid="slot-card" data-vibe={s.vibeId} data-empty="true">
        <div className="slot-head">
          <div className="slot-head-label">{vibeLabel}</div>
        </div>
        <p className="slot-empty-reason" data-testid="slot-empty-reason">
          <IconAlert /> {s.emptyReason ?? "No recipe fits this night under your current filters."}
        </p>
        <div className="slot-facets empty-facets">
          <span className="empty-facets-label">Filters on this night:</span>
          {facetChips}
        </div>
        {facetPanel}
        {s.alternates.length ? pickList("Pick a recipe for this vibe") : null}
      </article>
    );
  }

  const m = s.main;
  const swapMenu =
    props.panel === "swap" ? (
      <div className="slot-menu" role="menu" data-testid="slot-menu">
        <button
          type="button"
          className="slot-menu-item"
          data-testid="slot-swap-similar"
          disabled={!s.altSimilar}
          onClick={() => {
            if (s.altSimilar) props.onSwapTo(s.altSimilar.slug);
            props.onPanel(null);
          }}
        >
          <span>
            <IconSwap /> Something similar
          </span>
          {s.altSimilar ? <span className="menu-sub">{s.altSimilar.title}</span> : <span className="menu-sub muted">nothing close left</span>}
        </button>
        <button
          type="button"
          className="slot-menu-item"
          data-testid="slot-swap-different"
          disabled={!s.altDifferent}
          onClick={() => {
            if (s.altDifferent) props.onSwapTo(s.altDifferent.slug);
            props.onPanel(null);
          }}
        >
          <span>
            <IconSparkle /> A different cuisine
          </span>
          {s.altDifferent ? (
            <span className="menu-sub">
              {s.altDifferent.cuisine ? `${cap(s.altDifferent.cuisine)} · ` : ""}
              {s.altDifferent.title}
            </span>
          ) : (
            <span className="menu-sub muted">none available</span>
          )}
        </button>
        <button type="button" className="slot-menu-item" data-testid="slot-pick-list" onClick={() => props.onPanel("list")}>
          <span>
            <IconSearch /> Pick a specific recipe…
          </span>
        </button>
        <div className="slot-menu-sep" />
        <button type="button" className="slot-menu-item" data-testid="slot-vibe-open" onClick={() => props.onPanel("vibe")}>
          <span>
            <IconPencil /> Change the vibe…
          </span>
          {s.vibeEdited ? <span className="menu-sub">now “{s.vibeLabel}”</span> : <span className="menu-sub muted">reshape this night</span>}
        </button>
      </div>
    ) : null;

  const vibePanel = props.panel === "vibe" ? <VibePanel slot={s} presets={props.palettePresets} onApply={props.onVibeApply} onReset={props.onVibeReset} onClose={() => props.onPanel(null)} /> : null;

  return (
    <article className={`slot-card${s.locked ? " locked" : ""}`} data-testid="slot-card" data-vibe={s.vibeId} data-recipe={m.slug}>
      <div className="slot-head">
        <div className="slot-head-label">
          {vibeLabel}
          {s.weatherCategory ? (
            <span className="slot-wx" data-testid="slot-weather" data-category={s.weatherCategory}>
              {s.weatherCategory} weather
            </span>
          ) : null}
        </div>
        <div className="slot-actions">
          <button type="button" className={`slot-btn${props.panel === "swap" ? " on" : ""}`} data-testid="slot-swap" title="Swap this pick" onClick={() => toggle("swap")}>
            <IconSwap />
          </button>
        </div>
      </div>
      {props.renderTitle(m.slug, m.title)}
      {m.description ? <p className="slot-desc">{m.description}</p> : null}
      {facetChips}
      {facetPanel}
      <div className="slot-why" data-testid="slot-why">
        {s.why.map((w) => (
          <span className="why-chip" key={w}>
            {w}
          </span>
        ))}
      </div>
      <div className="slot-footer">
        <div className="slot-sides" data-testid="slot-sides">
          {s.sides.length ? (
            s.sides.map((x) => (
              <span className="side-chip" key={x}>
                {x}
                {props.onSidesChange ? (
                  <span
                    className="side-x"
                    role="button"
                    aria-label={`Remove side ${x}`}
                    title="Remove side"
                    data-testid="slot-side-remove"
                    onClick={() => props.onSidesChange!(s.sides.filter((y) => y !== x))}
                  >
                    <IconX />
                  </span>
                ) : null}
              </span>
            ))
          ) : (
            <span className="muted small">no side</span>
          )}
          {props.onSidesChange ? (
            <button
              type="button"
              className="side-add"
              data-testid="slot-side-add"
              title="Add a side"
              onClick={() => toggle("sides")}
            >
              + side
            </button>
          ) : null}
        </div>
        <div className="slot-flags">
          {s.flags.map((f) => (
            <span className={`slot-flag flag-${f.type}`} key={`${f.type}:${f.label}`}>
              {f.type === "waste" ? <IconAlert /> : f.type === "meal-prep" ? <IconCheck /> : null}
              {f.label}
            </span>
          ))}
        </div>
      </div>
      {swapMenu}
      {props.panel === "list" ? pickList("Pick a recipe for this vibe") : null}
      {vibePanel}
      {props.panel === "sides" && props.onSidesChange ? (
        <SidesEditor
          sides={s.sides}
          onChange={props.onSidesChange}
          onClose={() => props.onPanel(null)}
        />
      ) : null}
    </article>
  );
}

/** The sides-editing panel (D20): add a free-text side, or remove one from the chip row. A sides
 *  edit refines the already-proposed week WITHOUT a re-query (decision 1) — the controller routes
 *  it through the context-only channel. */
function SidesEditor(props: { sides: string[]; onChange: (sides: string[]) => void; onClose: () => void }) {
  const [text, setText] = React.useState("");
  const add = () => {
    const t = text.trim();
    if (!t || props.sides.some((s) => s.toLowerCase() === t.toLowerCase())) return;
    props.onChange([...props.sides, t]);
    setText("");
  };
  return (
    <div className="slot-sides-edit" data-testid="slot-sides-edit">
      <div className="slot-alts-head">Edit this night’s sides</div>
      <form
        className="slot-vibe-form"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input
          className="input slot-vibe-in"
          value={text}
          placeholder="Add a side…"
          autoComplete="off"
          spellCheck={false}
          aria-label="Add a side"
          data-testid="slot-side-input"
          onChange={(e) => setText(e.target.value)}
        />
        <Button type="submit" size="sm" data-testid="slot-side-apply">
          Add
        </Button>
      </form>
      {props.sides.length ? (
        <div className="slot-side-list">
          {props.sides.map((x) => (
            <span className="side-chip" key={x}>
              {x}
              <span
                className="side-x"
                role="button"
                aria-label={`Remove side ${x}`}
                title="Remove side"
                onClick={() => props.onChange(props.sides.filter((y) => y !== x))}
              >
                <IconX />
              </span>
            </span>
          ))}
        </div>
      ) : (
        <p className="muted small">No sides yet — add one above.</p>
      )}
      <button type="button" className="slot-vibe-reset" data-testid="slot-sides-close" onClick={props.onClose}>
        <IconBack /> Done
      </button>
    </div>
  );
}

/** The change-the-vibe panel: a typed phrase (Apply) or a palette preset; both replace
 *  this night's query vector server-side (`slots[].vibe`). */
function VibePanel(props: {
  slot: ProposeSlotView;
  presets: string[];
  onApply: (text: string) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const [text, setText] = React.useState(props.slot.vibeLabel);
  return (
    <div className="slot-vibes" data-testid="slot-vibes">
      <div className="slot-alts-head">Change this night’s vibe</div>
      <form
        className="slot-vibe-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) {
            props.onApply(text.trim());
            props.onClose();
          }
        }}
      >
        <input
          className="input slot-vibe-in"
          value={text}
          placeholder="Describe this night…"
          autoComplete="off"
          spellCheck={false}
          aria-label="Describe this night"
          data-testid="slot-vibe-input"
          onChange={(e) => setText(e.target.value)}
        />
        <Button type="submit" size="sm" data-testid="slot-vibe-apply">
          Apply
        </Button>
      </form>
      <div className="slot-vibes-or">or pick one of your vibes</div>
      <div className="slot-vibe-presets">
        {props.presets.map((v) => (
          <button
            key={v}
            type="button"
            className={`vibe-preset${props.slot.vibeLabel.toLowerCase() === v.toLowerCase() ? " on" : ""}`}
            data-testid="slot-vibe-preset"
            onClick={() => {
              props.onApply(v);
              props.onClose();
            }}
          >
            {v}
          </button>
        ))}
      </div>
      {props.slot.vibeEdited ? (
        <button
          type="button"
          className="slot-vibe-reset"
          data-testid="slot-vibe-reset"
          onClick={() => {
            props.onReset();
            props.onClose();
          }}
        >
          <IconBack /> Reset to the assigned vibe
        </button>
      ) : null}
    </div>
  );
}
