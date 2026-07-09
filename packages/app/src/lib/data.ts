// The member app's data layer (member-app-core): TanStack Query hooks over the typed
// hc client — short staleTime + refetch-on-focus (plan §6: the server is the truth,
// the cache is a display buffer), one query key per API area, and the shared
// mutations pages reuse (favorite set, plan ops). Every class (b) mutation sends an
// EXPLICIT target state keyed on its canonical id, so a replayed delivery converges
// (the row tests on the Worker side pin that); class (a) writes ride If-Match
// helpers with the rebase-on-412 loop.
import { useQuery } from "@tanstack/react-query";
import { api, apiError, appFetch } from "./api";
import { GC_TIME_MS } from "./persist";
import type {
  ToBuyViewLine as ToBuyLine,
  PantryCoveredLine as PantryCovered,
  ToBuyView,
  LinePlacement,
  CandidateView as OrderCandidate,
  ResolvedLine as OrderResolvedLine,
  CheckpointLine as OrderCheckpointLine,
  PlaceOrderOutcome as OrderOutcome,
  PlaceOrderInput as OrderRequest,
  SuggestSubstitutionsInput as SubstitutionsRequest,
  SuggestSubstitutionsResult as SubstitutionsResult,
  LineSuggestions,
  SubstitutionAlternative,
  SiblingSuggestion,
} from "@yamp/worker/order-shapes";

export type {
  ToBuyLine,
  PantryCovered,
  ToBuyView,
  LinePlacement,
  OrderCandidate,
  OrderResolvedLine,
  OrderCheckpointLine,
  OrderOutcome,
  OrderRequest,
  SubstitutionsRequest,
  SubstitutionsResult,
  LineSuggestions,
  SubstitutionAlternative,
  SiblingSuggestion,
};

/** Plan §6 posture: near-live reads, no long client cache. */
const STALE_MS = 15_000;

/** The PERSISTED reads' gcTime (member-app-offline D1): an allowlisted entry must
 *  outlive memory gc or it silently drops from the next dehydration. staleTime is
 *  untouched — persistence changes what survives a relaunch, not read freshness. */
const PERSIST_GC_MS = GC_TIME_MS;

// --- payload shapes (the API's JSON, spelled out for the pages) ---------------

export interface Hit {
  slug: string;
  title: string;
  description: string | null;
  protein: string | null;
  cuisine: string | null;
}

export interface RecipeDetail {
  slug: string;
  frontmatter: Record<string, unknown>;
  body: string;
}

export interface NoteRow {
  author: string;
  created_at: string;
  body: string;
  tags: string[];
  private: boolean;
}

export interface PlannedRow {
  recipe: string;
  planned_for?: string | null;
  sides?: string[];
  from_vibe?: string | null;
}

export interface GroceryRow {
  name: string;
  quantity: string;
  kind: "grocery" | "household" | "other";
  domain: string;
  status: "active" | "in_cart" | "ordered";
  source: string;
  for_recipes: string[];
  note: string | null;
  added_at: string;
  ordered_at: string | null;
}

// The derived to-buy view (member-app-grocery D1) — the shape GET /api/grocery/to-buy
// serves (one shared op with the MCP read_to_buy tool), and the order operation's
// request/result (member-app-grocery D7) — POST /api/grocery/order's JSON (the
// place_order tool's exact shape) — are the Worker's real wire types, imported above
// from the workerd-free leaf `order-shapes.ts` rather than hand-mirrored here.

export interface PantryRow {
  name: string;
  quantity?: string;
  category?: string;
  prepared_from: string | null;
  added_at?: string;
  last_verified_at?: string;
  notes?: string;
}

export interface LogRow {
  id: number;
  date: string;
  type: "recipe" | "ready_to_eat" | "ad_hoc";
  recipe: string | null;
  name: string | null;
  title: string | null;
  protein: string | null;
  cuisine: string | null;
}

export interface VibeRow {
  id: string;
  vibe: string;
  facets?: Record<string, unknown>;
  cadence_days?: number | null;
  pinned?: boolean;
  base_weight?: number | null;
  weather_affinity?: string[];
  weather_antipathy?: string[];
  season?: string[];
  created_at?: string | null;
  last_satisfied: string | null;
}

export interface ProposalRow {
  id: string;
  kind: string;
  target: string | null;
  payload: Record<string, unknown>;
  rationale: string | null;
  evidence: Record<string, unknown> | null;
  status: string;
  producer: string | null;
  created_at: string | null;
}

