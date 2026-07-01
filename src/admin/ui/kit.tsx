// The thin admin component kit (operator-admin). Presentational hono/jsx primitives the areas
// compose from — they emit Basecoat's class + `data-variant`/`data-size` API (see
// src/admin/CLAUDE.md › Styling). No event handlers here (those live in client islands); modals
// are the native <dialog> element, opened from an island — no Basecoat component JS.
// `Dot`/`TierBadge`/`Pill` keep their panel-specific semantic styling (Basecoat has no
// green/amber status badge or nav-pill equivalent).

import type { Child } from "hono/jsx";
import { CheckCircleIcon, XCircleIcon, MinusCircleIcon, TrashIcon } from "./icons.js";

/** A Basecoat card. Children render in the padded `<section>`; pass a `<header>`/`<footer>`
 *  among the children when a title or action row is wanted. */
export const Card = ({ children }: { children?: Child }) => (
  <div class="card">
    <section>{children}</section>
  </div>
);

type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "link" | "destructive";
type ButtonSize = "sm" | "default" | "lg";

/** A submit/action button. Islands attach behavior; this only carries the look + a11y.
 *  `primary`/`default` are Basecoat's defaults, so they emit no attribute. */
export const Button = ({
  children,
  variant = "primary",
  size = "default",
  type = "button",
}: {
  children?: Child;
  variant?: ButtonVariant;
  size?: ButtonSize;
  type?: "button" | "submit";
}) => (
  <button
    type={type}
    class="btn"
    data-variant={variant === "primary" ? undefined : variant}
    data-size={size === "default" ? undefined : size}
  >
    {children}
  </button>
);

/** A nav/filter pill (panel-specific — Basecoat has no nav-pill component). */
export const Pill = ({ label, active }: { label: string; active?: boolean }) => (
  <span class={active ? "pill active" : "pill"}>{label}</span>
);

/** A projection-status badge (`indexed` / `skipped` / `pending` / `orphaned`) — keeps its
 *  semantic colors (Basecoat badges have no green/amber variant). */
export const TierBadge = ({ status }: { status: string }) => (
  <span class={`tier ${status}`}>{status}</span>
);

type DotState = "ok" | "fail" | "never" | "muted";

export const Dot = ({ state }: { state: DotState }) => <span class={`dot ${state}`} />;

/** A Basecoat badge (status/role pills — owner, active/pending, kroger-linked, …). `default`
 *  is Basecoat's default variant, so it emits no `data-variant` attribute. */
export const Badge = ({ variant = "default", children }: { variant?: string; children?: Child }) => (
  <span class="badge" data-variant={variant === "default" ? undefined : variant}>
    {children}
  </span>
);

/** An icon-only trash-can remove button (mirrors the mock's `CorpusEditor`/`AlwaysImport`
 *  `.cfg-remove` — a bare, low-emphasis icon that reddens on hover, replacing the text "remove"
 *  `btn[data-variant=destructive]` pattern). `disabled` covers the in-flight-removal case; the
 *  click handler is wired by the consuming island (this stays presentational, like the rest of
 *  the kit — admin/CLAUDE.md rule 8). */
export const RemoveButton = ({ onClick, disabled }: { onClick?: () => void; disabled?: boolean }) => (
  <button type="button" class="cfg-remove" aria-label="Remove" disabled={disabled} onClick={onClick}>
    <TrashIcon size={14} />
  </button>
);

/** A destructive Basecoat alert (the panel's inline error banner). */
export const ErrorBanner = ({ message }: { message: string }) => (
  <div class="alert" data-variant="destructive">
    <section>{message}</section>
  </div>
);

/** A labelled text input (Basecoat `label` + `input`). `name` is the form field; `value`
 *  seeds it server-side. */
export const Field = ({
  label,
  name,
  value,
  placeholder,
}: {
  label: string;
  name: string;
  value?: string;
  placeholder?: string;
}) => (
  <div class="grid gap-2">
    <label class="label" for={name}>
      {label}
    </label>
    <input class="input" type="text" id={name} name={name} value={value ?? ""} placeholder={placeholder ?? ""} />
  </div>
);

export const Table = ({ head, children }: { head: Child; children?: Child }) => (
  <table class="table">
    <thead>
      <tr>{head}</tr>
    </thead>
    <tbody>{children}</tbody>
  </table>
);

