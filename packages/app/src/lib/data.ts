// The member app's data layer (member-app-core): TanStack Query hooks over the typed
// hc client — short staleTime + refetch-on-focus (plan §6: the server is the truth,
// the cache is a display buffer), one query key per API area, and the shared
// mutations pages reuse (favorite set, plan ops). Every class (b) mutation sends an
// EXPLICIT target state keyed on its canonical id, so a replayed delivery converges
// (the row tests on the Worker side pin that); class (a) writes ride If-Match
// helpers with the rebase-on-412 loop.
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { api, apiError } from "./api";

/** Plan §6 posture: near-live reads, no long client cache. */
const STALE_MS = 15_000;

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
    queryFn: async () => jsonOf<{ recipes: Hit[] }>(await api.api.cookbook.index.$get()),
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
    queryFn: async () => jsonOf<{ overlay: Overlay }>(await api.api.overlay.$get()),
  });
}

export function usePlan() {
  return useQuery({
    queryKey: ["plan"],
    staleTime: STALE_MS,
    queryFn: async () => jsonOf<{ planned: PlannedRow[] }>(await api.api.plan.$get()),
  });
}

export function useGrocery() {
  return useQuery({
    queryKey: ["grocery"],
    staleTime: STALE_MS,
    queryFn: async () => jsonOf<{ items: GroceryRow[] }>(await api.api.grocery.$get()),
  });
}

export function usePantry() {
  return useQuery({
    queryKey: ["pantry"],
    staleTime: STALE_MS,
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

// --- shared mutations ------------------------------------------------------------

/** EXPLICIT favorite set (never a toggle — D8): the caller computes the target state. */
export async function setFavorite(qc: QueryClient, slug: string, favorite: boolean): Promise<void> {
  // Optimistic: flip the overlay cache immediately; the invalidate reconciles.
  qc.setQueryData<{ overlay: Overlay }>(["overlay"], (cur) => {
    if (!cur) return cur;
    const next = { ...cur.overlay };
    if (favorite) next[slug] = { ...next[slug], favorite: true, reject: undefined };
    else next[slug] = { ...next[slug], favorite: undefined };
    return { overlay: next };
  });
  const res = await api.api.overlay.favorite.$put({ json: { slug, favorite } });
  if (!res.ok) throw await apiError(res);
  await qc.invalidateQueries({ queryKey: ["overlay"] });
}

export interface PlanOp {
  op: "add" | "remove" | "set";
  recipe: string;
  planned_for?: string | null;
  sides?: string[];
  from_vibe?: string | null;
}

/** Row-level plan ops (class (b), keyed by recipe slug). */
export async function applyPlanOps(qc: QueryClient, ops: PlanOp[]): Promise<void> {
  const res = await api.api.plan.ops.$post({ json: { ops } });
  if (!res.ok) throw await apiError(res);
  await qc.invalidateQueries({ queryKey: ["plan"] });
  await qc.invalidateQueries({ queryKey: ["cookbook", "new-for-me"] });
}

/** A read whose response ETag feeds a class (a) If-Match write. */
export async function readWithEtag<T>(res: Response & { json(): Promise<unknown> }): Promise<{ value: T; etag: string }> {
  if (!res.ok) throw await apiError(res);
  return { value: (await res.json()) as T, etag: res.headers.get("etag") ?? "" };
}
