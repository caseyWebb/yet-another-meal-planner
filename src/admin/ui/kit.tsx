// The thin admin component kit (operator-admin, Decision 9). Presentational hono/jsx
// primitives the areas compose from — they own their markup + class usage; styling stays
// global in admin/styles.css. No event handlers here (those live in client islands).

import type { Child } from "hono/jsx";

export const Card = ({ children }: { children?: Child }) => <div class="card-legacy">{children}</div>;

type ButtonVariant = "primary" | "link" | "danger" | "danger-solid";

/** A submit/action button. Islands attach behavior; this only carries the look + a11y. */
export const Button = ({
  children,
  variant = "primary",
  type = "button",
}: {
  children?: Child;
  variant?: ButtonVariant;
  type?: "button" | "submit";
}) => (
  <button type={type} class={variant === "primary" ? "" : variant}>
    {children}
  </button>
);

export const Pill = ({ label, active }: { label: string; active?: boolean }) => (
  <span class={active ? "pill active" : "pill"}>{label}</span>
);

/** A projection-status badge (`indexed` / `skipped` / `pending` / `orphaned`). */
export const TierBadge = ({ status }: { status: string }) => (
  <span class={`tier ${status}`}>{status}</span>
);

type DotState = "ok" | "fail" | "never" | "muted";

export const Dot = ({ state }: { state: DotState }) => <span class={`dot ${state}`} />;

export const ErrorBanner = ({ message }: { message: string }) => <div class="error">{message}</div>;

/** A labelled text input. `name` is the form field; `value` seeds it server-side. */
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
  <label>
    {label}
    <input type="text" name={name} value={value ?? ""} placeholder={placeholder ?? ""} />
  </label>
);

export const Table = ({ head, children }: { head: Child; children?: Child }) => (
  <table>
    <thead>
      <tr>{head}</tr>
    </thead>
    <tbody>{children}</tbody>
  </table>
);

export const Dialog = ({ title, children }: { title: string; children?: Child }) => (
  <div class="dialog-backdrop">
    <div class="dialog-legacy">
      <div class="dialog-head">
        <h2>{title}</h2>
      </div>
      <div class="dialog-body">{children}</div>
    </div>
  </div>
);
