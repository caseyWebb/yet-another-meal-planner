import { TokenField, Button, IconPlus } from "@yamp/ui";

export function Dietary() {
  return (
    <div style={{ maxWidth: 380 }}>
      <TokenField values={["organic", "gluten-free", "no shellfish"]} onRemove={() => {}}>
        <Button variant="outline" size="sm">
          <IconPlus /> Add
        </Button>
      </TokenField>
    </div>
  );
}

export function Proteins() {
  return (
    <div style={{ maxWidth: 380 }}>
      <TokenField values={["Chicken", "Salmon", "Tofu"]} onRemove={() => {}}>
        <Button variant="outline" size="sm">
          <IconPlus /> Add protein
        </Button>
      </TokenField>
    </div>
  );
}

export function Empty() {
  return (
    <div style={{ maxWidth: 380 }}>
      <TokenField values={[]} onRemove={() => {}}>
        <Button variant="outline" size="sm">
          <IconPlus /> Add a cuisine
        </Button>
      </TokenField>
    </div>
  );
}
