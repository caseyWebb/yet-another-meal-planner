import { FacetChip } from "@yamp/ui";

export function ProteinAndCuisine() {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
      <FacetChip kind="protein">Salmon</FacetChip>
      <FacetChip>Mediterranean</FacetChip>
    </div>
  );
}
