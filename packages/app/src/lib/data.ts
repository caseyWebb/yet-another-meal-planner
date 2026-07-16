// The member app's data layer (member-app-core): TanStack Query hooks over the typed
// hc client — short staleTime + refetch-on-focus (plan §6: the server is the truth,
// the cache is a display buffer), one query key per API area, and the shared
// mutations pages reuse (favorite set, plan ops). Every class (b) mutation sends an
// EXPLICIT target state keyed on its canonical id, so a replayed delivery converges
// (the row tests on the Worker side pin that); class (a) writes ride If-Match
// helpers with the rebase-on-412 loop.
import { useQuery } from "@tanstack/react-query";
import { api, apiError, appFetch, type ApiError } from "./api";
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
import type { GroceryListData } from "@yamp/contract";
import type { AisleMapDocument } from "@yamp/contract";
import type { StoreAdapterProjection } from "@yamp/worker/store-adapter-shapes";
import type {
  SpendAnalyzer,
  SpendRange,
} from "@yamp/worker/spend-shapes";
import type {
  WasteAnalyzer,
  WasteRange,
} from "@yamp/worker/waste-shapes";

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
  StoreAdapterProjection,
};
export type {
  CoverageStatus as SpendCoverageStatus,
  SpendAnalyzer,
  SpendBreakdown,
  SpendRange,
  SpendWeek,
} from "@yamp/worker/spend-shapes";
export type {
  Avoidability,
  WasteAnalyzer,
  WasteBreakdown,
  WasteBreakdownItem,
  WasteItemGroup,
  WasteItemStatus,
  WasteRange,
  WasteWeek,
} from "@yamp/worker/waste-shapes";

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
  /** Total minutes, or null when unauthored — an active time filter excludes null. */
  time_total: number | null;
  /** The recipe's course facets, lowercased (`[]` when unclassified) — backs the plan
   *  page's Projects picker (project-eligible = a non-meal course) and its kind label. */
  course?: string[];
  /** The row's visibility provenance for the caller's household — the highest-precedence
   *  grant admitting it (own > friend > curated). Carried by the cookbook index/search
   *  hits only (the trending/picked/similar reads omit it); `curated` renders the row's
   *  "Curated" badge. Optional so a pre-lens Worker (deploy skew) degrades to no badge. */
  provenance?: "own" | "friend" | "curated";
}

export interface RecipeDetail {
  slug: string;
  frontmatter: Record<string, unknown>;
  body: string;
}

/** A recipe note's visibility tier (note-visibility-tiers, D30-final). */
export type NoteTier = "public" | "friends" | "private";

export interface NoteRow {
  author: string;
  /** The author's display handle (joined server-side; falls back to the author id). */
  handle: string;
  created_at: string;
  body: string;
  tags: string[];
  tier: NoteTier;
  /** Deprecated: derived server-side (`tier === 'private'`); key off `tier`. */
  private: boolean;
}

export interface PlannedRow {
  /** The opaque plan-row id — THE address for row-level edits and the class (b)
   *  offline-replay key (client-mintable ULID; never parsed or meaningfully sorted). */
  id: string;
  recipe: string;
  meal: "breakfast" | "lunch" | "dinner" | "project";
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
  checked_at?: string | null;
  row_version?: number;
  updated_at?: string | null;
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
  /** Where the row is kept — a `PANTRY_LOCATIONS` slug (served by the pantry read; null
   *  until the member sets it). Backs the group-by-location view. */
  location?: string;
  /** The stored canonical dedup key (the D1 `normalized_name` / PK) — served today. */
  normalized_name?: string;
  /** The curated human-facing label, stored independently of `name` — served today. */
  display_name?: string;
  prepared_from: string | null;
  added_at?: string;
  last_verified_at?: string;
  notes?: string;
}

export interface LogRow {
  id: number;
  date: string;
  type: "recipe" | "ready_to_eat" | "ad_hoc";
  /** Which meal this cook was; null = "unknown / not a meal" (pre-meal-dimension rows). */
  meal: "breakfast" | "lunch" | "dinner" | "project" | null;
  recipe: string | null;
  name: string | null;
  title: string | null;
  protein: string | null;
  cuisine: string | null;
}

