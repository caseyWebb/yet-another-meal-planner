// The operator-config form island (operator-admin) — shared by the Ranking and Flyer Config
// sub-views. A simple load → edit → save form over the SSR-seeded OperatorConfig: the field set
// (which keys, labels, steps) rides in the props, so one island serves both. A `pct` field is
// shown as a percentage but stored as a fraction. PUT validates server-side; on a range error the
// message renders. Dirty/clean is a single flag (no in-flight overlap — one mutation per save).

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

function shown(config: OperatorConfig, f: FieldDesc): string {
  const v = (config as unknown as Record<string, number>)[f.key];
  return String(f.pct ? Math.round(v * 100) : v);
}

function OpConfigIsland({ config, fields }: { config: OperatorConfig; fields: FieldDesc[] }) {
  const initial: Record<string, string> = {};
  for (const f of fields) initial[f.key] = shown(config, f);

  const [draft, setDraft] = useState<Record<string, string>>(initial);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState(false);

  function onField(key: string, value: string): void {
    setDraft({ ...draft, [key]: value });
    setDirty(true);
    setSavedAt(false);
  }

  async function save(): Promise<void> {
    const patch: Record<string, number> = {};
    for (const f of fields) {
      const n = Number(draft[f.key]);
      if (Number.isFinite(n)) patch[f.key] = f.pct ? n / 100 : n;
    }
    const res = await client.admin.api["operator-config"].$put({ json: patch });
    if (res.ok) {
      setDirty(false);
      setError(null);
      setSavedAt(true);
    } else {
      const b = (await res.json().catch(() => null)) as { message?: string } | null;
      setError(b?.message ?? `HTTP ${res.status}`);
    }
  }

  return (
    <div class="card">
      {error ? <div class="error">{error}</div> : null}
      {fields.map((f) => (
        <label>
          {f.label}
          <input
            type="number"
            step={f.step}
            value={draft[f.key]}
            onInput={(e: Event) => onField(f.key, (e.target as HTMLInputElement).value)}
          />
        </label>
      ))}
      <div class="form-actions">
        <button disabled={!dirty} onClick={save}>
          Save
        </button>
        {savedAt ? <span class="muted small">Saved.</span> : null}
      </div>
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
