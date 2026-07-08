// The admin SPA's entry (admin-spa): TanStack Router (basepath /admin — the Worker serves
// the shell for every non-API /admin GET) over the shared QueryClient (lib/queries.ts).
// Deliberately NO persister, NO service worker, NO offline layer — the admin panel is an
// online operator tool (D3); the P5 member-app patterns are not adopted here.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { routeTree } from "./routeTree.gen";
import { queryClient } from "./lib/queries";
import "./admin.css";

const router = createRouter({ routeTree, basepath: "/admin" });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
