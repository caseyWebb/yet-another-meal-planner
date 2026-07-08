// /data/stores — the shared store registry list.
import { createFileRoute } from "@tanstack/react-router";
import { StoresScreen } from "../screens/data-stores";

export const Route = createFileRoute("/data/stores/")({
  component: StoresScreen,
});
