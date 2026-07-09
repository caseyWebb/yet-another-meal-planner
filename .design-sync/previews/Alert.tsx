import { Alert, AlertTitle, AlertDescription, IconAlert } from "@yamp/ui";

export function Default() {
  return (
    <Alert style={{ maxWidth: 460 }}>
      <AlertTitle>Pantry unchecked for 5 days</AlertTitle>
      <AlertDescription>
        Verify your pantry so next week's plan doesn't re-buy staples you already have.
      </AlertDescription>
    </Alert>
  );
}

export function Destructive() {
  return (
    <Alert variant="destructive" style={{ maxWidth: 460 }}>
      <AlertTitle>Couldn't save your preferences</AlertTitle>
      <AlertDescription>
        The connection to Kroger dropped mid-sync. Check your store link and try again.
      </AlertDescription>
    </Alert>
  );
}

export function WithIcon() {
  return (
    <Alert style={{ maxWidth: 460 }}>
      <IconAlert />
      <AlertTitle>Salmon is not on sale this week</AlertTitle>
      <AlertDescription>
        We swapped in pan-seared chicken thighs to keep the plan on budget.
      </AlertDescription>
    </Alert>
  );
}
