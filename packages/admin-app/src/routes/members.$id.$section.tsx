// /members/$id/$section — placeholder (screen lands with group 3).
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/members/$id/$section")({
  component: () => <p className="screen-loading">MemberDetailSection</p>,
});
