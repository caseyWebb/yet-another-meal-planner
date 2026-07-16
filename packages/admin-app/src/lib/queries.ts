// The per-screen query definitions (admin-spa D4): one primary query per screen over its
// typed aggregate read, keyed so mutations invalidate narrowly. The QueryClient posture is
// plan-§6: the server is the truth, the cache is a display buffer — staleTime 15 s,
// refetch-on-focus, no persister, no offline layer (D3). An Access-expired error never
// retries (D7 — the overlay is the answer, not another attempt).
import { QueryClient, queryOptions, keepPreviousData } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { api, unwrap, AccessExpiredError } from "./api";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      retry: (failureCount, error) => !(error instanceof AccessExpiredError) && failureCount < 2,
    },
  },
});

/** The Status aggregate — also the global health indicator's source (D6: one read, one cache
 *  entry, refetched periodically + on focus so long client-side sessions stay honest). */
export const statusQuery = queryOptions({
  queryKey: ["status"],
  queryFn: () => unwrap(api.admin.api.status.$get()),
  refetchInterval: 60_000,
});

export const tenantsQuery = queryOptions({
  queryKey: ["tenants"],
  queryFn: () => unwrap(api.admin.api.tenants.$get()),
});

/** The group invite codes (self-service-signup), with live usage + provenance — the Members
 *  "Invite codes" sub-tab. Mutations (mint/revoke) invalidate `["inviteCodes"]`. */
export const inviteCodesQuery = queryOptions({
  queryKey: ["inviteCodes"],
  queryFn: () => unwrap(api.admin.api["invite-codes"].$get()),
});

export const memberQuery = (id: string) =>
  queryOptions({
    queryKey: ["member", id],
    queryFn: () => unwrap(api.admin.api.members[":id"].$get({ param: { id } })),
  });

export interface RecipesSearchParams {
  q: string;
  mode: "keyword" | "hybrid";
  page: number;
  size: number;
}

/** Server-parameterized (hybrid embeds the query; pagination is server-side as today);
 *  `keepPreviousData` keeps the previous page rendered while the next loads. */
export const recipesQuery = (params: RecipesSearchParams) =>
  queryOptions({
    queryKey: ["data", "recipes", params],
    queryFn: () =>
      unwrap(
        api.admin.api.data.recipes.$get({
          query: {
            ...(params.q ? { q: params.q } : {}),
            ...(params.mode !== "keyword" ? { mode: params.mode } : {}),
            ...(params.page > 0 ? { page: String(params.page + 1) } : {}),
            ...(params.size !== 50 ? { size: String(params.size) } : {}),
          },
        }),
      ),
    placeholderData: keepPreviousData,
  });

export const recipeDetailQuery = (slug: string) =>
  queryOptions({
    queryKey: ["data", "recipe", slug],
    queryFn: () => unwrap(api.admin.api.data.recipes[":slug"].$get({ param: { slug } })),
  });

export const storesQuery = queryOptions({
  queryKey: ["data", "stores"],
  queryFn: () => unwrap(api.admin.api.data.stores.$get()),
});

export const storeDetailQuery = (slug: string) =>
  queryOptions({
    queryKey: ["data", "store", slug],
    queryFn: () => unwrap(api.admin.api.data.stores[":slug"].$get({ param: { slug } })),
  });

/** Guidance browse: `gpath` (an object) wins over `gprefix` (a folder) — the read's contract. */
export const guidanceQuery = (params: { gpath?: string; gprefix?: string }) =>
  queryOptions({
    queryKey: ["data", "guidance", params],
    queryFn: () =>
      unwrap(
        api.admin.api.data.guidance.$get({
          query: {
            ...(params.gpath ? { gpath: params.gpath } : {}),
            ...(params.gprefix ? { gprefix: params.gprefix } : {}),
          },
        }),
      ),
    placeholderData: keepPreviousData,
  });

export const insightsQuery = queryOptions({
  queryKey: ["insights"],
  queryFn: () => unwrap(api.admin.api.insights.$get()),
});

export const usageQuery = queryOptions({
  queryKey: ["usage"],
  queryFn: () => unwrap(api.admin.api.usage.$get()),
});

export const logsRunsQuery = queryOptions({
  queryKey: ["logs", "runs"],
  queryFn: () => unwrap(api.admin.api.logs.runs.$get()),
});

export const discoveryCandidatesQuery = queryOptions({
  queryKey: ["discovery", "candidates"],
  queryFn: () => unwrap(api.admin.api.discovery.candidates.$get()),
});

