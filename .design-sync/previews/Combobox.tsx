import { Combobox } from "@yamp/ui";

const RECIPES = [
  { value: "pan-seared-salmon", label: "Pan-seared salmon", sub: "Mediterranean · 25 min" },
  { value: "chicken-tikka-masala", label: "Chicken tikka masala", sub: "Indian · 45 min" },
  { value: "beef-bolognese", label: "Beef bolognese", sub: "Italian · 60 min" },
  { value: "tofu-stir-fry", label: "Tofu stir-fry", sub: "Asian · 20 min" },
];

export function Open() {
  return (
    <div style={{ maxWidth: 340 }}>
      <Combobox
        options={RECIPES}
        placeholder="Search recipes…"
        ariaLabel="Search recipes"
        onSelect={() => {}}
        autoFocus
      />
    </div>
  );
}

export function AllowCustom() {
  return (
    <div style={{ maxWidth: 340 }}>
      <Combobox
        options={[
          { value: "organic", label: "Organic" },
          { value: "gluten-free", label: "Gluten-free" },
          { value: "dairy-free", label: "Dairy-free" },
        ]}
        placeholder="Add a dietary tag…"
        ariaLabel="Add a dietary tag"
        allowCustom
        onSelect={() => {}}
      />
    </div>
  );
}