/** A Basecoat modal: the native `<dialog>` element (CSS-only — no Basecoat JS). An island opens
 *  it with `document.getElementById(id).showModal()` and closes via a `<form method="dialog">`
 *  button or `dialogEl.close()`. */
export const Dialog = ({ id, title, children }: { id: string; title: string; children?: Child }) => (
  <dialog id={id} class="dialog" aria-labelledby={`${id}-title`}>
    <div>
      <header>
        <h2 id={`${id}-title`}>{title}</h2>
      </header>
      <section>{children}</section>
    </div>
  </dialog>
);

// ── Redesign primitives (admin-ui-redesign-foundation) ──────────────────────────────────────
// The shared presentational vocabulary the redesigned areas compose from — list rows, avatars,
// stat tiles, pagers, sparklines, progress, and the form controls the calibration consoles use.
// Each emits panel layout classes (see styles.css) + Basecoat classes; none carries an event
// handler (interactivity lives in islands), so they are SSR-safe.

/** Join optional class names into one attribute string (drops falsy parts). */
function cx(...parts: (string | undefined | false)[]): string {
  return parts.filter(Boolean).join(" ");
}

/** A vertical list container for `Item` rows (the redesign's roster/list surfaces). */
export const ItemGroup = ({ class: cls, children }: { class?: string; children?: Child }) => (
  <div class={cx("item-group", cls)}>{children}</div>
);

/** A list row with media / title / description / actions slots plus optional sub-content
 *  (children). Presentational — a clickable row wires its handler in an island. */
export const Item = ({
  media,
  title,
  description,
  actions,
  outline,
  class: cls,
  children,
}: {
  media?: Child;
  title?: Child;
  description?: Child;
  actions?: Child;
  outline?: boolean;
  class?: string;
  children?: Child;
}) => (
  <div class={cx("item", outline && "item-outline", cls)}>
    {media != null ? <figure class="item-media">{media}</figure> : null}
    <section class="item-body">
      {title != null ? <div class="item-title">{title}</div> : null}
      {description != null ? <div class="item-desc">{description}</div> : null}
      {children}
    </section>
    {actions != null ? <aside class="item-actions">{actions}</aside> : null}
  </div>
);

/** A circular initials avatar (Basecoat ships none). `lg` is the roster size. */
export const Avatar = ({ fallback, size }: { fallback: string; size?: "lg" }) => (
  <figure class={cx("avatar", size === "lg" && "avatar-lg")} aria-hidden="true">
    {fallback}
  </figure>
);

/** The page-level stat-tile grid (4-up, responsive). */
export const StatCardGrid = ({ children }: { children?: Child }) => <div class="stat-grid">{children}</div>;

/** One stat tile: an icon + uppercase label and a large value, with an optional sub-line. When
 *  `href` is given the whole tile is a link (the redesign's "drill into this area" affordance). */
export const StatCard = ({
  icon,
  label,
  value,
  sub,
  href,
}: {
  icon?: Child;
  label: string;
  value: Child;
  sub?: Child;
  href?: string;
}) => {
  const body = (
    <>
      <div class="stat-top">
        {icon != null ? <span class="stat-ico">{icon}</span> : null}
        <span class="stat-label">{label}</span>
      </div>
      <div class="stat-value">{value}</div>
      {sub != null ? <div class="stat-sub">{sub}</div> : null}
    </>
  );
  return href != null ? (
    <a class="stat-card stat-card-link" href={href}>
      {body}
    </a>
  ) : (
    <div class="stat-card">{body}</div>
  );
};

/** A prev / info / next pager row. The prev/next slots are caller-supplied (links for SSR,
 *  buttons inside an island) so the primitive stays presentational. */
export const Pager = ({ info, prev, next }: { info: Child; prev?: Child; next?: Child }) => (
  <div class="pager">
    {prev ?? <span />}
    <span class="pager-info muted small">{info}</span>
    {next ?? <span />}
  </div>
);

/** A bottom-aligned bar sparkline. Heights are scaled to `max` (or the series max). */
export const Sparkline = ({ values, max }: { values: number[]; max?: number }) => {
  const m = Math.max(1, max ?? 0, ...values);
  return (
    <div class="spark">
      {values.map((v) => (
        <span class="spark-bar" style={`height:${Math.max(8, Math.round((v / m) * 100))}%`} />
      ))}
    </div>
  );
};

