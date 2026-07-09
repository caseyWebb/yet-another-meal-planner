import * as React from "react";
import { Toaster, toast } from "@yamp/ui";

export function AddedToPlan() {
  // Fire after mount so the <Toaster/> listener is registered before toast() runs.
  React.useEffect(() => {
    toast("Added pan-seared salmon to your meal plan");
  }, []);
  return (
    <div style={{ minHeight: 96, position: "relative" }}>
      <Toaster />
    </div>
  );
}

export function AddedToList() {
  React.useEffect(() => {
    toast("2 items added to your grocery list");
  }, []);
  return (
    <div style={{ minHeight: 96, position: "relative" }}>
      <Toaster />
    </div>
  );
}
