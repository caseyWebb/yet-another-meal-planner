import { Switch, Label } from "@yamp/ui";

export function States() {
  return (
    <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
      <Switch defaultChecked />
      <Switch />
    </div>
  );
}

export function WithLabel() {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <Switch id="weather" defaultChecked />
      <Label htmlFor="weather">Tune plan to the weather forecast</Label>
    </div>
  );
}

export function Disabled() {
  return (
    <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
      <Switch defaultChecked disabled />
      <Switch disabled />
    </div>
  );
}