// ── Sparkline hover-tooltip primitive (admin-ui-fidelity-pass, shared) ─────────────────────────
// The mock's `useTip()` drives one floating `.bar-tip` bubble imperatively from bar mouse
// handlers (fixed-positioned, following the cursor) rather than a per-bar React/JSX tooltip node
// — cheap for a track of hundreds of thin bars. Since the SSR pages that host a sparkline (Status,
// Usage) ship no island, the SSR side of this primitive only emits `data-tip-title`/
// `data-tip-body`/`data-tip-variant` attributes on each segment; the interactive half lives in
// `src/admin/client/sparkline-tip.tsx`, a small progressive-enhancement script (plain DOM
// listeners, no hono/jsx/dom hydration) that finds every `[data-tip-title]` element on the page
// and wires mouseenter/mouseleave to show/hide the bubble. `Layout` includes that script's bundle
// on every page, so any SSR-rendered segment carrying these attributes gets a tooltip for free.

/** One sparkline segment's tip content + the segment's own render (href/onClick-free — those are
 *  page-specific; this only carries the visual + a11y + tooltip data attributes). */
export interface TipSegment {
  /** The segment's fractional value (0–1) driving its height; already scaled by the caller. */
  frac: number;
  /** A CSS class suffix appended to `spark-bar`/`uptime-bar` (e.g. "ok"/"fail"). */
  state?: string;
  tipTitle?: string;
  tipBody?: string;
  /** Selects the `.bar-tip.fail` destructive tooltip skin (mirrors the mock's `variant: "fail"`). */
  tipVariant?: "fail";
  href?: string;
  ariaLabel?: string;
}

/** A capped-width, right-aligned track of tip-bearing segments (mirrors the mock's
 *  `uptime-track`): segments never stretch to fill an under-populated series (a still-warming-up
 *  job's 3-of-30 runs render as 3 normal-width bars flush right, not 3 bars stretched to fill the
 *  row), and each segment carries the `data-tip-*` attributes the client script reads. `axis`
 *  renders the "OLDER"/"NOW" caption row beneath the track when true. */
export const SparklineTrack = ({
  segments,
  axis,
  class: cls,
}: {
  segments: TipSegment[];
  axis?: boolean;
  class?: string;
}) => (
  <div class={cx("spark-track-wrap", cls)}>
    <div class="spark-track">
      {segments.map((s) => {
        const body = (
          <span
            class={cx("spark-seg-tip", s.state)}
            style={`height:${Math.max(8, Math.round(s.frac * 100))}%`}
            data-tip-title={s.tipTitle}
            data-tip-body={s.tipBody}
            data-tip-variant={s.tipVariant}
            aria-label={s.ariaLabel}
          />
        );
        return s.href != null ? (
          <a class="spark-seg-link" href={s.href}>
            {body}
          </a>
        ) : (
          body
        );
      })}
    </div>
    {axis ? (
      <div class="spark-axis">
        <span>OLDER</span>
        <span>NOW</span>
      </div>
    ) : null}
  </div>
);

/** A determinate progress bar (0–100). */
export const Progress = ({ value }: { value: number }) => {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div class="progress" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <span style={`width:${pct}%`} />
    </div>
  );
};

/** A styled on/off switch (a checkbox; an island reads its `change`). */
export const Switch = ({ name, checked }: { name?: string; checked?: boolean }) => (
  <label class="switch">
    <input type="checkbox" name={name} checked={checked} />
    <span class="switch-track" />
  </label>
);

/** The `--slider-value` percent Basecoat's Vega stylesheet reads to paint the filled portion of
 *  the track (`linear-gradient(to right, var(--primary) var(--slider-value), var(--muted) …)`);
 *  Basecoat's own fallback is a hardcoded `20%`, which is what every slider showed before this
 *  fix (kit.tsx never set the var, so every slider defaulted to it regardless of `value`). */
export function sliderFillPct(min: number, max: number, value: number): number {
  if (max <= min) return 0;
  return Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
}

/** A range slider input. Sets `--slider-value` from `value` on first (SSR) render so the fill is
 *  correct on first paint, not just after an island hydrates. `onInput` is optional (kit stays
 *  presentational for read-only SSR call sites — admin/CLAUDE.md rule 8 — but a genuinely
 *  interactive caller, like `KnobRow` in client/knob-console.tsx, passes one to both drive its
 *  own draft state AND recompute the fill var live while dragging, matching `RemoveButton`'s
 *  optional-`onClick` precedent above). */
