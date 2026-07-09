import { ToggleChip } from "@yamp/ui";

export function Proteins() {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      <ToggleChip on onToggle={() => {}}>
        Chicken
      </ToggleChip>
      <ToggleChip on onToggle={() => {}}>
        Salmon
      </ToggleChip>
      <ToggleChip on={false} onToggle={() => {}}>
        Beef
      </ToggleChip>
      <ToggleChip on={false} onToggle={() => {}}>
        Tofu
      </ToggleChip>
    </div>
  );
}

export function On() {
  return (
    <ToggleChip on onToggle={() => {}}>
      Mediterranean
    </ToggleChip>
  );
}

export function Off() {
  return (
    <ToggleChip on={false} onToggle={() => {}}>
      Italian
    </ToggleChip>
  );
}
