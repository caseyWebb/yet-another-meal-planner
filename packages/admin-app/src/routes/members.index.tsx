// /members — placeholder (screen lands with group 3).
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/members/")({
  component: () => <p className="screen-loading">Members</p>,
});
