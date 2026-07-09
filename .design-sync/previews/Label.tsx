import { Label, Input } from "@yamp/ui";

export function Default() {
  return <Label htmlFor="nights">How many nights are you planning?</Label>;
}

export function WithInput() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, maxWidth: 320 }}>
      <Label htmlFor="recipe-name">Recipe name</Label>
      <Input id="recipe-name" type="text" placeholder="Pan-seared salmon" />
    </div>
  );
}

export function Disabled() {
  return (
    <div className="group" data-disabled style={{ display: "flex", flexDirection: "column", gap: 6, maxWidth: 320 }}>
      <Label htmlFor="store-locked" aria-disabled>
        Preferred store (locked)
      </Label>
      <Input id="store-locked" type="text" defaultValue="Whole Foods" disabled />
    </div>
  );
}
