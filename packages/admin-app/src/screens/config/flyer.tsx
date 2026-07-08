// Config › Kroger Flyer — the flyer knob console (the shared operator-config console) +
// the flyer-terms corpus editor (ported from the SSR pages/config.tsx FlyerGroupPage).
// Floor annotations mirror operator-config.ts's FLOOR_FLYER_REFRESH_HOURS /
// FLOOR_FLYER_BATCH_UNITS exactly.

import type { KnobSpec } from "../../components/kit";
import { ConfigShell, Section } from "./shell";
import { OperatorKnobConsole } from "./op-console";
import { CorpusEditor, type TableConfig } from "./corpus-editor";

const FLYER_KNOBS: KnobSpec[] = [
  { key: "minFlyerDiscount", label: "min flyer discount", step: 0.01, min: 0, max: 1, pct: true, help: "Ignore flyer items discounted less than this — filters noise from token markdowns." },
  { key: "flyerRefreshHours", label: "flyer refresh (hours)", step: 1, min: 1, max: 720, floor: 6, help: "How often the warm re-pulls the weekly flyer per store." },
  { key: "flyerBatchUnits", label: "flyer batch units", step: 1, min: 1, max: 200, floor: 4, help: "Items embedded per warm batch — bounds the per-tick embedding cost." },
];

const FLYER_TERMS_EDITOR: TableConfig = {
  slug: "flyer-terms",
  pkColumn: "term",
  addFields: [{ key: "term", label: "term", kind: "text", required: true }],
};

export function ConfigFlyerScreen() {
  return (
    <ConfigShell>
      <Section title="Flyer behaviour" blurb="How the Kroger flyer warm selects and batches deals.">
        <OperatorKnobConsole knobs={FLYER_KNOBS} />
      </Section>
      <Section
        title="Flyer terms"
        blurb="Search terms the flyer warm tracks for deals. The agent adds via its tools; prune noise here."
      >
        <CorpusEditor config={FLYER_TERMS_EDITOR} />
      </Section>
    </ConfigShell>
  );
}
