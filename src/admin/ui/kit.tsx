// The thin admin component kit (operator-admin). Presentational hono/jsx primitives the areas
// compose from — they emit Basecoat's class + `data-variant`/`data-size` API (see
// src/admin/CLAUDE.md › Styling). No event handlers here (those live in client islands); modals
// are the native <dialog> element, opened from an island — no Basecoat component JS.
// `Dot`/`TierBadge`/`Pill` keep their panel-specific semantic styling (Basecoat has no
// green/amber status badge or nav-pill equivalent).

import type { Child } from "hono/jsx";

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

/** A range slider input (an island reads its `input`). */
export const Slider = ({
  name,
  min,
  max,
  step,
  value,
}: {
  name?: string;
  min: number;
  max: number;
  step?: number;
  value: number;
}) => <input class="input slider" type="range" name={name} min={min} max={max} step={step ?? 1} value={value} />;

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
