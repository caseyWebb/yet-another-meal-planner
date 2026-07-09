import { NudgeBar } from "@yamp/ui";

export function Default() {
  return (
    <div style={{ maxWidth: 560 }}>
      <NudgeBar
        variety={0.5}
        onVariety={() => {}}
        proteins={["Chicken", "Beef", "Salmon", "Tofu"]}
        proteinWants={["Salmon"]}
        onToggleProtein={() => {}}
        freeform="lighter dinners, use up the salmon"
        onFreeform={() => {}}
      />
    </div>
  );
}
