// The operator-config knob console island (operator-admin) — shared by the Ranking and
// Kroger Flyer Config groups. Consumes the shared KnobConsole (client/knob-console.tsx), so
// both groups get the identical Clean|Dirty|NeedsConfirm state machine Discovery's
// calibration console already had: Save is disabled until dirty, and a below-floor value
// (flyerRefreshHours/flyerBatchUnits — the only two operator-config knobs with a real safe
// floor; the five ranking weights are intentionally floor-free, see operator-config.ts)
// surfaces a destructive "Confirm & save" gate before the write carries `confirm:true`.

import { render, useState } from "hono/jsx/dom";
import { hc } from "hono/client";
import type { AdminApp } from "../app.js";
import type { KnobSpec } from "../ui/kit.js";
import { KnobConsole, floorWarningFromResponse } from "./knob-console.js";
import type { OperatorConfig } from "../../operator-config.js";

const client = hc<AdminApp>(location.origin);

function OpConfigIsland({ config, knobs }: { config: OperatorConfig; knobs: KnobSpec[] }) {
  const [saved, setSaved] = useState<Record<string, number>>(config as unknown as Record<string, number>);

  async function save(patch: Record<string, number>, confirm: boolean) {
    const res = await client.admin.api["operator-config"].$put({ json: { ...patch, confirm } });
    if (res.ok) {
      const cfg = (await res.json()).config as unknown as Record<string, number>;
      return { ok: true as const, config: cfg };
    }
    const warning = await floorWarningFromResponse(res);
    return { ok: false as const, warning };
  }

  return (
    <div class="card">
      <section>
        <KnobConsole knobs={knobs} saved={saved} onSaved={setSaved} save={save} />
      </section>
    </div>
  );
}

const host = document.getElementById("config-island");
const propsEl = document.getElementById("config-props");
if (host && propsEl) {
  const props = JSON.parse(propsEl.textContent ?? "{}") as { config: OperatorConfig; knobs: KnobSpec[] };
  host.replaceChildren();
  render(<OpConfigIsland config={props.config} knobs={props.knobs} />, host);
}