export const satellitesQuery = queryOptions({
  queryKey: ["satellites"],
  queryFn: () => unwrap(api.admin.api.satellites.$get()),
});

// The Normalize area's four per-tab reads (a tab switch fetches only its data; mutations
// invalidate ["normalize","page"] narrowly).
export const normalizePageQuery = queryOptions({
  queryKey: ["normalize", "page"],
  queryFn: () => unwrap(api.admin.api.normalization.page.$get()),
});

export const normalizeNodesQuery = queryOptions({
  queryKey: ["normalize", "nodes"],
  queryFn: () => unwrap(api.admin.api.normalization.nodes.$get()),
});

export const normalizeAuditQuery = queryOptions({
  queryKey: ["normalize", "audit"],
  queryFn: () => unwrap(api.admin.api.normalization.audit.$get()),
});

export const reconcileQuery = queryOptions({
  queryKey: ["reconcile"],
  queryFn: () => unwrap(api.admin.api.reconcile.$get()),
});

// Config-area reads (the existing typed GETs — no new routes).
export const discoveryConfigQuery = queryOptions({
  queryKey: ["discovery-config"],
  queryFn: () => unwrap(api.admin.api.discovery.config.$get()),
});

export const operatorConfigQuery = queryOptions({
  queryKey: ["operator-config"],
  queryFn: () => unwrap(api.admin.api["operator-config"].$get()),
});

export const deploymentConfigQuery = queryOptions({
  queryKey: ["deployment-config"],
  queryFn: () => unwrap(api.admin.api["deployment-config"].$get()),
});

export const corpusQuery = (table: string) =>
  queryOptions({
    queryKey: ["corpus", table],
    queryFn: () => unwrap(api.admin.api.corpus[":table"].$get({ param: { table } })),
  });

export const ingestKeysQuery = queryOptions({
  queryKey: ["ingest-keys"],
  queryFn: () => unwrap(api.admin.api.ingest.keys.$get()),
});

// ── Inferred payload types (the routes' c.json shapes, via hc — no hand decoders) ──
export type StatusData = InferResponseType<typeof api.admin.api.status.$get>;
export type TenantsData = InferResponseType<typeof api.admin.api.tenants.$get>;
export type TenantRow = TenantsData["tenants"][number];
export type InviteCodesData = InferResponseType<(typeof api.admin.api)["invite-codes"]["$get"]>;
export type InviteCodeRow = InviteCodesData["codes"][number];
export type MemberData = InferResponseType<(typeof api.admin.api.members)[":id"]["$get"]>;
export type RecipesData = InferResponseType<typeof api.admin.api.data.recipes.$get>;
export type RecipeDetailData = InferResponseType<(typeof api.admin.api.data.recipes)[":slug"]["$get"]>;
export type StoresData = InferResponseType<typeof api.admin.api.data.stores.$get>;
export type StoreDetailData = InferResponseType<(typeof api.admin.api.data.stores)[":slug"]["$get"]>;
export type GuidanceData = InferResponseType<typeof api.admin.api.data.guidance.$get>;
export type InsightsData = InferResponseType<typeof api.admin.api.insights.$get>;
export type UsageData = InferResponseType<typeof api.admin.api.usage.$get>;
export type LogsRunsData = InferResponseType<typeof api.admin.api.logs.runs.$get>;
export type DiscoveryData = InferResponseType<typeof api.admin.api.discovery.candidates.$get>;
export type SatellitesData = InferResponseType<typeof api.admin.api.satellites.$get>;
export type NormalizePageData = InferResponseType<typeof api.admin.api.normalization.page.$get>;
export type NormalizeNodesData = InferResponseType<typeof api.admin.api.normalization.nodes.$get>;
export type NormalizeAuditData = InferResponseType<typeof api.admin.api.normalization.audit.$get>;
export type ReconcileData = InferResponseType<typeof api.admin.api.reconcile.$get>;
export type DiscoveryConfigData = InferResponseType<typeof api.admin.api.discovery.config.$get>;
export type OperatorConfigData = InferResponseType<(typeof api.admin.api)["operator-config"]["$get"]>;
export type DeploymentConfigData = InferResponseType<(typeof api.admin.api)["deployment-config"]["$get"]>;
export type CorpusData = InferResponseType<(typeof api.admin.api.corpus)[":table"]["$get"]>;
export type IngestKeysData = InferResponseType<typeof api.admin.api.ingest.keys.$get>;
