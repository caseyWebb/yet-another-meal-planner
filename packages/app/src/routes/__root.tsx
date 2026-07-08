// The root shell: the reload prompt (member-app-offline D7) and the toaster render
// OVER both the login and app surfaces — an update banner or an offline-ready note
// must be visible pre-login too.
import { createRootRoute, Outlet } from "@tanstack/react-router";
import { Toaster } from "@grocery-agent/ui";
import { ReloadPrompt } from "../components/reload-prompt";

export const Route = createRootRoute({
  component: () => (
    <>
      <Outlet />
      <ReloadPrompt />
      <Toaster />
    </>
  ),
});