export type Overlay = Record<string, { favorite?: boolean; reject?: boolean }>;

export interface ProfilePayload {
  initialized: boolean;
  missing: string[];
  preferences: Record<string, unknown> | null;
  taste: string | null;
  diet_principles: string | null;
  kitchen: { owned: string[]; notes: Record<string, unknown> };
  staples: { name: string; perishable?: boolean }[];
  ready_to_eat: Record<string, unknown>[];
  stockup: Record<string, unknown> | null;
  kroger: { linked: boolean };
}

async function jsonOf<T>(res: { ok: boolean; status: number; json(): Promise<unknown> }): Promise<T> {
  if (!res.ok) throw await apiError(res);
  return (await res.json()) as T;
}

// --- queries -------------------------------------------------------------------

export function useIndex() {
  return useQuery({
    queryKey: ["cookbook", "index"],
    staleTime: STALE_MS,
    gcTime: PERSIST_GC_MS,
    // The collection read is /cookbook/recipes (hc reserves `.index` for a "/" route).
    queryFn: async () => jsonOf<{ recipes: Hit[] }>(await api.api.cookbook.recipes.$get()),
  });
}

export function useNewForMe() {
  return useQuery({
    queryKey: ["cookbook", "new-for-me"],
    staleTime: STALE_MS,
    queryFn: async () =>
      jsonOf<{ recipes: (Hit & { time_total: number | null; discovered_at: string | null })[] }>(
        await api.api.cookbook["new-for-me"].$get(),
      ),
  });
}

export function useSearch(q: string) {
  return useQuery({
    queryKey: ["cookbook", "search", q],
    enabled: q.trim().length > 0,
    staleTime: STALE_MS,
    queryFn: async () =>
      jsonOf<{ q: string; results: Hit[] }>(await api.api.cookbook.search.$get({ query: { q } })),
  });
}

export function useRecipe(slug: string) {
  return useQuery({
    queryKey: ["cookbook", "recipe", slug],
    staleTime: STALE_MS,
    gcTime: PERSIST_GC_MS,
    queryFn: async () =>
      jsonOf<RecipeDetail>(await api.api.cookbook.recipes[":slug"].$get({ param: { slug } })),
  });
}

export function useSimilar(slug: string) {
  return useQuery({
    queryKey: ["cookbook", "similar", slug],
    staleTime: 60_000,
    queryFn: async () =>
      jsonOf<{ slug: string; similar: Hit[] }>(
        await api.api.cookbook.recipes[":slug"].similar.$get({ param: { slug } }),
      ),
  });
}

export function useNotes(slug: string) {
  return useQuery({
    queryKey: ["cookbook", "notes", slug],
    staleTime: STALE_MS,
    queryFn: async () =>
      jsonOf<{ slug: string; notes: NoteRow[]; favorites: { author: string }[] }>(
        await api.api.cookbook.recipes[":slug"].notes.$get({ param: { slug } }),
      ),
  });
}

export function useOverlay() {
  return useQuery({
    queryKey: ["overlay"],
    staleTime: STALE_MS,
    gcTime: PERSIST_GC_MS,
    queryFn: async () => jsonOf<{ overlay: Overlay }>(await api.api.overlay.$get()),
  });
}

export function usePlan() {
  return useQuery({
    queryKey: ["plan"],
    staleTime: STALE_MS,
    gcTime: PERSIST_GC_MS,
    queryFn: async () => jsonOf<{ planned: PlannedRow[] }>(await api.api.plan.$get()),
  });
}

export function useGrocery() {
  return useQuery({
    queryKey: ["grocery"],
    staleTime: STALE_MS,
    gcTime: PERSIST_GC_MS,
    queryFn: async () => jsonOf<{ items: GroceryRow[] }>(await api.api.grocery.$get()),
  });
}

export function useToBuy(enrich = false) {
  return useQuery({
    // The enrich param is part of the representation (D12): its own cache entry,
    // still under the "grocery" prefix so the shared invalidation refreshes both.
    queryKey: ["grocery", "to-buy", enrich ? "enriched" : "plain"],
    staleTime: STALE_MS,
    gcTime: PERSIST_GC_MS,
    queryFn: async () =>
      enrich
        ? // The enriched variant (?enrich=1) — the query string isn't in the typed
          // client's route params, so this one read goes through the shared wrapper
          // directly (same-origin, and it must ride the X-App-Build skew tap). Carries
          // aisle placement AND substitute hints under one Locations resolve
          // (inline-substitution-hints D2).
          jsonOf<ToBuyView>(await appFetch("/api/grocery/to-buy?enrich=1"))
        : jsonOf<ToBuyView>(await api.api.grocery["to-buy"].$get()),
  });
}

