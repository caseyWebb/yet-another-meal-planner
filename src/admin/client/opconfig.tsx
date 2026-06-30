// The operator-config form island (operator-admin) — shared by the Ranking and Flyer Config
// sub-views. A simple load → edit → save form over the SSR-seeded OperatorConfig: the field set
// (which keys, labels, steps) rides in the props, so one island serves both. A `pct` field is
// shown as a percentage but stored as a fraction. PUT validates server-side; on a range error the
// message renders. The save lifecycle is ONE discriminated union (clean | dirty | saved | error),
// so "is there an error", "did it just save", and "can I save" cannot contradict.

import { render, useState } from "hono/jsx/dom";
import { hc } from "hono/client";
import type { AdminApp } from "../app.js";
import type { OperatorConfig } from "../../operator-config.js";

const client = hc<AdminApp>(location.origin);

interface FieldDesc {
  key: string;
  label: string;
  step: string;
  pct?: boolean;
}

// clean (matches the saved config) → dirty (edited) → saved (PUT ok) or error (PUT failed, still
// effectively dirty). One union so the status flags can't disagree (admin/CLAUDE.md discipline).
type SaveState =
  | { t: "clean" }
  | { t: "dirty" }
  | { t: "saved" }
  | { t: "error"; message: string };

function shown(config: OperatorConfig, f: FieldDesc): string {
  const v = (config as unknown as Record<string, number>)[f.key];
  return String(f.pct ? Math.round(v * 100) : v);
}

function OpConfigIsland({ config, fields }: { config: OperatorConfig; fields: FieldDesc[] }) {
  const initial: Record<string, string> = {};
  for (const f of fields) initial[f.key] = shown(config, f);

  const [draft, setDraft] = useState<Record<string, string>>(initial);
  const [state, setState] = useState<SaveState>({ t: "clean" });

  const canSave = state.t === "dirty" || state.t === "error";

  function onField(key: string, value: string): void {
    setDraft({ ...draft, [key]: value });
    setState({ t: "dirty" });
  }

  async function save(): Promise<void> {
    const patch: Record<string, number> = {};
    for (const f of fields) {
      const n = Number(draft[f.key]);
      if (Number.isFinite(n)) patch[f.key] = f.pct ? n / 100 : n;
    }
    const res = await client.admin.api["operator-config"].$put({ json: patch });
    if (res.ok) {
      setState({ t: "saved" });
    } else {
      const b = (await res.json().catch(() => null)) as { message?: string } | null;
      setState({ t: "error", message: b?.message ?? `HTTP ${res.status}` });
    }
  }

  return (
    <div class="card">
      <section class="grid gap-4">
        {state.t === "error" ? (
          <div class="alert" data-variant="destructive">
            <section>{state.message}</section>
          </div>
        ) : null}
        {fields.map((f) => (
          <div class="grid gap-2">
            <label class="label" for={f.key}>
              {f.label}
            </label>
            <input
              class="input"
              id={f.key}
              type="number"
              step={f.step}
              value={draft[f.key]}
              onInput={(e: Event) => onField(f.key, (e.target as HTMLInputElement).value)}
            />
          </div>
        ))}
        <div class="form-actions">
          <button class="btn" data-size="sm" disabled={!canSave} onClick={save}>
            Save
          </button>
          {state.t === "saved" ? <span class="muted small">Saved.</span> : null}
        </div>
      </section>
    </div>
  );
}

const host = document.getElementById("config-island");
const propsEl = document.getElementById("config-props");
if (host && propsEl) {
  const props = JSON.parse(propsEl.textContent ?? "{}") as { config: OperatorConfig; fields: FieldDesc[] };
  host.replaceChildren();
  render(<OpConfigIsland config={props.config} fields={props.fields} />, host);
}
