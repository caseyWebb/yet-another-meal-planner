// The thin admin component kit (operator-admin), ported from the SSR panel's ui/kit.tsx onto
// React + the shared shadcn/ui primitives. GENERIC primitives (button, card, badge, alert,
// input, table, dialog, dropdown) compose @yamp/ui per the visual-layer requirement;
// the PANEL composites (items, stat tiles, pills, sparklines, progression track, PrettyKV)
// keep their class vocabulary (src/admin.css) so the areas — and the Playwright page
// objects — read identically. Composites stay presentational: interactivity lives in the
// consuming screen's component state.

import * as React from "react";
import {
  Button as UiButton,
  Card as UiCard,
  CardContent,
  Badge as UiBadge,
  Alert,
  AlertDescription,
  Input,
  Label,
  cn,
} from "@yamp/ui";
import { CheckCircleIcon, XCircleIcon, MinusCircleIcon, TrashIcon, InboxIcon } from "./icons";

type Child = React.ReactNode;

/** A panel card: the shared Card primitive with the panel's tighter padding. */
export const Card = ({ className, children }: { className?: string; children?: Child }) => (
  <UiCard className={cn("card mb-4 gap-0 rounded-lg py-4 shadow-xs", className)}>
    <CardContent className="px-5">{children}</CardContent>
  </UiCard>
);

type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "link" | "destructive";

/** The shared Button with the SSR kit's prop vocabulary (`primary` = shadcn `default`). */
export const Button = ({
  variant = "primary",
  size = "default",
  ...props
}: Omit<React.ComponentProps<typeof UiButton>, "variant" | "size"> & {
  variant?: ButtonVariant;
  size?: "sm" | "default" | "lg" | "icon";
}) => <UiButton variant={variant === "primary" ? "default" : variant} size={size} {...props} />;

/** A nav/filter pill (panel-specific — no shadcn nav-pill equivalent). */
export const Pill = ({ label, active }: { label: string; active?: boolean }) => (
  <span className={active ? "pill active" : "pill"}>{label}</span>
);

/** A projection-status badge (`indexed` / `skipped` / `pending` / `orphaned`) — keeps its
 *  semantic colors (the shared Badge has no green/amber variant). */
export const TierBadge = ({ status }: { status: string }) => <span className={`tier ${status}`}>{status}</span>;

type DotState = "ok" | "fail" | "never" | "muted";

export const Dot = ({ state }: { state: DotState }) => <span className={`dot ${state}`} />;

/** The shared Badge with the SSR kit's string-variant vocabulary. */
export const Badge = ({
  variant = "default",
  children,
  testId,
}: {
  variant?: string;
  children?: Child;
  /** Optional harness hook (rendered as data-testid). */
  testId?: string;
}) => (
  <UiBadge
    variant={
      variant === "secondary" || variant === "destructive" || variant === "outline" ? variant : "default"
    }
    data-testid={testId}
  >
    {children}
  </UiBadge>
);

/** An icon-only trash-can remove button (low-emphasis, reddens on hover). */
export const RemoveButton = ({ onClick, disabled }: { onClick?: () => void; disabled?: boolean }) => (
  <button type="button" className="cfg-remove" aria-label="Remove" disabled={disabled} onClick={onClick}>
    <TrashIcon size={14} />
  </button>
);

/** A destructive alert (the panel's inline error banner) — the shared Alert primitive. */
export const ErrorBanner = ({ message }: { message: string }) => (
  <Alert variant="destructive" className="my-3">
    <AlertDescription>{message}</AlertDescription>
  </Alert>
);

/** A labelled text input (shared Label + Input primitives). */
export const Field = ({
  label,
  name,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  name: string;
  value?: string;
  placeholder?: string;
  onChange?: (v: string) => void;
}) => (
  <div className="grid gap-2">
    <Label htmlFor={name}>{label}</Label>
    <Input
      type="text"
      id={name}
      name={name}
      value={value ?? ""}
      placeholder={placeholder ?? ""}
      onChange={onChange ? (e) => onChange(e.currentTarget.value) : undefined}
      readOnly={!onChange}
    />
  </div>
);

/** A vertical list container for `Item` rows. */
export const ItemGroup = ({ className, children }: { className?: string; children?: Child }) => (
  <div className={cn("item-group", className)}>{children}</div>
);