export const Slider = ({
  name,
  min,
  max,
  step,
  value,
  onInput,
}: {
  name?: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  onInput?: (e: Event) => void;
}) => (
  <input
    class="input slider"
    type="range"
    name={name}
    min={min}
    max={max}
    step={step ?? 1}
    value={value}
    style={`--slider-value:${sliderFillPct(min, max, value)}%`}
    onInput={onInput}
  />
);

// ── Knob spec (admin-ui-redesign-config) ────────────────────────────────────
// A knob is one numeric config field: identity, range, optional safe floor, and help copy.
// The row itself (label + numeric input + Slider + help/floor-warning text) needs an
// `onInput` handler, so it is genuinely interactive and lives in the shared client module
// (src/admin/client/knob-console.tsx) as `KnobRow`, not here — kit.tsx stays handler-free
// per its "presentational only" convention (admin/CLAUDE.md rule 8). This interface is the
// one shared shape both the client `KnobRow`/`KnobConsole` and each group's island import.

/** A knob's static spec. A knob with `floor` left undefined has no safe-floor concept for
 *  that config — it never renders the below-floor warning and never drives a NeedsConfirm
 *  state (see operator-config.ts's ranking weights, which are intentionally floor-free). */
export interface KnobSpec {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  /** Percent-displayed knobs store a 0–1 fraction but render/edit as a whole-number percent. */
  pct?: boolean;
  /** The safe floor (raw units, pre-`pct` scaling). Omit when the knob has no footgun floor. */
  floor?: number;
  help?: string;
}

/** A column spec for `DataTable`: a key, a header label, and an optional right alignment. A
 *  bare string is shorthand for `{ key, label: key }`. */
export interface Column {
  key: string;
  label: string;
  align?: "right";
}

function colOf(c: string | Column): Column {
  return typeof c === "string" ? { key: c, label: c } : c;
}

/** A column-spec data table (the redesign's pantry / SKU / tool-usage tables). Rows are a
 *  `key → cell` map; cells are already-rendered nodes. */
export const DataTable = ({ columns, rows }: { columns: (string | Column)[]; rows: Record<string, Child>[] }) => (
  <table class="table">
    <thead>
      <tr>
        {columns.map((c) => {
          const col = colOf(c);
          return <th style={col.align === "right" ? "text-align:right" : undefined}>{col.label}</th>;
        })}
      </tr>
    </thead>
    <tbody>
      {rows.map((r) => (
        <tr>
          {columns.map((c) => {
            const col = colOf(c);
            return <td style={col.align === "right" ? "text-align:right" : undefined}>{r[col.key]}</td>;
          })}
        </tr>
      ))}
    </tbody>
  </table>
);

// ── PrettyKV: a readable key/value renderer for structured records (member-detail Profile,
// recipe frontmatter) — arrays render as chips, null as an em-dash, http(s) strings as links,
// nested objects recurse as an indented sub-table. Presentational, SSR-safe (no handlers).

function prettyValue(v: unknown): Child {
  if (v === null || v === undefined) return <span class="pv-null">—</span>;
  if (typeof v === "boolean") return <span class="pv-bool">{String(v)}</span>;
  if (typeof v === "number") return <span class="pv-num">{v.toLocaleString()}</span>;
  if (Array.isArray(v)) {
    return v.length ? (
      <span class="pv-chips">
        {v.map((x) => (
          <span class="pv-chip">{typeof x === "object" && x !== null ? JSON.stringify(x) : String(x)}</span>
        ))}
      </span>
    ) : (
      <span class="pv-null">empty</span>
    );
  }
  if (typeof v === "object") return <PrettyKV obj={v as Record<string, unknown>} nested />;
  if (typeof v === "string" && /^https?:\/\//.test(v)) {
    return (
      <a class="pv-link" href={v} target="_blank" rel="noreferrer">
        {v}
      </a>
    );
  }
  return <span class="pv-str">{String(v)}</span>;
}

/** A plain object rendered as a readable key/value table. `nested` is for the recursive case
 *  (an object-valued field), applying a tighter indent. */
