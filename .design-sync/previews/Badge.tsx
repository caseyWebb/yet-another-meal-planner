import { Badge } from "@yamp/ui";

export function Variants() {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
      <Badge>On sale</Badge>
      <Badge variant="secondary">Chicken</Badge>
      <Badge variant="destructive">Out of stock</Badge>
      <Badge variant="outline">40 min</Badge>
    </div>
  );
}

export function RecipeFacets() {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
      <Badge>Mediterranean</Badge>
      <Badge variant="secondary">Salmon</Badge>
      <Badge variant="outline">Makes leftovers</Badge>
      <Badge variant="outline">Gluten-free</Badge>
    </div>
  );
}