/** A list row with media / title / description / actions slots plus optional sub-content. */
export const Item = ({
  media,
  title,
  description,
  actions,
  outline,
  className,
  children,
}: {
  media?: Child;
  title?: Child;
  description?: Child;
  actions?: Child;
  outline?: boolean;
  className?: string;
  children?: Child;
}) => (
  <div className={cn("item", outline && "item-outline", className)}>
    {media != null ? <figure className="item-media">{media}</figure> : null}
    <section className="item-body">
      {title != null ? <div className="item-title">{title}</div> : null}
      {description != null ? <div className="item-desc">{description}</div> : null}
      {children}
    </section>
    {actions != null ? <aside className="item-actions">{actions}</aside> : null}
  </div>
);

/** A circular initials avatar. `lg` is the roster size. */
export const Avatar = ({ fallback, size }: { fallback: string; size?: "lg" }) => (
  <figure className={cn("avatar", size === "lg" && "avatar-lg")} aria-hidden="true">
    {fallback}
  </figure>
);

/** The page-level stat-tile grid (4-up, responsive). */
export const StatCardGrid = ({ children }: { children?: Child }) => <div className="stat-grid">{children}</div>;

/** One stat tile: icon + uppercase label and a large value, with an optional sub-line. */
export const StatCard = ({
  icon,
  label,
  value,
  sub,
  href,
  onNavigate,
  tone,
}: {
  icon?: Child;
  label: string;
  value: Child;
  sub?: Child;
  /** When given, the whole tile is a link (client-side navigation via `onNavigate`). */
  href?: string;
  onNavigate?: () => void;
  tone?: "warn" | "bad";
}) => {
  const toneClass = tone === "warn" ? " stat-warn" : tone === "bad" ? " stat-bad" : "";
  const body = (
    <>
      <div className="stat-top">
        {icon != null ? <span className="stat-ico">{icon}</span> : null}
        <span className="stat-label">{label}</span>
      </div>
      <div className="stat-value">{value}</div>
      {sub != null ? <div className="stat-sub">{sub}</div> : null}
    </>
  );
  return href != null ? (
    <a
      className={`stat-card stat-card-link${toneClass}`}
      href={href}
      onClick={
        onNavigate
          ? (e) => {
              e.preventDefault();
              onNavigate();
            }
          : undefined
      }
    >
      {body}
    </a>
  ) : (
    <div className={`stat-card${toneClass}`}>{body}</div>
  );
};

/** A prev / info / next pager row. The prev/next slots are caller-supplied buttons/links. */
export const Pager = ({ info, prev, next }: { info: Child; prev?: Child; next?: Child }) => (
  <div className="pager">
    {prev ?? <span />}
    <span className="pager-info muted small">{info}</span>
    {next ?? <span />}
  </div>
);

/** A bottom-aligned bar sparkline. Heights are scaled to `max` (or the series max). */
export const Sparkline = ({ values, max }: { values: number[]; max?: number }) => {
  const m = Math.max(1, max ?? 0, ...values);
  return (
    <div className="spark">
      {values.map((v, i) => (
        <span key={i} className="spark-bar" style={{ height: `${Math.max(8, Math.round((v / m) * 100))}%` }} />
      ))}
    </div>
  );
};

// ── Sparkline hover-tooltip ─────────────────────────────────────────────────────────────
// One shared, fixed-positioned `.bar-tip` bubble driven by document-level event delegation
// over `[data-tip-title]` segments (the SSR panel's progressive-enhancement script, made a
// root-layout effect). Delegation means newly-rendered segments need no wiring.

const TIP_SELECTOR = "[data-tip-title], [data-tip-body]";

/** Mount once in the root layout: delegates hover on every tip-bearing segment on the page. */
export function useSparklineTips(): void {
  React.useEffect(() => {
    const tip = document.createElement("div");
    tip.id = "spark-bar-tip";
    tip.className = "bar-tip";
    tip.setAttribute("role", "tooltip");
    tip.hidden = true;
    document.body.appendChild(tip);

    const onOver = (e: MouseEvent) => {
      const target = (e.target as HTMLElement | null)?.closest?.(TIP_SELECTOR) as HTMLElement | null;
      if (!target) return;
      const title = target.dataset.tipTitle;
      const body = target.dataset.tipBody;
      const variant = target.dataset.tipVariant;
      tip.className = variant ? `bar-tip ${variant}` : "bar-tip";
      tip.replaceChildren();
      if (title) {
        const t = document.createElement("div");
        t.className = "bar-tip-title";
        t.textContent = title;
        tip.appendChild(t);
      }
      if (body) {
        const b = document.createElement("div");
        b.className = "bar-tip-body";
        b.textContent = body;
        tip.appendChild(b);
      }
      const r = target.getBoundingClientRect();
      const x = Math.max(96, Math.min(window.innerWidth - 96, r.left + r.width / 2));
      tip.style.left = `${x}px`;
      tip.style.top = `${r.top}px`;
      tip.hidden = false;
    };
    const onOut = (e: MouseEvent) => {
      const target = (e.target as HTMLElement | null)?.closest?.(TIP_SELECTOR);
      if (target) tip.hidden = true;
    };
    document.addEventListener("mouseover", onOver);
    document.addEventListener("mouseout", onOut);
    return () => {
      document.removeEventListener("mouseover", onOver);
      document.removeEventListener("mouseout", onOut);
      tip.remove();
    };
  }, []);
}