export const PrettyKV = ({ obj, nested }: { obj: Record<string, unknown> | null | undefined; nested?: boolean }) => {
  const entries = Object.entries(obj ?? {});
  if (entries.length === 0) return <p class="muted" style="margin:0">(empty)</p>;
  return (
    <div class={cx("pkv", nested && "pkv-nested")}>
      {entries.map(([k, v]) => (
        <div class="pkv-row">
          <span class="pkv-k">{k}</span>
          <span class="pkv-v">
            {prettyValue(v)}
          </span>
        </div>
      ))}
    </div>
  );
};

/** A job/candidate-property pill: `label:value` as a small rounded badge (mirrors the mock's
 *  `jstat`/`jstat-k`/`jstat-v` — Status renders a job's summary counts as a row of these instead
 *  of plain key:value text). Presentational; the caller supplies already-stringified values
 *  (Status's `summaryValue` already formats timestamps vs raw JSON). */
export const StatPill = ({ label, value }: { label: string; value: Child }) => (
  <span class="jstat">
    <span class="jstat-k">{label}</span>
    <span class="jstat-v">{value}</span>
  </span>
);

/** A dropdown menu item: a label, an optional href (link) or it renders as a button shell, and
 *  an optional destructive styling. The open/close behavior is wired by the consuming island. */
export interface MenuItem {
  label: Child;
  href?: string;
  destructive?: boolean;
}

/** A dropdown-menu shell: a trigger and a (hidden) menu of items. Presentational — an island
 *  toggles `[hidden]` on the popover; no Basecoat component JS. */
export const DropdownMenu = ({ trigger, items }: { trigger: Child; items: MenuItem[] }) => (
  <div class="dropdown-menu">
    <button class="btn" data-variant="ghost" data-size="icon" aria-haspopup="menu" aria-expanded="false">
      {trigger}
    </button>
    <div class="dropdown-pop" role="menu" hidden>
      {items.map((it) =>
        it.href != null ? (
          <a role="menuitem" href={it.href} class={cx("menu-item", it.destructive && "destructive")}>
            {it.label}
          </a>
        ) : (
          <button type="button" role="menuitem" class={cx("menu-item", it.destructive && "destructive")}>
            {it.label}
          </button>
        ),
      )}
    </div>
  </div>
);

// ── StageTrack (admin-ui-redesign-discovery) ────────────────────────────────────────────────
// A generic stage-progression track: a connected horizontal sequence of `stages`, each marked
// done / halt / todo relative to `haltIndex`. No discovery-specific knowledge is baked in
// beyond what the caller passes, so a future stage-pipeline view can reuse it. Presentational
// only (no handlers), SSR-safe. Emits `pl-track`/`pl-stage`/`pl-node`/`pl-seg` classes ported
// from the design mock's CSS naming (see styles.css).

/** A generic stage's identity: a stable key + display label (the caller owns the icon slot). */
export interface StageSpec {
  key: string;
  label: string;
  icon?: Child;
}

export const StageTrack = ({
  stages,
  haltIndex,
  kind,
  imported,
}: {
  /** The stages in pipeline order. */
  stages: StageSpec[];
  /** Index into `stages` of the candidate's furthest/halt stage. */
  haltIndex: number;
  /** The outcome-kind coloring the halt node (ignored when `imported`). */
  kind: string;
  /** True when the halt stage is fully PASSED, not a stop (e.g. an imported candidate). */
  imported?: boolean;
}) => (
  <div class="pl-track" role="list" aria-label="pipeline progression">
    {stages.map((s, i) => {
      const isHalt = i === haltIndex && !imported;
      const done = i < haltIndex || (i === haltIndex && imported);
      const state = done ? "done" : isHalt ? kind : "todo";
      return (
        <div class={cx("pl-stage", state, isHalt && "halt")} role="listitem">
          <div class="pl-node">
            {done ? (
              <CheckCircleIcon size={15} />
            ) : isHalt ? (
              kind === "park" || kind === "fail" ? (
                <XCircleIcon size={15} />
              ) : (
                <MinusCircleIcon size={15} />
              )
            ) : (
              (s.icon ?? null)
            )}
          </div>
          <span class="pl-label">{s.label}</span>
          {i < stages.length - 1 ? <span class={cx("pl-seg", i < haltIndex ? "done" : "todo")} /> : null}
        </div>
      );
    })}
  </div>
);
