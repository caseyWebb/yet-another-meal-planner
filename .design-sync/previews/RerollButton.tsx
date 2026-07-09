import { RerollButton } from "@yamp/ui";

export function Enabled() {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
      <RerollButton onClick={() => {}} />
    </div>
  );
}

export function Disabled() {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
      <RerollButton onClick={() => {}} disabled />
    </div>
  );
}
