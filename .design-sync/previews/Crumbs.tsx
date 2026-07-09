import { Crumbs } from "@yamp/ui";

export function EditTrail() {
  return (
    <Crumbs
      items={[
        { label: "Meal plan", to: "/plan" },
        { label: "Week of Sep 2", to: "/plan/2024-09-02" },
        { label: "Edit" },
      ]}
      renderLink={(to, label) => <a href={to}>{label}</a>}
    />
  );
}

export function RecipeTrail() {
  return (
    <Crumbs
      items={[
        { label: "Recipes", to: "/recipes" },
        { label: "Weeknight mains", to: "/recipes/weeknight" },
        { label: "Pan-seared salmon" },
      ]}
      renderLink={(to, label) => <a href={to}>{label}</a>}
    />
  );
}
