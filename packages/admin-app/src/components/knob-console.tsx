// The shared knob-console state machine (ported from the SSR panel's client/knob-console.tsx)
// — Discovery, Ranking, AND Flyer share ONE implementation of the Clean|Dirty|NeedsConfirm
// gate. `KnobRow` is the interactive per-knob row (label + numeric input + Slider +
// help/floor-warning text); `KnobConsole` composes a `knobs: KnobSpec[]` grid with the
// Save/Discard/Confirm-and-save button row over a caller-supplied `save(patch, confirm)` —
// a below-floor Save leaves it to the caller to detect (via the server's structured
// `needsConfirm` error) and return the warning so the console re-renders in the
// `needsConfirm` state; a client-only pre-check (`clientFloorBreach`) additionally surfaces
// the confirm gate immediately, without waiting on a round trip.

import * as React from "react";
import { Input, Label } from "@grocery-agent/ui";
import { Button, ErrorBanner, Slider, type KnobSpec } from "./kit";

export type Draft = Record<string, string>;

export interface FloorWarning {
  field: string;
  message: string;
}

/** The one state union every knob console (Discovery, Ranking, Flyer) shares — Save is
 *  disabled unless dirty; a below-floor Save surfaces `needsConfirm` in place of a plain
 *  Save, requiring explicit "Confirm & save" before the write carries `confirm:true`. */
export type FormState =
  | { t: "clean" }
  | { t: "dirty"; draft: Draft }
  | { t: "needsConfirm"; draft: Draft; warning: FloorWarning };

export function toDraft(knobs: KnobSpec[], config: Record<string, number>): Draft {
  const d: Draft = {};
  for (const k of knobs) {
    const v = config[k.key];
    d[k.key] = String(k.pct ? Math.round(v * 100) : v);
  }
  return d;
}

export function toPatch(knobs: KnobSpec[], draft: Draft): Record<string, number> {
  const patch: Record<string, number> = {};
  for (const k of knobs) {
    const n = Number(draft[k.key]);
    if (!Number.isFinite(n)) continue;
    patch[k.key] = k.pct ? n / 100 : n;
  }
  return patch;
}

/** A client-side pre-check mirroring the server's floor gate, so a below-floor value
 *  surfaces "Confirm & save" immediately on click, without waiting on the PUT round trip.
 *  A knob with no `floor` (e.g. every Ranking weight) can never trigger this — `below` is
 *  structurally unreachable when `floor` is undefined. */
export function clientFloorBreach(knobs: KnobSpec[], patch: Record<string, number>): FloorWarning | null {
  for (const k of knobs) {
    if (k.floor === undefined) continue;
    const v = patch[k.key];
    if (v === undefined) continue;
    if (v <= k.floor) {
      const shown = k.pct ? `${Math.round(k.floor * 100)}%` : String(k.floor);
      return { field: k.key, message: `${k.label} is below its safe floor (${shown}). Saving may degrade the pipeline.` };
    }
  }
  return null;
}

/** Parse a structured `needsConfirm` error body (the Worker's `ToolError.toShape()` spreads
 *  its context at the TOP level: `{ error, message, field, needsConfirm }` — the nested
 *  `detail` shape is also accepted for compatibility with the SSR island's parser). */
export function floorWarningOf(body: unknown): FloorWarning | null {
  const b = body as
    | { message?: string; field?: string; needsConfirm?: boolean; detail?: { field?: string; needsConfirm?: boolean } }
    | null;
  if (b?.needsConfirm) return { field: b.field ?? "", message: b.message ?? "Below the safe floor." };
  if (b?.detail?.needsConfirm) return { field: b.detail.field ?? "", message: b.message ?? "Below the safe floor." };
  return null;
}

/** Classify a failed config PUT: a structured needsConfirm body resolves to its
 *  FloorWarning; anything else throws carrying the structured ApiError shape (so it lands
 *  in the caller's mutation error state, typed — the `apiErrorOf` convention). */
export async function floorWarningOrThrow(res: { status: number; json(): Promise<unknown> }): Promise<FloorWarning> {
  const body = await (res.json() as Promise<unknown>).catch(() => null);
  const warning = floorWarningOf(body);
  if (warning) return warning;
  const b = body as { error?: string; message?: string } | null;
  const err =
    typeof b?.error === "string"
      ? { error: b.error, message: b.message ?? "" }
      : { error: "internal", message: `Request failed (${res.status})` };
  throw Object.assign(new Error(err.message || err.error), { api: err });
}

