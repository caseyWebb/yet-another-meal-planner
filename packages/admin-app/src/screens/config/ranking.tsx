// Config › Ranking — the ranking-weights knob console only (ported from the SSR
// pages/config.tsx RankingGroupPage). The five ranking weights carry no `floor` (no
// safe-floor concept — operator-config.ts's Decision 2 rationale), so their KnobRow never
// renders the below-floor warning and the console can never enter NeedsConfirm.

import type { KnobSpec } from "../../components/kit";
import { ConfigShell, Section } from "./shell";
import { OperatorKnobConsole } from "./op-console";

const RANKING_KNOBS: KnobSpec[] = [
  { key: "favoriteWeight", label: "favorite weight", step: 0.05, min: 0, max: 2, help: "How strongly a recipe's similarity to a member's favorites lifts its rank." },
  { key: "noveltyBoost", label: "novelty boost", step: 0.05, min: 0, max: 2, help: "Lift for dishes unlike what's been suggested recently — keeps the plan fresh." },
  { key: "pantryWeight", label: "pantry weight", step: 0.05, min: 0, max: 2, help: "Reward for recipes that use what's already in the member's pantry." },
  { key: "perishWeight", label: "perishable weight", step: 0.5, min: 0, max: 10, help: "Urgency multiplier for using soon-to-expire perishables first." },
  { key: "keyWeight", label: "key-ingredient weight", step: 0.5, min: 0, max: 10, help: "Reward for hitting a recipe's defining ingredient when it's on sale / in pantry." },
  { key: "overlapCap", label: "overlap cap", step: 1, min: 1, max: 20, help: "Max recipes in a plan that may share a key ingredient — caps repetition." },
];

export function ConfigRankingScreen() {
  return (
    <ConfigShell>
      <Section
        title="Ranking weights"
        blurb="Group-default weights for the recipe ranker. Per-member profile rotation overrides layer on top of these."
      >
        <OperatorKnobConsole knobs={RANKING_KNOBS} />
      </Section>
    </ConfigShell>
  );
}
