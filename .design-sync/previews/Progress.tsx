import { Progress } from "@yamp/ui";

export function PantryVerification() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 420 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontSize: 13, color: "var(--muted-foreground)" }}>
          Pantry verified — 5 of 25 staples checked
        </span>
        <Progress value={20} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontSize: 13, color: "var(--muted-foreground)" }}>
          This week's plan — 4 of 6 nights matched to a recipe
        </span>
        <Progress value={65} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontSize: 13, color: "var(--muted-foreground)" }}>
          Grocery list — all items matched to a Kroger SKU
        </span>
        <Progress value={100} />
      </div>
    </div>
  );
}

export function Single() {
  return (
    <div style={{ maxWidth: 420 }}>
      <Progress value={65} />
    </div>
  );
}