export interface VibeRow {
  id: string;
  vibe: string;
  /** Which meal's palette this vibe samples into (default 'dinner'; the server always
   *  returns it). Backs the meal-grouped list. */
  meal?: "breakfast" | "lunch" | "dinner";
  /** Assigned household members (band-1 field; the assignment UI is reserved for band 5,
   *  so this rides through unread this band). Absent/empty = everyone. */
  members?: string[];
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

// --- the People aggregate (households-friends-and-people-page) ----------------------

export type PeopleTier = "household" | "friend";

export interface PeopleMember {
  id: string;
  handle: string;
  you: boolean;
  /** The VIEWER's own alias only (null when unset) — never anyone else's. */
  nickname: string | null;
  joined_at: number;
}

export interface PeopleFriend {
  tenant: string;
  member: { id: string; handle: string };
  nickname: string | null;
  /** "N shared" (D27): the friend household's cookbook size. */
  shared: number;
  since: number;
}

export interface PeopleInboxRow {
  id: string;
  tier: PeopleTier;
  /** The sending member (opaque id) — the accept flow's nickname-seed edit targets it. */
  from_member: string;
  from_handle: string;
  display_name: string | null;
  note: string | null;
  created_at: number;
}

export interface PeopleAwaitingRow {
  /** Deliberately NO state field: pending/declined/swallowed are indistinguishable
   *  by construction (D24 — the requester's row reads "Request sent" forever). */
  id: string;
  tier: PeopleTier;
  to_handle: string;
  created_at: number;
}

export interface PeopleInviteRow {
  token: string;
  tier: PeopleTier;
  created_at: number;
  expires_at: number;
}

export interface PeoplePayload {
  profile: "self-hosted" | "saas";
  members: PeopleMember[];
  friends: PeopleFriend[];
  inbox: PeopleInboxRow[];
  awaiting: { requests: PeopleAwaitingRow[]; invites: PeopleInviteRow[] };
  blocked: { tier: PeopleTier; tenant: string; handle: string | null; created_at: number }[];
  household_max: number;
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
      jsonOf<{ recipes: (Hit & { discovered_at: string | null })[] }>(
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
      jsonOf<{
        slug: string;
        notes: NoteRow[];
        favorites: { author: string }[];
        /** Whether the recipe is on the anonymous public cookbook — drives the
         *  composer's conditional Public copy. Absent on a pre-tier Worker (skew). */
        anonymously_visible?: boolean;
      }>(await api.api.cookbook.recipes[":slug"].notes.$get({ param: { slug } })),
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

export function useGrocerySnapshot() {
  return useQuery({
    queryKey: ["grocery", "view"],
    staleTime: STALE_MS,
    gcTime: PERSIST_GC_MS,
    queryFn: async () => jsonOf<GroceryListData>(await api.api.grocery.view.$get()),
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

/** The sidebar badge counts, derived ONCE from the area reads so a badge and the page it
 *  mirrors can never disagree (sidebar-live-counts):
 *  - plan: schedulable meal rows only — project rows (`meal: 'project'`, D26) are excluded,
 *    matching the meal-plan page's slot/project split.
 *  - grocery: the derived to-buy line count — the same read the grocery page renders — so
 *    rows already advanced to `in_cart`/`ordered` are excluded by the derivation and
 *    plan-derived needs are included. Checked-row subtraction joins when band 3 lands
 *    `checked_at` (D28); the shape here drops it in without another badge rework.
 *  Both source reads sit on the offline persist allowlist (member-app-offline), so the
 *  badges render from the persisted cache offline. The people badge (pending inbound
 *  requests) is reserved for band 5's People destination — the mock's friend-count badge
 *  is a listed bug (D5), deliberately not reproduced here. The plain (unenriched) to-buy
 *  read backs the badge: the aisle/substitute enrichment the page uses adds per-line fields
 *  but never changes the line count, so the plain variant matches the page's count while
 *  skipping the enrichment's Locations resolve. It still derives the full to-buy view
 *  (plan-derived needs included) on every session — the deliberate cost of the badge
 *  equalling what the grocery page shows, rather than a lighter raw-list count. */
export function useSidebarCounts(): { plan: number; grocery: number; people: number } {
  const plan = usePlan();
  const toBuy = useToBuy(false);
  const people = usePeople();
  return {
    plan: plan.data?.planned.filter((r) => r.meal !== "project").length ?? 0,
    grocery: toBuy.data?.to_buy.length ?? 0,
    // Actionable pending inbound requests — the exact rows the People inbox renders
    // (swallowed/resolved rows never reach the aggregate). The people read is NOT on
    // the persistence allowlist, so after an offline relaunch the badge is simply
    // absent until connectivity returns (never stale).
    people: people.data?.inbox.length ?? 0,
  };
}

/** The People aggregate — the ONE read the page AND the sidebar badge derive from.
 *  Deliberately outside the persistence allowlist (social data stays out of the
 *  offline store; member-app-offline). */
export function usePeople() {
  return useQuery({
    queryKey: ["people"],
    staleTime: STALE_MS,
    queryFn: async () => jsonOf<PeoplePayload>(await appFetch("/api/people")),
  });
}

/** Trending (group-wide, counts only, min-signal-guarded — empty on sparse history). */
export interface TrendingRecipe extends Hit {
  cooks: number;
  cooks_by: number;
  last_cooked: string;
}

export function useTrending() {
  return useQuery({
    queryKey: ["cookbook", "trending"],
    staleTime: STALE_MS,
    queryFn: async () =>
      jsonOf<{
        recipes: TrendingRecipe[];
        window_days: number;
        /** The deployment profile the guard ran under — conditions the cook-signal
         *  label ("Trending" self-hosted / "Popular with Friends" SaaS) and the chip
         *  copy. Optional so a pre-lens Worker (deploy skew) keeps today's labels. */
        profile?: "self-hosted" | "saas";
      }>(await api.api.cookbook.trending.$get()),
  });
}

export function usePickedForYou() {
  return useQuery({
    queryKey: ["cookbook", "picked-for-you"],
    staleTime: STALE_MS,
    queryFn: async () => jsonOf<{ recipes: Hit[] }>(await api.api.cookbook["picked-for-you"].$get()),
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

/** Credential-bearing availability truth is deliberately non-persisted: this key
 * is outside persist.ts's allowlist and refetches on the normal focus policy. */
export function useStoreAdapters() {
  return useQuery({
    queryKey: ["store-adapters"],
    staleTime: STALE_MS,
    queryFn: async () => jsonOf<StoreAdapterProjection>(await appFetch("/api/profile/store-adapters")),
  });
}

export function useAisleMap(slug: string | null) {
  return useQuery({
    queryKey: ["aisle-map", slug],
    enabled: slug !== null,
    staleTime: STALE_MS,
    queryFn: async () => jsonOf<AisleMapDocument>(await appFetch(`/api/stores/${encodeURIComponent(slug!)}/aisle-map`)),
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

/** Online-only Spend analyzer read. Its range is part of the representation and it
 * stays outside the persistence allowlist by construction. */
export function useSpendAnalyzer(range: SpendRange, enabled: boolean) {
  return useQuery<SpendAnalyzer, ApiError>({
    queryKey: ["retrospective", "spend", range],
    enabled,
    staleTime: 60_000,
    refetchOnMount: "always",
    retry: false,
    queryFn: async () =>
      jsonOf<SpendAnalyzer>(await api.api.retrospective.spend.$get({ query: { range } })),
  });
}

/** Online-only Waste analyzer read. The shared range is part of the representation,
 * current avoidability policy is selected server-side, and this key intentionally
 * stays outside the persistence allowlist. */
export function useWasteAnalyzer(range: WasteRange, enabled: boolean) {
  return useQuery<WasteAnalyzer, ApiError>({
    queryKey: ["retrospective", "waste", range],
    enabled,
    staleTime: 60_000,
    refetchOnMount: "always",
    retry: false,
    queryFn: async () =>
      jsonOf<WasteAnalyzer>(await api.api.retrospective.waste.$get({ query: { range } })),
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
  /** add: a client-minted idempotency key (ULID); set/remove: the exact row address. */
  id?: string;
  recipe?: string;
  meal?: "breakfast" | "lunch" | "dinner" | "project";
  /** add only — THE one wire spelling of explicit duplication (the commit NEVER sets it). */
  duplicate?: boolean;
  planned_for?: string | null;
  sides?: string[];
  from_vibe?: string | null;
}

/** The `/api/plan/ops` response: applied ops and per-op conflicts (HTTP 200 even with
 *  conflicts — the caller inspects `conflicts` to surface a failure rather than a false
 *  success). Both arrays are opaque here; the page only reads `conflicts.length`. */
export interface PlanOpsResult {
  applied: unknown[];
  conflicts: unknown[];
}

/** Crockford base32 (the ULID alphabet). */
const ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Mint a client-side ULID — the plan-row id the commit's add ops carry (the class (b)
 *  replay key; the same mint shape as the Worker's src/ids.ts). */
export function mintRowId(now: number = Date.now()): string {
  let t = now;
  let time = "";
  for (let i = 0; i < 10; i++) {
    time = ULID_ALPHABET[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const rand = crypto.getRandomValues(new Uint8Array(16));
  let out = time;
  for (let i = 0; i < 16; i++) out += ULID_ALPHABET[rand[i] & 31];
  return out;
}

/** A read whose response ETag feeds a class (a) If-Match write. */
export async function readWithEtag<T>(
  res: Response & { json(): Promise<unknown> },
): Promise<{ value: T; etag: string }> {
  if (!res.ok) throw await apiError(res);
  return { value: (await res.json()) as T, etag: res.headers.get("etag") ?? "" };
}