/** Trending (group-wide, counts only, min-signal-guarded — empty on sparse history). */
export interface TrendingRecipe extends Hit {
  time_total: number | null;
  cooks: number;
  cooks_by: number;
  last_cooked: string;
}

export function useTrending() {
  return useQuery({
    queryKey: ["cookbook", "trending"],
    staleTime: STALE_MS,
    queryFn: async () =>
      jsonOf<{ recipes: TrendingRecipe[]; window_days: number }>(await api.api.cookbook.trending.$get()),
  });
}

export function usePickedForYou() {
  return useQuery({
    queryKey: ["cookbook", "picked-for-you"],
    staleTime: STALE_MS,
    queryFn: async () =>
      jsonOf<{ recipes: (Hit & { time_total: number | null })[] }>(
        await api.api.cookbook["picked-for-you"].$get(),
      ),
  });
}

/**
 * The alternatives-only substitution read (inline-substitution-hints D4/D5) — fetched
 * by the ORDER DIALOG at preview time, member-initiated and ONLINE-ONLY: a plain fetch
 * through the typed client, never a persisted/replayed mutation (the read fans out to
 * Kroger server-side; results are per-session client state, no query cache entry). The
 * cheap cross-ingredient sibling hints ride the enriched `read_to_buy` instead
 * (`useToBuy(true)` / `ToBuyLine.substitutes`), not this call.
 */
export async function fetchSubstitutions(input: SubstitutionsRequest = {}): Promise<SubstitutionsResult> {
  const res = await api.api.grocery.substitutions.$post({ json: input });
  if (!res.ok) throw await apiError(res);
  return (await res.json()) as SubstitutionsResult;
}

export function usePantry() {
  return useQuery({
    queryKey: ["pantry"],
    staleTime: STALE_MS,
    gcTime: PERSIST_GC_MS,
    queryFn: async () => jsonOf<{ items: PantryRow[] }>(await api.api.pantry.$get()),
  });
}

export function useLog() {
  return useQuery({
    queryKey: ["log"],
    staleTime: STALE_MS,
    queryFn: async () => jsonOf<{ entries: LogRow[] }>(await api.api.log.$get()),
  });
}

export function useProfile() {
  return useQuery({
    queryKey: ["profile"],
    staleTime: STALE_MS,
    queryFn: async () => jsonOf<ProfilePayload>(await api.api.profile.$get()),
  });
}

export function useRetrospective(period = "quarter") {
  return useQuery({
    queryKey: ["retrospective", period],
    staleTime: 60_000,
    queryFn: async () =>
      jsonOf<{
        period: string;
        recipes_cooked?: { recipe: string; count: number }[];
        protein_mix?: Record<string, number>;
        cuisine_mix?: Record<string, number>;
        cadence?: { cooks_per_week?: number };
      }>(await api.api.profile.retrospective.$get({ query: { period } })),
  });
}

export function useVibes() {
  return useQuery({
    queryKey: ["vibes"],
    staleTime: STALE_MS,
    queryFn: async () => jsonOf<{ vibes: VibeRow[] }>(await api.api.vibes.$get()),
  });
}

export function useProposals() {
  return useQuery({
    queryKey: ["proposals"],
    staleTime: STALE_MS,
    queryFn: async () => jsonOf<{ proposals: ProposalRow[] }>(await api.api.vibes.proposals.$get()),
  });
}

// --- shared write shapes -----------------------------------------------------------
// The class (b) writes themselves live in lib/mutations.ts (member-app-offline D4):
// registered mutations that pause offline and replay on reconnect. Class (a) stays
// imperative here — its read-fresh → If-Match → rebase-on-412 loop requires a live
// server (D5) and must never queue.

export interface PlanOp {
  op: "add" | "remove" | "set";
  recipe: string;
  planned_for?: string | null;
  sides?: string[];
  from_vibe?: string | null;
}

/** A read whose response ETag feeds a class (a) If-Match write. */
export async function readWithEtag<T>(res: Response & { json(): Promise<unknown> }): Promise<{ value: T; etag: string }> {
  if (!res.ok) throw await apiError(res);
  return { value: (await res.json()) as T, etag: res.headers.get("etag") ?? "" };
}
