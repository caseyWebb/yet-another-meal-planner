import { Slider } from "@yamp/ui";

export function Adventurousness() {
  return (
    <div style={{ maxWidth: 320 }}>
      <Slider defaultValue={[0.6]} min={0} max={1} step={0.1} aria-label="How adventurous" />
    </div>
  );
}

export function Nights() {
  return (
    <div style={{ maxWidth: 320 }}>
      <Slider defaultValue={[5]} min={2} max={7} step={1} aria-label="Nights per week" />
    </div>
  );
}

export function Range() {
  return (
    <div style={{ maxWidth: 320 }}>
      <Slider defaultValue={[20, 45]} min={0} max={90} step={5} aria-label="Cook time range in minutes" />
    </div>
  );
}

export function Disabled() {
  return (
    <div style={{ maxWidth: 320 }}>
      <Slider defaultValue={[0.5]} min={0} max={1} step={0.1} disabled aria-label="Variety (locked)" />
    </div>
  );
}
