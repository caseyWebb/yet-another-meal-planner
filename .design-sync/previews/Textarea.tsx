import { Textarea } from "@yamp/ui";

export function Default() {
  return <Textarea placeholder="Describe the vibe for this night…" style={{ maxWidth: 360 }} />;
}

export function WithValue() {
  return (
    <Textarea
      defaultValue={"Lighter dinners this week — use up the salmon in the fridge and lean Mediterranean. Skip anything over 40 minutes on weeknights."}
      style={{ maxWidth: 360 }}
    />
  );
}

export function Disabled() {
  return (
    <Textarea
      defaultValue="Cooking notes are locked while the plan is being generated."
      disabled
      style={{ maxWidth: 360 }}
    />
  );
}

export function Invalid() {
  return <Textarea defaultValue="" aria-invalid placeholder="Notes are required" style={{ maxWidth: 360 }} />;
}
