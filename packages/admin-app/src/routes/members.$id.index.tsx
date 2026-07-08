// /members/$id — placeholder (screen lands with group 3).
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/members/$id/")({
  component: () => <p className="screen-loading">MemberDetail</p>,
});
