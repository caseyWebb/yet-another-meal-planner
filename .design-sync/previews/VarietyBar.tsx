import { VarietyBar } from "@yamp/ui";

export function Default() {
  return (
    <div style={{ maxWidth: 640 }}>
      <VarietyBar
        nights={5}
        cuisines={3}
        proteins={4}
        proteinHist={[
          ["Chicken", 2],
          ["Salmon", 1],
          ["Beef", 1],
          ["Tofu", 1],
        ]}
        onCommit={() => {}}
      />
    </div>
  );
}
