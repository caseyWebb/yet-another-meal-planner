import { Button, IconSparkle, IconDice, IconPlus, IconCart } from "@yamp/ui";

export function Variants() {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
      <Button>Cook tonight</Button>
      <Button variant="secondary">Save for later</Button>
      <Button variant="outline">Edit</Button>
      <Button variant="ghost">Skip</Button>
      <Button variant="destructive">Remove</Button>
      <Button variant="link">View recipe</Button>
    </div>
  );
}

export function Sizes() {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
      <Button size="sm">Small</Button>
      <Button size="default">Default</Button>
      <Button size="lg">Large</Button>
      <Button size="icon" aria-label="Add item">
        <IconPlus />
      </Button>
    </div>
  );
}

export function WithIcons() {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
      <Button>
        <IconSparkle /> Propose a week
      </Button>
      <Button variant="outline">
        <IconDice /> Re-roll
      </Button>
      <Button variant="secondary">
        <IconCart /> Add to list
      </Button>
    </div>
  );
}

export function Disabled() {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <Button disabled>Unavailable</Button>
      <Button variant="outline" disabled>
        Offline
      </Button>
    </div>
  );
}
