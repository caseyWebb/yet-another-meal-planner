import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
  Button,
  IconSearch,
  IconPantry,
} from "@yamp/ui";

export function NoRecipes() {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <IconSearch />
        </EmptyMedia>
        <EmptyTitle>No recipes found</EmptyTitle>
        <EmptyDescription>
          Nothing in your cookbook matches "sheet-pan gnocchi" yet. Try a different search or import one.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

export function EmptyPantry() {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <IconPantry />
        </EmptyMedia>
        <EmptyTitle>Your pantry is empty</EmptyTitle>
        <EmptyDescription>
          Add the staples you keep on hand so plans skip re-buying olive oil, rice, and spices.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button>Add pantry staples</Button>
      </EmptyContent>
    </Empty>
  );
}
