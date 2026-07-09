import { EmptyState, Button, IconSparkle, IconSearch } from "@yamp/ui";

export function NoVibes() {
  return (
    <EmptyState
      title="Your palette is empty"
      sub="Planning starts from your night vibes — add a few in your profile so we know how you like to cook."
      icon={<IconSparkle />}
      action={<Button>Set up your palette</Button>}
    />
  );
}

export function NoSearchResults() {
  return (
    <EmptyState
      title="No recipes match that search"
      sub="Try a broader term, a different protein, or clear your dietary filters."
      icon={<IconSearch />}
      action={<Button variant="outline">Clear filters</Button>}
    />
  );
}
