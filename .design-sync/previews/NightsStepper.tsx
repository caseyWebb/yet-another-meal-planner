import { NightsStepper } from "@yamp/ui";

export function FourNights() {
  return (
    <div style={{ maxWidth: 240 }}>
      <NightsStepper value={4} min={2} max={6} onChange={() => {}} />
    </div>
  );
}

export function AtMinimum() {
  return (
    <div style={{ maxWidth: 240 }}>
      <NightsStepper value={2} min={2} max={6} onChange={() => {}} />
    </div>
  );
}
