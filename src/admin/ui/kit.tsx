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