/** One sparkline segment's tip content + the segment's own render. */
export interface TipSegment {
  /** The segment's fractional value (0–1) driving its height; already scaled by the caller. */
  frac: number;
  /** A CSS class suffix appended to the segment (e.g. "ok"/"fail"). */
  state?: string;
  tipTitle?: string;
  tipBody?: string;
  /** Selects the `.bar-tip.fail` destructive tooltip skin. */
  tipVariant?: "fail";
  href?: string;
  onNavigate?: () => void;
  ariaLabel?: string;
}

/** A full-width track of tip-bearing segments; `slots` ghost-pads the older (left) side so
 *  the newest segment stays anchored at the NOW edge. `axis` adds the OLDER/NOW caption. */
export const SparklineTrack = ({
  segments,
  axis,
  slots,
  className,
}: {
  segments: TipSegment[];
  axis?: boolean;
  slots?: number;
  className?: string;
}) => {
  const ghostCount = slots != null ? Math.max(0, slots - segments.length) : 0;
  return (
    <div className={cn("spark-track-wrap", className)}>
      <div className="spark-track">
        {Array.from({ length: ghostCount }, (_, i) => (
          <span key={`g${i}`} className="spark-seg-tip ghost" aria-hidden="true" />
        ))}
        {segments.map((s, i) => {
          const body = (
            <span
              className={cn("spark-seg-tip", s.state)}
              style={{ height: `${Math.max(8, Math.round(s.frac * 100))}%` }}
              data-tip-title={s.tipTitle}
              data-tip-body={s.tipBody}
              data-tip-variant={s.tipVariant}
              aria-label={s.ariaLabel}
            />
          );
          return s.href != null ? (
            <a
              key={i}
              className="spark-seg-link"
              href={s.href}
              onClick={
                s.onNavigate
                  ? (e) => {
                      e.preventDefault();
                      s.onNavigate!();
                    }
                  : undefined
              }
            >
              {body}
            </a>
          ) : (
            <React.Fragment key={i}>{body}</React.Fragment>
          );
        })}
      </div>
      {axis ? (
        <div className="spark-axis">
          <span>OLDER</span>
          <span>NOW</span>
        </div>
      ) : null}
    </div>
  );
};

/** A determinate progress bar (0–100) in the panel's meter vocabulary. */
export const Progress = ({ value }: { value: number }) => {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="progress" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
};

/** The panel's on/off switch (checkbox-backed; the caller reads `onChange`). */
export const Switch = ({
  name,
  checked,
  onChange,
}: {
  name?: string;
  checked?: boolean;
  onChange?: (checked: boolean) => void;
}) => (
  <label className="switch">
    <input
      type="checkbox"
      name={name}
      checked={checked ?? false}
      onChange={onChange ? (e) => onChange(e.currentTarget.checked) : undefined}
      readOnly={!onChange}
    />
    <span className="switch-track" />
  </label>
);

/** The `--slider-value` percent driving the range track's filled portion. */
export function sliderFillPct(min: number, max: number, value: number): number {
  if (max <= min) return 0;
  return Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
}

/** A range slider input with the panel's gradient-filled track. */
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
  onInput?: (value: number) => void;
}) => (
  <input
    className="input slider"
    type="range"
    name={name}
    min={min}
    max={max}
    step={step ?? 1}
    value={value}
    style={{ "--slider-value": `${sliderFillPct(min, max, value)}%` } as React.CSSProperties}
    onChange={onInput ? (e) => onInput(Number(e.currentTarget.value)) : undefined}
    readOnly={!onInput}
  />
);

/** A knob's static spec (the calibration consoles' shared shape — see the SSR kit). */
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

/** A column spec for `DataTable`: a key, a header label, and an optional right alignment. */
export interface Column {
  key: string;
  label: string;
  align?: "right";
}

