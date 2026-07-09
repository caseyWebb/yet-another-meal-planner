import { Input } from "@yamp/ui";

export function Default() {
  return <Input type="text" placeholder="Add a recipe name" />;
}

export function WithValue() {
  return <Input type="text" defaultValue="Chicken tikka masala" />;
}

export function Types() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 320 }}>
      <Input type="email" placeholder="you@kitchen.com" />
      <Input type="search" placeholder="Search recipes…" />
      <Input type="number" defaultValue={4} min={1} max={7} />
    </div>
  );
}

export function Invalid() {
  return <Input type="email" defaultValue="not-an-email" aria-invalid />;
}

export function Disabled() {
  return <Input type="text" defaultValue="Kroger — Downtown" disabled />;
}
