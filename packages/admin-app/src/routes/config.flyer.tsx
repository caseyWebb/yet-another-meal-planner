// /config/flyer — placeholder (screen lands with group 3).
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/config/flyer")({
  component: () => <p className="screen-loading">ConfigFlyer</p>,
});