/** One knob row: label + numeric input + slider + help/floor-warning text. */
export function KnobRow({
  knob,
  draft,
  onChange,
}: {
  knob: KnobSpec;
  draft: Draft;
  onChange: (key: string, value: string) => void;
}) {
  const raw = Number(draft[knob.key]);
  const rawValue = knob.pct ? raw / 100 : raw;
  const below = knob.floor !== undefined && Number.isFinite(rawValue) && rawValue <= knob.floor;
  return (
    <div className={below ? "knob below" : "knob"}>
      <div className="knob-head">
        <Label className="knob-label" htmlFor={`k-${knob.key}`}>
          {knob.label}
        </Label>
        <div className="knob-value">
          <Input
            className="knob-input"
            id={`k-${knob.key}`}
            type="number"
            step={knob.pct ? 1 : knob.step}
            value={draft[knob.key] ?? ""}
            onChange={(e) => onChange(knob.key, e.currentTarget.value)}
          />
          {knob.pct ? <span className="knob-unit">%</span> : null}
        </div>
      </div>
      <Slider
        min={knob.min}
        max={knob.max}
        step={knob.step}
        value={Number.isFinite(raw) ? raw : knob.min}
        onInput={(value) => onChange(knob.key, String(value))}
      />
      {knob.help || below ? (
        <p className="knob-help muted small">
          {knob.help}
          {below ? (
            <span className="knob-floor">
              {" "}
              · below safe floor ({knob.pct ? `${Math.round((knob.floor as number) * 100)}%` : knob.floor})
            </span>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The Clean|Dirty|NeedsConfirm knob console: a grid of `KnobRow`s + the Save/Discard/
 * Confirm-and-save action row. `save(patch, confirm)` is the caller's PUT wiring (a
 * useMutation's mutateAsync) — on success it should update the caller's `saved` baseline
 * (the console calls `onSaved`); on a structured needsConfirm failure it should RESOLVE with
 * the `FloorWarning` so the console can surface it. Any other failure may reject — the
 * console swallows the rejection and stays dirty, leaving the caller's mutation error state
 * to render the banner.
 */
export function KnobConsole({
  knobs,
  saved,
  onSaved,
  save,
  saving,
  children,
}: {
  knobs: KnobSpec[];
  /** The last-saved config (raw units), from which the clean draft is derived. */
  saved: Record<string, number>;
  /** Called with the newly-saved config after a successful write. */
  onSaved: (config: Record<string, number>) => void;
  /** Perform the write; resolve with the saved config on success, or a FloorWarning on a
   *  needsConfirm rejection. */
  save: (
    patch: Record<string, number>,
    confirm: boolean,
  ) => Promise<{ ok: true; config: Record<string, number> } | { ok: false; warning: FloorWarning | null }>;
  /** The caller's write-in-flight flag (mutation.isPending) — gates the action buttons. */
  saving?: boolean;
  /** Optional content rendered below the action row (e.g. Discovery's Analyze/Dry-run). */
  children?: (draft: Draft, dirty: boolean) => React.ReactNode;
}) {
  const [form, setForm] = React.useState<FormState>({ t: "clean" });

  const currentDraft = (): Draft => (form.t === "clean" ? toDraft(knobs, saved) : form.draft);

  function onField(key: string, value: string): void {
    setForm({ t: "dirty", draft: { ...currentDraft(), [key]: value } });
  }

  async function doSave(confirm: boolean): Promise<void> {
    const draft = currentDraft();
    const patch = toPatch(knobs, draft);
    if (!confirm) {
      const warning = clientFloorBreach(knobs, patch);
      if (warning) {
        setForm({ t: "needsConfirm", draft, warning });
        return;
      }
    }
    let result: Awaited<ReturnType<typeof save>>;
    try {
      result = await save(patch, confirm);
    } catch {
      // Non-needsConfirm failure: stay dirty; the caller's mutation error renders the banner.
      setForm({ t: "dirty", draft });
      return;
    }
    if (result.ok) {
      onSaved(result.config);
      setForm({ t: "clean" });
      return;
    }
    if (result.warning) setForm({ t: "needsConfirm", draft, warning: result.warning });
  }

  const draft = currentDraft();
  const dirty = form.t !== "clean";

  return (
    <div className="knob-console">
      <div className="knob-grid">
        {knobs.map((k) => (
          <KnobRow key={k.key} knob={k} draft={draft} onChange={onField} />
        ))}
      </div>

      {form.t === "needsConfirm" ? (
        <div className="grid gap-2 cfg-alert">
          <ErrorBanner message={form.warning.message} />
          <div className="form-actions cfg-actions">
            <Button variant="destructive" size="sm" disabled={saving} onClick={() => doSave(true)}>
              Confirm &amp; save
            </Button>
            <Button variant="ghost" size="sm" disabled={saving} onClick={() => setForm({ t: "dirty", draft: form.draft })}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="form-actions cfg-actions">
          <Button size="sm" disabled={!dirty || saving} onClick={() => doSave(false)}>
            {saving ? "Saving…" : "Save"}
          </Button>
          {dirty ? (
            <Button variant="ghost" size="sm" disabled={saving} onClick={() => setForm({ t: "clean" })}>
              Discard
            </Button>
          ) : null}
        </div>
      )}

      {children ? children(draft, dirty) : null}
    </div>
  );
}
