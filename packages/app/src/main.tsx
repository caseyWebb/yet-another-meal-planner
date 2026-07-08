import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { routeTree } from "./routeTree.gen";
import { APP_BUILD } from "./lib/api";
import {
  MAX_AGE_MS,
  createIdbPersister,
  queryClient,
  shouldDehydrateQuery,
  shouldDehydrateMutation,
} from "./lib/persist";
import { registerMutationDefaults } from "./lib/mutations";
import "./styles.css";

// The class (b) registry's defaults must exist BEFORE restore: resumed paused
// mutations re-bind their persisted variables to these functions by mutationKey.
registerMutationDefaults(queryClient);

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

// Offline layer 2 (member-app-offline D1): the query cache persists to IndexedDB
// through the allowlist predicates; `buster` discards a prior build's state wholesale;
// restore gates queries (no empty-cache flash), then queued class (b) writes from a
// previous launch resume (layer 3's across-reload replay).
const persistOptions = {
  persister: createIdbPersister(),
  buster: APP_BUILD,
  maxAge: MAX_AGE_MS,
  dehydrateOptions: { shouldDehydrateQuery, shouldDehydrateMutation },
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={persistOptions}
      onSuccess={() => {
        void queryClient.resumePausedMutations();
      }}
    >
      <RouterProvider router={router} />
    </PersistQueryClientProvider>
  </StrictMode>,
);
