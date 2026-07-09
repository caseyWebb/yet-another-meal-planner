import { RecipeFacets } from "@yamp/ui";

export function ProteinAndCuisine() {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
      <RecipeFacets protein="Salmon" cuisine="Mediterranean" />
    </div>
  );
}

export function CuisineOnly() {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
      <RecipeFacets cuisine="Italian" />
    </div>
  );
}
