// Propose-flow primitives (member-app-propose 5.1), transcribed from the design
// bundle's app-propose-ui.js markup + app-propose.css: nights stepper, nudge bar
// (adventurousness slider, protein-want chips, the 400 ms-debounced freeform input),
// weather strip (built to the bundle's .wx-strip CSS spec — D11 deviation (1): the
// mock shipped the CSS without markup), variety bar + commit, and the slot card with
// its head actions, facet chips + popovers, swap menu, pick list, vibe panel, why /
// side / flag chips, and the empty-slot state with clearable pins. Presentational:
// the page owns the client propose session and every callback; nothing here holds
// server state. Router-agnostic (slot titles render through `renderTitle`).
import * as React from "react";
import { Button } from "./button";
import {
  IconAlert,
  IconBack,
  IconCalendar,
  IconCheck,
  IconDice,
  IconLock,
  IconPencil,
  IconSearch,
  IconSparkle,
  IconSwap,
  IconUnlock,
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
export type SlotPanel = "swap" | "list" | "vibe" | "facet-protein" | "facet-cuisine" | "facet-time" | null;

/** The mock's time tiers for the per-night cap popover. */
export const TIME_TIERS: { value: number; label: string }[] = [
  { value: 20, label: "≤ 20 min" },
  { value: 30, label: "≤ 30 min" },
  { value: 45, label: "≤ 45 min" },
  { value: 60, label: "≤ 60 min" },
];

// ── controls row ────────────────────────────────────────────────────────────

export function NightsStepper(props: { value: number; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <div className="nights-step">
      <span className="nudge-label">Nights</span>
      <button
        type="button"
        className="step-btn"
        aria-label="Fewer nights"
        data-testid="nights-dec"
        disabled={props.value <= props.min}
        onClick={() => props.onChange(Math.max(props.min, props.value - 1))}
      >
        −
      </button>
      <span className="nights-n" data-testid="nights-n">
        {props.value}
      </span>
      <button
        type="button"
        className="step-btn"
        aria-label="More nights"
        data-testid="nights-inc"
        disabled={props.value >= props.max}
        onClick={() => props.onChange(Math.min(props.max, props.value + 1))}
      >
        +
      </button>
    </div>
  );
}

/** The nudge bar: adventurousness ↔ the variety nudge, week-level protein wants, and
 *  the freeform phrase (debounced 400 ms — the mock's cadence — so typing doesn't
 *  re-query per keystroke). */
export function NudgeBar(props: {
  variety: number;
  onVariety: (v: number) => void;
  proteins: string[];
  proteinWants: string[];
  onToggleProtein: (p: string) => void;
  freeform: string;
  onFreeform: (text: string) => void;
}) {
  const [draft, setDraft] = React.useState(props.freeform);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // An external reset (Start over / commit) clears the input.
  React.useEffect(() => setDraft(props.freeform), [props.freeform]);
  const emit = (value: string) => {
    setDraft(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => props.onFreeform(value), 400);
  };
  return (
    <div className="nudges">
      <div className="nudge">
        <span className="nudge-label">How adventurous?</span>
        <div className="nudge-slider">
          <span className="muted small">stick to hits</span>
          <input
            type="range"
            className="input"
            min={0}
            max={1}
            step={0.1}
            value={props.variety}
            aria-label="How adventurous"
            data-testid="nudge-variety"
            onChange={(e) => props.onVariety(Number(e.target.value))}
          />
          <span className="muted small">mix it up</span>
        </div>
      </div>
      <div className="nudge">
        <span className="nudge-label">
          Proteins you want this week <span className="muted">— optional</span>
        </span>
        <div className="chip-toggle">
          {props.proteins.map((p) => (
            <button
              key={p}
              type="button"
              className={`chip-tog${props.proteinWants.includes(p) ? " on" : ""}`}
              aria-pressed={props.proteinWants.includes(p)}
              data-testid={`protein-want-${p}`}
              onClick={() => props.onToggleProtein(p)}
            >
              {p}
            </button>
          ))}
        </div>
      </div>
      <div className="nudge nudge-wide">
        <span className="nudge-label">
          In your own words <span className="muted">— optional</span>
        </span>
        <input
          className="input"
          type="text"
          value={draft}
          placeholder="e.g. more soup, lighter dinners, use up the salmon…"
          aria-label="In your own words"
          data-testid="nudge-freeform"
          onChange={(e) => emit(e.target.value)}
        />
      </div>
    </div>
  );
}

// ── weather strip (built to app-propose.css's .wx-strip spec) ───────────────

export interface WeatherStripDay {
  date: string;
  high: number;
  low: number;
  condition: string;
  /** The derived category accent (grill / cold-comfort / wet / mild). */
  category: "grill" | "cold-comfort" | "wet" | "mild";
}

/** Map a day's category to the CSS accent vocabulary (`.wx-day[data-cond]`). */
function accentOf(day: WeatherStripDay): string {
  if (day.category === "grill") return "hot";
  if (day.category === "cold-comfort") return "cold";
  if (day.category === "wet") return "rainy";
  return "mild";
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function WeatherStrip(props: { days: WeatherStripDay[] }) {
  if (props.days.length === 0) return null;
  return (
    <div className="wx-strip" data-testid="wx-strip">
      {props.days.slice(0, 7).map((d) => (
        <div className="wx-day" key={d.date} data-cond={accentOf(d)}>
          <span className="wx-dow">{DOW[new Date(`${d.date}T00:00:00`).getDay()] ?? d.date.slice(5)}</span>
          <span className="wx-temp">{Math.round(d.high)}°</span>
          <span className="wx-cond">{d.condition.replace(/_/g, " ")}</span>
          <span className="wx-vibes">{Math.round(d.low)}° low</span>
        </div>
      ))}
    </div>
  );
}

/** The quiet no-location state (never an error page): a set-your-ZIP affordance. */
export function WeatherNoLocation(props: { action?: React.ReactNode }) {
  return (
    <div className="wx-nolocation" data-testid="wx-nolocation">
      <IconAlert /> No forecast — set your ZIP in your profile to plan around the weather.
      {props.action}
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
  onLockToggle: () => void;
  onSwapTo: (slug: string) => void;
  onExclude: () => void;
  onFacetPick: (kind: "protein" | "cuisine", value: string | null) => void;
  /** number = cap this night; null = explicit "Any time"; undefined (clear) = follow the vibe. */
  onTimePick: (value: number | null | undefined) => void;
  onVibeApply: (text: string) => void;
  onVibeReset: () => void;
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
          <button
            type="button"
            className={`slot-btn${s.locked ? " on" : ""}`}
            data-testid="slot-lock"
            title={s.locked ? "Unlock — let re-roll change it" : "Keep this one when I re-roll"}
            onClick={props.onLockToggle}
          >
            {s.locked ? <IconLock /> : <IconUnlock />}
          </button>
          <button type="button" className={`slot-btn${props.panel === "swap" ? " on" : ""}`} data-testid="slot-swap" title="Swap this pick" onClick={() => toggle("swap")}>
            <IconSwap />
          </button>
          <button type="button" className="slot-btn" data-testid="slot-exclude" title="Not this one — remove and refill" onClick={props.onExclude}>
            <IconX />
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
        <div className="slot-sides">
          {s.sides.length ? (
            s.sides.map((x) => (
              <span className="side-chip" key={x}>
                {x}
              </span>
            ))
          ) : (
            <span className="muted small">no side</span>
          )}
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
    </article>
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

/** The re-roll control (seed + 1 — the page owns the seed). */
export function RerollButton(props: { onClick: () => void; disabled?: boolean }) {
  return (
    <Button type="button" variant="outline" data-testid="propose-reroll" disabled={props.disabled} onClick={props.onClick}>
      <IconDice /> Re-roll
    </Button>
  );
}