function colOf(c: string | Column): Column {
  return typeof c === "string" ? { key: c, label: c } : c;
}

/** A column-spec data table over the shared Table primitive's markup (plain table elements —
 *  the harness's row lookup keys on `tr`). Rows are a `key → cell` map. */
export const DataTable = ({ columns, rows }: { columns: (string | Column)[]; rows: Record<string, Child>[] }) => (
  <table className="table w-full caption-bottom text-sm">
    <thead className="[&_tr]:border-b">
      <tr>
        {columns.map((c) => {
          const col = colOf(c);
          return (
            <th
              key={col.key}
              className="text-foreground h-10 px-2 text-left align-middle font-medium whitespace-nowrap"
              style={col.align === "right" ? { textAlign: "right" } : undefined}
            >
              {col.label}
            </th>
          );
        })}
      </tr>
    </thead>
    <tbody className="[&_tr:last-child]:border-0">
      {rows.map((r, i) => (
        <tr key={i} className="border-b">
          {columns.map((c) => {
            const col = colOf(c);
            return (
              <td key={col.key} className="p-2 align-middle" style={col.align === "right" ? { textAlign: "right" } : undefined}>
                {r[col.key]}
              </td>
            );
          })}
        </tr>
      ))}
    </tbody>
  </table>
);

// ── PrettyKV: a readable key/value renderer for structured records. Arrays render as chips,
// null as an em-dash, http(s) strings as links, nested objects recurse.

function prettyValue(v: unknown): Child {
  if (v === null || v === undefined) return <span className="pv-null">—</span>;
  if (typeof v === "boolean") return <span className="pv-bool">{String(v)}</span>;
  if (typeof v === "number") return <span className="pv-num">{v.toLocaleString()}</span>;
  if (Array.isArray(v)) {
    return v.length ? (
      <span className="pv-chips">
        {v.map((x, i) => (
          <span key={i} className="pv-chip">
            {typeof x === "object" && x !== null ? JSON.stringify(x) : String(x)}
          </span>
        ))}
      </span>
    ) : (
      <span className="pv-null">empty</span>
    );
  }
  if (typeof v === "object") return <PrettyKV obj={v as Record<string, unknown>} nested />;
  if (typeof v === "string" && /^https?:\/\//.test(v)) {
    return (
      <a className="pv-link" href={v} target="_blank" rel="noreferrer">
        {v}
      </a>
    );
  }
  return <span className="pv-str">{String(v)}</span>;
}

/** A plain object rendered as a readable key/value table. */
export const PrettyKV = ({ obj, nested }: { obj: Record<string, unknown> | null | undefined; nested?: boolean }) => {
  const entries = Object.entries(obj ?? {});
  if (entries.length === 0)
    return (
      <p className="muted" style={{ margin: 0 }}>
        (empty)
      </p>
    );
  return (
    <div className={cn("pkv", nested && "pkv-nested")}>
      {entries.map(([k, v]) => (
        <div key={k} className="pkv-row">
          <span className="pkv-k">{k}</span>
          <span className="pkv-v">{prettyValue(v)}</span>
        </div>
      ))}
    </div>
  );
};

/** A job/candidate-property pill: `label:value` as a small rounded badge. */
export const StatPill = ({ label, value }: { label: string; value: Child }) => (
  <span className="jstat">
    <span className="jstat-k">{label}</span>
    <span className="jstat-v">{value}</span>
  </span>
);

// ── StageTrack: a generic stage-progression track (done / halt / todo vs `haltIndex`). ──

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
  pushedAcquireIndex,
}: {
  stages: StageSpec[];
  haltIndex: number;
  kind: string;
  imported?: boolean;
  pushedAcquireIndex?: number | null;
}) => (
  <div className="pl-track" role="list" aria-label="pipeline progression">
    {stages.map((s, i) => {
      const isHalt = i === haltIndex && !imported;
      const done = i < haltIndex || (i === haltIndex && imported);
      const isPush = pushedAcquireIndex != null && i === pushedAcquireIndex && done;
      const state = done ? "done" : isHalt ? kind : "todo";
      return (
        <div key={s.key} className={cn("pl-stage", state, isHalt && "halt", isPush && "push")} role="listitem">
          <div className="pl-node">
            {isPush ? (
              <InboxIcon size={15} />
            ) : done ? (
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
          <span className="pl-label">{s.label}</span>
          {i < stages.length - 1 ? <span className={cn("pl-seg", i < haltIndex ? "done" : "todo")} /> : null}
        </div>
      );
    })}
  </div>
);
