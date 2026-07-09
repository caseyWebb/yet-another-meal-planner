import { PageHead, Button, IconSparkle } from "@yamp/ui";

export function WithActions() {
  return (
    <PageHead
      title="Plan your week"
      sub="Build a week from the moods you cook by — balanced across proteins and cuisines, and tuned to the forecast."
      actions={
        <Button>
          <IconSparkle /> Propose
        </Button>
      }
    />
  );
}

export function TitleOnly() {
  return <PageHead title="Your grocery list" />;
}
