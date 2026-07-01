// The shared knob-console state machine (admin-ui-redesign-config) — extracted from
// calibration.tsx's original FormState union so Discovery, Ranking, AND Flyer share ONE
// implementation instead of Discovery having the Clean|Dirty|NeedsConfirm gate and
// Ranking/Flyer lacking it (design.md Decision 1). `KnobRow` is the interactive per-knob
// row (label + numeric input + Slider + help/floor-warning text) — genuinely stateful
// (an `onInput` handler), so it lives here rather than in kit.tsx's SSR-safe primitives;
// `KnobConsole` composes a `knobs: KnobSpec[]` grid with the Save/Discard/Confirm-and-save
// button row over a caller-supplied `save(patch, confirm)` — a below-floor Save leaves it to
// the caller to detect (via the server's structured `needsConfirm` error) and re-render in
// the `needsConfirm` state; a client-only pre-check (`clientFloorBreach`) additionally
// surfaces the confirm gate immediately, without waiting on a round trip, exactly as the
// mock's KnobConsole does.

import { useState } from "hono/jsx/dom";
import { Slider } from "../ui/kit.js";
import type { KnobSpec } from "../ui/kit.js";

export type Draft = Record<string, string>;

export interface FloorWarning {
  field: string;
  message: string;
}

/** The one state union every knob console (Discovery, Ranking, Flyer) shares — Save is
 *  disabled unless dirty; a below-floor Save surfaces `needsConfirm` in place of a plain
 *  Save, requiring explicit "Confirm & save" before the write carries `confirm:true`. */
export type FormState = { t: "clean" } | { t: "dirty"; draft: Draft } | { t: "needsConfirm"; draft: Draft; warning: FloorWarning };

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

/** Parse a structured `needsConfirm` error response (mirrors calibration.tsx's floorWarning). */
export async function floorWarningFromResponse(res: { json: () => Promise<unknown> }): Promise<FloorWarning | null> {
  const body = (await res.json().catch(() => null)) as
    | { message?: string; detail?: { field?: string; needsConfirm?: boolean } }
    | null;
  if (body?.detail?.needsConfirm) return { field: body.detail.field ?? "", message: body.message ?? "Below the safe floor." };
  return null;
}

/** One knob row: label + numeric input + slider + help/floor-warning text. Interactive
 *  (an `onInput` handler), so it lives in the client module rather than kit.tsx. */
export function KnobRow({ knob, draft, onChange }: { knob: KnobSpec; draft: Draft; onChange: (key: string, value: string) => void }) {
  const raw = Number(draft[knob.key]);
  const rawValue = knob.pct ? raw / 100 : raw;
  const below = knob.floor !== undefined && Number.isFinite(rawValue) && rawValue <= knob.floor;
  return (
    <div class={below ? "knob below" : "knob"}>
      <div class="knob-head">
        <label class="knob-label label" for={`k-${knob.key}`}>
          {knob.label}
        </label>
        <div class="knob-value">
          <input
            class="input knob-input"
            id={`k-${knob.key}`}
            type="number"
            step={knob.pct ? 1 : knob.step}
            value={draft[knob.key]}
            onInput={(e: Event) => onChange(knob.key, (e.target as HTMLInputElement).value)}
          />
          {knob.pct ? <span class="knob-unit">%</span> : null}
        </div>
      </div>
      <Slider
        min={knob.min}
        max={knob.max}
        step={knob.step}
        value={Number.isFinite(raw) ? raw : knob.min}
      />
      {knob.help || below ? (
        <p class="knob-help muted small">
          {knob.help}
          {below ? (
            <span class="knob-floor"> · below safe floor ({knob.pct ? Math.round((knob.floor as number) * 100) + "%" : knob.floor})</span>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The Clean|Dirty|NeedsConfirm knob console: a grid of `KnobRow`s + the Save/Discard/
 * Confirm-and-save action row. `save(patch, confirm)` is the caller's PUT wiring — on
 * success it should update the console's `saved` baseline via `onSaved`; on a structured
 * needsConfirm failure it should return the `FloorWarning` so the console can surface it
 * (mirrors calibration.tsx's `save()`, generalized over any knob set).
 */
export function KnobConsole({
  knobs,
  saved,
  onSaved,
  save,
  children,
}: {
  knobs: KnobSpec[];
  /** The last-saved config (raw units), from which the clean draft is derived. */
  saved: Record<string, number>;
  /** Called with the newly-saved config after a successful write. */
  onSaved: (config: Record<string, number>) => void;
  /** Perform the write; return the saved config on success, or a FloorWarning on a
   *  needsConfirm rejection (any other failure should throw/reject, left unhandled here —
   *  callers that want an error banner wrap this and setForm accordingly). */
  save: (patch: Record<string, number>, confirm: boolean) => Promise<{ ok: true; config: Record<string, number> } | { ok: false; warning: FloorWarning | null }>;
  /** Optional content rendered below the action row (e.g. Discovery's Analyze/Dry-run). */
  children?: (draft: Draft, dirty: boolean) => unknown;
}) {
  const [form, setForm] = useState<FormState>({ t: "clean" });

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
    const result = await save(patch, confirm);
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
    <div class="knob-console">
      <div class="knob-grid">
        {knobs.map((k) => (
          <KnobRow knob={k} draft={draft} onChange={onField} />
        ))}
      </div>

      {form.t === "needsConfirm" ? (
        <div class="grid gap-2 cfg-alert">
          <div class="alert" data-variant="destructive">
            <section>{form.warning.message}</section>
          </div>
          <div class="form-actions cfg-actions">
            <button class="btn" data-variant="destructive" data-size="sm" onClick={() => doSave(true)}>
              Confirm &amp; save
            </button>
            <button class="btn" data-variant="ghost" data-size="sm" onClick={() => setForm({ t: "dirty", draft: form.draft })}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div class="form-actions cfg-actions">
          <button class="btn" data-size="sm" disabled={!dirty} onClick={() => doSave(false)}>
            Save
          </button>
          {dirty ? (
            <button class="btn" data-variant="ghost" data-size="sm" onClick={() => setForm({ t: "clean" })}>
              Discard
            </button>
          ) : null}
        </div>
      )}

      {children ? children(draft, dirty) : null}
    </div>
  );
}
