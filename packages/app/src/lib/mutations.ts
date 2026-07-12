// The class (b) mutation registry (member-app-offline D4/D5): every class (b) write —
// the D8 two-writer table's idempotent, canonical-id-keyed upserts and deletes — is a
// registered TanStack mutation: a `mutationKey` from persist.ts's
// REGISTERED_MUTATION_KEYS with client-registered DEFAULTS (mutationFn over the hc
// client throwing the structured ApiError, optimistic cache edits where the offline UI
// needs immediate truth, per-key error toasts, settle-time area invalidations) and
// plain-JSON variables. Defaults are what make a queued write survive a reload:
// `resumePausedMutations()` re-binds persisted VARIABLES to the function registered
// under the same key. Offline, these pause (onlineManager) instead of failing and
// replay serially on reconnect/restore; replay convergence is the server's D8 contract
// (explicit target states keyed on canonical ids).
//
// THE NEGATIVE SPACE (D5 — normative): the online-only surfaces are NOT here and must
// never be — order preview/commit (the Kroger cart write accumulates), substitutions,
// propose (a query), vibe suggest, session login/logout, and every class (a) If-Match
// write (a queued stale precondition would only ever 412). They stay direct calls;
// persist.ts's shouldDehydrateMutation refuses any key outside the registry.
import { useMutation, type QueryClient } from "@tanstack/react-query";
import { toast } from "@yamp/ui";
import { api, apiError, type ApiError } from "./api";
import { REGISTERED_MUTATION_KEYS } from "./persist";
import type { GroceryRow, Overlay, PantryRow, PlanOp, PlanOpsResult, ToBuyView } from "./data";
import type { GroceryListData } from "@yamp/contract";

// --- variable shapes (plain JSON — they persist to IndexedDB and replay) -----------

export interface GroceryAddVars {
  name: string;
  quantity?: string;
  note?: string;
  source?: string;
  for_recipes?: string[];
}

export interface GrocerySetVars {
  name: string;
  status?: "active" | "in_cart" | "ordered";
  quantity?: string;
  note?: string;
}

export interface GroceryRemoveVars {
  name: string;
}
export interface GroceryCheckedVars {
  key: string;
  checked: boolean;
  expected_row_version: number;
  snapshot_version: string;
  occurred_at?: string;
}
export interface GroceryCoverageVars {
  key: string;
  enabled: boolean;
  name?: string;
  snapshot_version: string;
}
export type GrocerySubstitutionVars =
  | {
      original_key: string;
      replacement_key: string;
      replacement_name: string;
      snapshot_version: string;
      undo?: false;
    }
  | { original_key: string; snapshot_version: string; undo: true };
export interface GroceryRelistVars {
  send_id: string | null;
  line_key: string;
  expected_row_version: number;
}

/** One pantry row op (add-upsert / remove / verify / dispose), keyed by canonical id —
 *  `dispose` additionally keyed on its client-minted waste `event_id` for replay
 *  convergence. Plain JSON so a queued op persists and replays (member-app-offline). */
export type PantryOp =
  | { op: "add"; item: Record<string, unknown> }
  | { op: "remove" | "verify"; name: string }
  | {
      op: "dispose";
      name: string;
      /** consumed (`used`, pure idempotent delete) vs tossed (`waste`, records an event). */
      disposition: "used" | "waste";
      /** waste only: the canonical `WASTE_REASONS` slug (required for waste). */
      reason?: string;
      /** waste only: the client-minted idempotency key (a ULID); a replay converges to one event. */
      event_id?: string;
      /** waste only: ISO date (YYYY-MM-DD) the toss happened (stamped at tap time). */
      occurred_at?: string;
    };

export interface PantryOpsVars {
  operations: PantryOp[];
}

export interface PantryVerifyVars {
  items: string[];
}

export interface FavoriteVars {
  slug: string;
  favorite: boolean;
}

export interface PlanOpsVars {
  ops: PlanOp[];
}

export interface LogAddVars {
  type: "recipe" | "ready_to_eat" | "ad_hoc";
  /** Which meal this cook was; POST /api/log validates and stores it (omitted = NULL). */
  meal?: "breakfast" | "lunch" | "dinner" | "project";
  recipe?: string;
  name?: string;
  date: string;
}

export interface LogRemoveVars {
  id: number;
}

export interface NoteAddVars {
  slug: string;
  body: string;
  tags: string[];
  private: boolean;
  /** Client-minted — the idempotency key (D8): a replayed delivery upserts, not duplicates. */
  created_at: string;
}

export interface NoteEditVars {
  slug: string;
  created_at: string;
  body: string;
}

export interface NoteRemoveVars {
  slug: string;
  created_at: string;
}

export interface VibeAddVars {
  vibe: string;
  /** Which meal's palette (breakfast | lunch | dinner) — the add form's first field.
   *  Omitted defaults 'dinner' server-side. */
  meal?: "breakfast" | "lunch" | "dinner";
  facets: Record<string, unknown>;
  cadence_days: number;
  pinned: boolean;
  season: string[];
  weather_affinity: string[];
}

export interface VibeRemoveVars {
  id: string;
}

export interface ProposalConfirmVars {
  id: string;
  accept: boolean;
}

// --- shared plumbing ----------------------------------------------------------------

async function okOrThrow(res: { ok: boolean; status: number; json(): Promise<unknown> }): Promise<void> {
  if (!res.ok) throw await apiError(res);
}

function messageOf(err: unknown, fallback: string): string {
  const e = err as Partial<ApiError> | null;
  return typeof e?.message === "string" && e.message ? e.message : fallback;
}

/** One registry row: the defaults registered under a mutationKey. The client stores
 *  defaults untyped (keyed by mutationKey), so rows carry their own precise function
 *  annotations and registration casts once — the typed per-op hooks below are the
 *  call-site contract. */
interface RegistryRow {
  key: readonly string[];
  defaults: object;
}

type MutationDefaults = Parameters<QueryClient["setMutationDefaults"]>[1];

const norm = (name: string) => name.trim().toLowerCase();

/** Optimistically drop a name from both to-buy view variants (enriched + plain). */
function dropToBuyLine(qc: QueryClient, name: string): void {
  for (const variant of ["enriched", "plain"]) {
    qc.setQueryData<ToBuyView>(["grocery", "to-buy", variant], (cur) =>
      cur ? { ...cur, to_buy: cur.to_buy.filter((l) => norm(l.name) !== norm(name)) } : cur,
    );
  }
}

/**
 * Build the registry (one row per REGISTERED_MUTATION_KEYS entry — asserted below).
 * Optimism follows D4: grocery add/set/remove and the favorite flip edit the cache in
 * onMutate (the checked-off row must LOOK checked in airplane mode); everything else
 * relies on the settle-time invalidations (offline, the queued write + the pill are
 * the feedback). Error copy mirrors the strings the pages toast today.
 */
function registryRows(qc: QueryClient): RegistryRow[] {
  return [
    {
      key: ["grocery", "add"],
      defaults: {
        mutationFn: async (vars: GroceryAddVars) =>
          okOrThrow(await api.api.grocery.items.$post({ json: vars })),
        onMutate: (vars: GroceryAddVars) => {
          // Upsert into the stored rows (explicit-set semantics: an existing canonical
          // row keeps its status; a new one lands active) so in-cart math stays right…
          qc.setQueryData<{ items: GroceryRow[] }>(["grocery"], (cur) => {
            if (!cur) return cur;
            if (cur.items.some((i) => norm(i.name) === norm(vars.name))) return cur;
            const row: GroceryRow = {
              name: vars.name,
              quantity: vars.quantity ?? "1",
              kind: "grocery",
              domain: "grocery",
              status: "active",
              source: vars.source ?? "user",
              for_recipes: vars.for_recipes ?? [],
              note: vars.note ?? null,
              added_at: new Date().toISOString().slice(0, 10),
              ordered_at: null,
            };
            return { items: [...cur.items, row] };
          });
          // …and surface the line on the rendered to-buy view (a derived line it
          // materializes flips to origin "both"; a brand-new name appends as "list").
          for (const variant of ["enriched", "plain"]) {
            qc.setQueryData<ToBuyView>(["grocery", "to-buy", variant], (cur) => {
              if (!cur) return cur;
              const existing = cur.to_buy.find((l) => norm(l.name) === norm(vars.name));
              if (existing) {
                return {
                  ...cur,
                  to_buy: cur.to_buy.map((l) =>
                    norm(l.name) === norm(vars.name) && l.origin === "plan"
                      ? { ...l, origin: "both" as const }
                      : l,
                  ),
                };
              }
              const line = {
                name: vars.name,
                quantity: 1,
                assumed_quantity: !vars.quantity,
                for_recipes: vars.for_recipes ?? [],
                origin: "list" as const,
                key: norm(vars.name),
                kind: "grocery" as const,
                domain: "grocery",
                note: vars.note ?? null,
              };
              return { ...cur, to_buy: [...cur.to_buy, line] };
            });
          }
          qc.setQueryData<GroceryListData>(["grocery", "view"], (cur) => {
            if (!cur) return cur;
            const key = norm(vars.name);
            const found = cur.lines.find((line) => norm(line.name) === key);
            if (found)
              return {
                ...cur,
                lines: cur.lines.map((line) =>
                  line === found ? { ...line, origin: line.origin === "plan" ? "both" : line.origin } : line,
                ),
              };
            const line: GroceryListData["lines"][number] = {
              key,
              name: vars.name,
              quantity: vars.quantity ?? "1",
              kind: "grocery",
              domain: "grocery",
              origin: "list",
              checked_at: null,
              row_version: 1,
              updated_at: new Date().toISOString(),
              note: vars.note ?? null,
              for_recipes: vars.for_recipes ?? [],
            };
            const to_buy = [...cur.to_buy, key];
            return {
              ...cur,
              lines: [...cur.lines, line],
              to_buy,
              counts: { ...cur.counts, to_buy: to_buy.length },
            };
          });
        },
        onError: (err: unknown) => toast(messageOf(err, "Couldn't add the item — try again")),
        onSettled: () => qc.invalidateQueries({ queryKey: ["grocery"] }),
      },
    },
    {
      key: ["grocery", "set"],
      defaults: {
        mutationFn: async ({ name, ...patch }: GrocerySetVars) => {
          // Built as a variable (the codebase's hc idiom): the route reads its body
          // directly, so the typed client's args carry no `json` member.
          const args = { param: { name }, json: patch };
          return okOrThrow(await api.api.grocery.items[":name"].$patch(args));
        },
        onMutate: (vars: GrocerySetVars) => {
          qc.setQueryData<{ items: GroceryRow[] }>(["grocery"], (cur) =>
            cur
              ? {
                  items: cur.items.map((i) =>
                    norm(i.name) === norm(vars.name)
                      ? {
                          ...i,
                          ...(vars.status ? { status: vars.status } : {}),
                          ...(vars.quantity !== undefined ? { quantity: vars.quantity } : {}),
                          ...(vars.note !== undefined ? { note: vars.note } : {}),
                        }
                      : i,
                  ),
                }
              : cur,
          );
          // A check-off leaves the to-buy list immediately (the airplane-mode truth);
          // the un-cart direction re-derives on the settle-time refetch instead of
          // fabricating a derived line client-side.
          if (vars.status === "in_cart" || vars.status === "ordered") dropToBuyLine(qc, vars.name);
        },
        onError: (err: unknown) => toast(messageOf(err, "Couldn't update the item — try again")),
        onSettled: () => qc.invalidateQueries({ queryKey: ["grocery"] }),
      },
    },
    {
      key: ["grocery", "remove"],
      defaults: {
        mutationFn: async ({ name }: GroceryRemoveVars) =>
          okOrThrow(await api.api.grocery.items[":name"].$delete({ param: { name } })),
        onMutate: (vars: GroceryRemoveVars) => {
          qc.setQueryData<{ items: GroceryRow[] }>(["grocery"], (cur) =>
            cur ? { items: cur.items.filter((i) => norm(i.name) !== norm(vars.name)) } : cur,
          );
          // Removing an explicit row the plan still needs un-pins (back to a virtual
          // line), it does not un-plan — mirror that: "both" reverts to "plan",
          // a plain "list" line disappears.
          for (const variant of ["enriched", "plain"]) {
            qc.setQueryData<ToBuyView>(["grocery", "to-buy", variant], (cur) =>
              cur
                ? {
                    ...cur,
                    to_buy: cur.to_buy.flatMap((l) => {
                      if (norm(l.name) !== norm(vars.name)) return [l];
                      if (l.origin === "both") return [{ ...l, origin: "plan" as const }];
                      if (l.origin === "plan") return [l];
                      return [];
                    }),
                  }
                : cur,
            );
          }
          qc.setQueryData<GroceryListData>(["grocery", "view"], (cur) => {
            if (!cur) return cur;
            const target = cur.lines.find((line) => norm(line.name) === norm(vars.name));
            if (!target) return cur;
            const keep = target.origin === "both";
            const lines = keep
              ? cur.lines.map((line) =>
                  line === target ? { ...line, origin: "plan" as const, row_version: 0 } : line,
                )
              : cur.lines.filter((line) => line !== target);
            const to_buy = keep ? cur.to_buy : cur.to_buy.filter((key) => key !== target.key);
            return {
              ...cur,
              lines,
              to_buy,
              counts: {
                ...cur.counts,
                to_buy: to_buy.length,
                checked: lines.filter((line) => line.checked_at != null).length,
              },
            };
          });
        },
        onError: (err: unknown) => toast(messageOf(err, "Couldn't remove the item — try again")),
        onSettled: () => qc.invalidateQueries({ queryKey: ["grocery"] }),
      },
    },
    {
      key: ["grocery", "checked"],
      defaults: {
        mutationFn: async (vars: GroceryCheckedVars): Promise<GroceryListData> => {
          const res = await api.api.grocery.checked.$post({ json: vars });
          if (!res.ok) throw await apiError(res);
          return ((await res.json()) as { snapshot: GroceryListData }).snapshot;
        },
        onMutate: (vars: GroceryCheckedVars) => {
          qc.setQueryData<GroceryListData>(["grocery", "view"], (cur) => {
            if (!cur) return cur;
            const lines = cur.lines.map((line) =>
              line.key === vars.key
                ? {
                    ...line,
                    checked_at: vars.checked ? (vars.occurred_at ?? new Date().toISOString()) : null,
                    row_version: line.row_version + 1,
                  }
                : line,
            );
            const to_buy = vars.checked
              ? cur.to_buy.filter((key) => key !== vars.key)
              : [...new Set([...cur.to_buy, vars.key])];
            return {
              ...cur,
              lines,
              to_buy,
              counts: {
                ...cur.counts,
                to_buy: to_buy.length,
                checked: lines.filter((line) => line.checked_at != null).length,
              },
            };
          });
        },
        onSuccess: (snapshot: GroceryListData) => qc.setQueryData(["grocery", "view"], snapshot),
        onError: (err: ApiError) => {
          const snapshot = err.context?.snapshot as GroceryListData | undefined;
          if (snapshot) qc.setQueryData(["grocery", "view"], snapshot);
          toast(messageOf(err, "Couldn't update the check mark"));
        },
        onSettled: () => qc.invalidateQueries({ queryKey: ["grocery"] }),
      },
    },
    {
      key: ["grocery", "coverage"],
      defaults: {
        mutationFn: async (vars: GroceryCoverageVars): Promise<GroceryListData> => {
          const res = await api.api.grocery.coverage.$post({ json: vars });
          if (!res.ok) throw await apiError(res);
          return ((await res.json()) as { snapshot: GroceryListData }).snapshot;
        },
        onMutate: (vars: GroceryCoverageVars) =>
          qc.setQueryData<GroceryListData>(["grocery", "view"], (cur) =>
            cur
              ? vars.enabled
                ? {
                    ...cur,
                    pantry_covered: cur.pantry_covered.filter((line) => line.key !== vars.key),
                    lines: cur.lines.some((line) => line.key === vars.key)
                      ? cur.lines
                      : [
                          ...cur.lines,
                          {
                            key: vars.key,
                            name:
                              vars.name ??
                              cur.pantry_covered.find((line) => line.key === vars.key)?.name ??
                              vars.key,
                            quantity: 1,
                            kind: "grocery",
                            domain: "grocery",
                            origin: "list",
                            checked_at: null,
                            row_version: 1,
                            updated_at: new Date().toISOString(),
                            for_recipes:
                              cur.pantry_covered.find((line) => line.key === vars.key)?.for_recipes ?? [],
                          },
                        ],
                    to_buy: [...new Set([...cur.to_buy, vars.key])],
                    counts: { ...cur.counts, to_buy: new Set([...cur.to_buy, vars.key]).size },
                  }
                : {
                    ...cur,
                    lines: cur.lines.filter((line) => line.key !== vars.key),
                    to_buy: cur.to_buy.filter((key) => key !== vars.key),
                    pantry_covered: cur.pantry_covered.some((line) => line.key === vars.key)
                      ? cur.pantry_covered
                      : [
                          ...cur.pantry_covered,
                          {
                            key: vars.key,
                            name: vars.name ?? vars.key,
                            for_recipes: [],
                            freshness: "covered",
                            on_hand: {},
                            buy_anyway: false,
                          },
                        ],
                    counts: { ...cur.counts, to_buy: cur.to_buy.filter((key) => key !== vars.key).length },
                  }
              : cur,
          ),
        onSuccess: (snapshot: GroceryListData) => qc.setQueryData(["grocery", "view"], snapshot),
        onError: (err: unknown) => toast(messageOf(err, "Couldn't update pantry coverage")),
        onSettled: () =>
          Promise.all([
            qc.invalidateQueries({ queryKey: ["grocery"] }),
            qc.invalidateQueries({ queryKey: ["pantry"] }),
          ]),
      },
    },
    {
      key: ["grocery", "substitution"],
      defaults: {
        mutationFn: async (vars: GrocerySubstitutionVars): Promise<GroceryListData> => {
          const res = await api.api.grocery.substitution.$post({ json: vars });
          if (!res.ok) throw await apiError(res);
          return ((await res.json()) as { snapshot: GroceryListData }).snapshot;
        },
        onMutate: (vars: GrocerySubstitutionVars) =>
          qc.setQueryData<GroceryListData>(["grocery", "view"], (cur) =>
            cur
              ? !vars.undo
                ? {
                    ...cur,
                    lines: [
                      ...cur.lines.filter(
                        (line) => line.key !== vars.original_key && line.key !== vars.replacement_key,
                      ),
                      {
                        ...(cur.lines.find((line) => line.key === vars.original_key) ?? {
                          quantity: 1,
                          kind: "grocery",
                          domain: "grocery",
                          origin: "list",
                          checked_at: null,
                          row_version: 0,
                          updated_at: null,
                          for_recipes: [],
                        }),
                        key: vars.replacement_key,
                        name: vars.replacement_name,
                        row_version: 1,
                      },
                    ],
                    to_buy: [...cur.to_buy.filter((key) => key !== vars.original_key), vars.replacement_key],
                  }
                : cur
              : cur,
          ),
        onSuccess: (snapshot: GroceryListData) => qc.setQueryData(["grocery", "view"], snapshot),
        onError: (err: unknown) => toast(messageOf(err, "Couldn't update the substitution")),
        onSettled: () => qc.invalidateQueries({ queryKey: ["grocery"] }),
      },
    },
    {
      key: ["grocery", "relist"],
      defaults: {
        mutationFn: async (vars: GroceryRelistVars): Promise<GroceryListData> => {
          const res = await api.api.grocery.relist.$post({ json: vars });
          if (!res.ok) throw await apiError(res);
          return ((await res.json()) as { snapshot: GroceryListData }).snapshot;
        },
        onMutate: (vars: GroceryRelistVars) =>
          qc.setQueryData<GroceryListData>(["grocery", "view"], (cur) => {
            if (!cur) return cur;
            return {
              ...cur,
              lines: [
                ...cur.lines,
                ...cur.in_cart_groups.flatMap((group) =>
                  group.send_id === vars.send_id
                    ? group.lines
                        .filter((line) => line.key === vars.line_key)
                        .map((line) => ({
                          key: line.key,
                          name: line.name,
                          quantity: line.quantity,
                          kind: "grocery" as const,
                          domain: "grocery",
                          origin: "list" as const,
                          checked_at: null,
                          row_version: line.row_version + 1,
                          updated_at: new Date().toISOString(),
                          for_recipes: [],
                        }))
                    : [],
                ),
              ],
              to_buy: [...new Set([...cur.to_buy, vars.line_key])],
              counts: {
                ...cur.counts,
                to_buy: new Set([...cur.to_buy, vars.line_key]).size,
                in_carts: Math.max(0, cur.counts.in_carts - 1),
              },
              in_cart_groups: cur.in_cart_groups.map((group) =>
                group.send_id === vars.send_id
                  ? { ...group, lines: group.lines.filter((line) => line.key !== vars.line_key) }
                  : group,
              ),
            };
          }),
        onSuccess: (snapshot: GroceryListData) => qc.setQueryData(["grocery", "view"], snapshot),
        onError: (err: ApiError) => {
          const snapshot = err.context?.snapshot as GroceryListData | undefined;
          if (snapshot) qc.setQueryData(["grocery", "view"], snapshot);
          toast(messageOf(err, "Couldn't return the item to the list"));
        },
        onSettled: () => qc.invalidateQueries({ queryKey: ["grocery"] }),
      },
    },
    {
      key: ["pantry", "ops"],
      defaults: {
        mutationFn: async (vars: PantryOpsVars) => okOrThrow(await api.api.pantry.ops.$post({ json: vars })),
        onMutate: (vars: PantryOpsVars) => {
          // A removal — a plain `remove` (verification cleanup) or a `dispose` (Used /
          // Mark-as-waste) — drops the row optimistically so the disposition feels instant
          // and works offline (the tap-time truth before the settle-time refetch). `add`
          // upserts and `verify` restamps rely on the settle invalidation below.
          const dropped = new Set<string>();
          for (const o of vars.operations) {
            if (o.op === "remove" || o.op === "dispose") dropped.add(norm(o.name));
          }
          if (dropped.size === 0) return;
          qc.setQueryData<{ items: PantryRow[] }>(["pantry"], (cur) =>
            cur ? { items: cur.items.filter((i) => !dropped.has(norm(i.name))) } : cur,
          );
        },
        onError: (err: unknown) => toast(messageOf(err, "Couldn't update the pantry — try again")),
        onSettled: () =>
          Promise.all([
            qc.invalidateQueries({ queryKey: ["pantry"] }),
            // Pantry contents feed the to-buy view's coverage — refresh both areas.
            qc.invalidateQueries({ queryKey: ["grocery"] }),
          ]),
      },
    },
    {
      key: ["pantry", "verify"],
      defaults: {
        mutationFn: async (vars: PantryVerifyVars) =>
          okOrThrow(await api.api.pantry.verify.$post({ json: vars })),
        onError: (err: unknown) => toast(messageOf(err, "Couldn't verify — try again")),
        onSettled: () =>
          Promise.all([
            qc.invalidateQueries({ queryKey: ["pantry"] }),
            qc.invalidateQueries({ queryKey: ["grocery"] }),
          ]),
      },
    },
    {
      key: ["overlay", "favorite"],
      defaults: {
        mutationFn: async (vars: FavoriteVars) =>
          okOrThrow(await api.api.overlay.favorite.$put({ json: vars })),
        onMutate: async (vars: FavoriteVars) => {
          // Cancel any in-flight overlay read FIRST. Without this, a GET /api/overlay already on
          // the wire when the click lands resolves AFTER this optimistic write and overwrites it
          // with the pre-click server value — the favorite silently flicking back to
          // un-favorited (the `["overlay"]` query is always mounted, so a stray refetch is common
          // e.g. the boot-time invalidate or refetch-on-focus). Snapshot for rollback, then flip.
          await qc.cancelQueries({ queryKey: ["overlay"] });
          const prev = qc.getQueryData<{ overlay: Overlay }>(["overlay"]);
          qc.setQueryData<{ overlay: Overlay }>(["overlay"], (cur) => {
            if (!cur) return cur;
            const next = { ...cur.overlay };
            if (vars.favorite) next[vars.slug] = { ...next[vars.slug], favorite: true, reject: undefined };
            else next[vars.slug] = { ...next[vars.slug], favorite: undefined };
            return { overlay: next };
          });
          return { prev };
        },
        onError: (
          err: unknown,
          _vars: FavoriteVars,
          ctx: { prev: { overlay: Overlay } | undefined } | undefined,
        ) => {
          // Roll the optimistic flip back to the pre-click cache before surfacing the failure.
          // (A mutation resumed after a reload carries its persisted, now-stale snapshot as
          // context; rolling back to it is harmless because the onSettled invalidate below
          // re-derives the truth from the server.)
          if (ctx && ctx.prev !== undefined) qc.setQueryData(["overlay"], ctx.prev);
          toast(messageOf(err, "Couldn't update favorites — try again"));
        },
        onSettled: () =>
          Promise.all([
            qc.invalidateQueries({ queryKey: ["overlay"] }),
            // Picked-for-you is a pure function of the favorites set — recompute it.
            qc.invalidateQueries({ queryKey: ["cookbook", "picked-for-you"] }),
          ]),
      },
    },
    {
      key: ["plan", "ops"],
      defaults: {
        // Returns the parsed `{applied, conflicts}` (HTTP 200 even with conflicts) so a
        // call-site `onSuccess` can gate its toast on `conflicts.length` — a swallowed
        // conflict would otherwise read as a false success (a silent no-op).
        mutationFn: async (vars: PlanOpsVars): Promise<PlanOpsResult> => {
          const res = await api.api.plan.ops.$post({ json: vars });
          if (!res.ok) throw await apiError(res);
          return (await res.json()) as PlanOpsResult;
        },
        onError: (err: unknown) => toast(messageOf(err, "Couldn't update the plan — try again")),
        onSettled: () =>
          Promise.all([
            qc.invalidateQueries({ queryKey: ["plan"] }),
            qc.invalidateQueries({ queryKey: ["cookbook", "new-for-me"] }),
          ]),
      },
    },
    {
      key: ["log", "add"],
      defaults: {
        mutationFn: async (vars: LogAddVars) => okOrThrow(await api.api.log.$post({ json: vars })),
        onError: (err: unknown) => toast(messageOf(err, "Couldn't log the cook — try again")),
        onSettled: () =>
          Promise.all([
            qc.invalidateQueries({ queryKey: ["log"] }),
            qc.invalidateQueries({ queryKey: ["plan"] }), // a cook clears its planned row
            qc.invalidateQueries({ queryKey: ["vibes"] }), // …and advances last_satisfied
          ]),
      },
    },
    {
      key: ["log", "remove"],
      defaults: {
        mutationFn: async ({ id }: LogRemoveVars) =>
          okOrThrow(await api.api.log[":id"].$delete({ param: { id: String(id) } })),
        onError: (err: unknown) => toast(messageOf(err, "Couldn't remove the entry — try again")),
        onSettled: () =>
          Promise.all([
            qc.invalidateQueries({ queryKey: ["log"] }),
            qc.invalidateQueries({ queryKey: ["vibes"] }), // derived recency heals organically
          ]),
      },
    },
    {
      key: ["notes", "add"],
      defaults: {
        mutationFn: async ({ slug, ...json }: NoteAddVars) => {
          const args = { param: { slug }, json };
          return okOrThrow(await api.api.cookbook.recipes[":slug"].notes.$post(args));
        },
        onError: (err: unknown) => toast(messageOf(err, "Couldn't add the note — try again")),
        onSettled: (_data: unknown, _err: unknown, vars: NoteAddVars) =>
          qc.invalidateQueries({ queryKey: ["cookbook", "notes", vars.slug] }),
      },
    },
    {
      key: ["notes", "edit"],
      defaults: {
        mutationFn: async ({ slug, created_at, body }: NoteEditVars) => {
          const args = { param: { slug, created_at }, json: { body } };
          return okOrThrow(await api.api.cookbook.recipes[":slug"].notes[":created_at"].$patch(args));
        },
        onError: (err: unknown) => toast(messageOf(err, "Couldn't save the note — try again")),
        onSettled: (_data: unknown, _err: unknown, vars: NoteEditVars) =>
          qc.invalidateQueries({ queryKey: ["cookbook", "notes", vars.slug] }),
      },
    },
    {
      key: ["notes", "remove"],
      defaults: {
        mutationFn: async ({ slug, created_at }: NoteRemoveVars) =>
          okOrThrow(
            await api.api.cookbook.recipes[":slug"].notes[":created_at"].$delete({
              param: { slug, created_at },
            }),
          ),
        onError: (err: unknown) => toast(messageOf(err, "Couldn't remove the note — try again")),
        onSettled: (_data: unknown, _err: unknown, vars: NoteRemoveVars) =>
          qc.invalidateQueries({ queryKey: ["cookbook", "notes", vars.slug] }),
      },
    },
    {
      key: ["vibes", "add"],
      defaults: {
        mutationFn: async (vars: VibeAddVars) => okOrThrow(await api.api.vibes.$post({ json: vars })),
        onError: (err: unknown) => {
          const e = err as Partial<ApiError>;
          toast(e?.error === "conflict" ? "You already have a vibe like that" : "Couldn't add the vibe");
        },
        onSettled: () => qc.invalidateQueries({ queryKey: ["vibes"] }),
      },
    },
    {
      key: ["vibes", "remove"],
      defaults: {
        mutationFn: async ({ id }: VibeRemoveVars) =>
          okOrThrow(await api.api.vibes[":id"].$delete({ param: { id } })),
        onError: (err: unknown) => toast(messageOf(err, "Couldn't remove the vibe — try again")),
        onSettled: () => qc.invalidateQueries({ queryKey: ["vibes"] }),
      },
    },
    {
      key: ["proposals", "confirm"],
      defaults: {
        mutationFn: async ({ id, accept }: ProposalConfirmVars) => {
          const args = { param: { id }, json: { accept } };
          const res = await api.api.vibes.proposals[":id"].confirm.$post(args);
          // 409 = already resolved elsewhere — converged either way (D12), not an error.
          if (!res.ok && res.status !== 409) throw await apiError(res);
        },
        onError: (err: unknown) => toast(messageOf(err, "Couldn't resolve the suggestion — try again")),
        onSettled: () =>
          Promise.all([
            qc.invalidateQueries({ queryKey: ["proposals"] }),
            qc.invalidateQueries({ queryKey: ["vibes"] }),
          ]),
      },
    },
  ];
}

/**
 * Install the registry's defaults on the client. Called from main.tsx BEFORE render
 * (and therefore before restore): resumed mutations re-bind to these by key.
 */
export function registerMutationDefaults(qc: QueryClient): void {
  const rows = registryRows(qc);
  // The registry and the persistence allowlist are ONE set — drift is a bug.
  const want = new Set(REGISTERED_MUTATION_KEYS.map((k) => JSON.stringify(k)));
  const have = new Set(rows.map((r) => JSON.stringify(r.key)));
  if (want.size !== have.size || [...want].some((k) => !have.has(k))) {
    throw new Error("mutation registry drift: lib/mutations.ts rows != persist.ts REGISTERED_MUTATION_KEYS");
  }
  for (const row of rows) {
    // ONE shared mutation scope serializes every class (b) write — in flight AND on
    // replay (the spec's "replays are serial, in order": resumePausedMutations alone
    // continues concurrently; the scope's canRun gate is what enforces the order).
    // It also lets dependent fire-and-forget pairs (materialize → set in-cart) queue
    // back-to-back without racing. Scope is dehydrated with the mutation, so the
    // ordering survives a reload.
    qc.setMutationDefaults(
      row.key as string[],
      {
        scope: { id: "class-b-writes" },
        ...row.defaults,
      } as MutationDefaults,
    );
  }
}

// --- the typed per-op hooks (thin useMutation({ mutationKey }) wrappers) ------------
// Call sites fire `mutate` and STOP AWAITING network settle for UI progression:
// offline the mutation pauses and the optimistic update (or the pending queue + the
// offline pill) is the feedback. mutate-level callbacks (per-site success toasts) run
// only while the component is mounted and do NOT survive a reload — never put
// correctness in them.

export function useGroceryAdd() {
  return useMutation<void, ApiError, GroceryAddVars>({ mutationKey: ["grocery", "add"] });
}

export function useGrocerySet() {
  return useMutation<void, ApiError, GrocerySetVars>({ mutationKey: ["grocery", "set"] });
}

export function useGroceryRemove() {
  return useMutation<void, ApiError, GroceryRemoveVars>({ mutationKey: ["grocery", "remove"] });
}
export function useGroceryChecked() {
  return useMutation<GroceryListData, ApiError, GroceryCheckedVars>({ mutationKey: ["grocery", "checked"] });
}
export function useGroceryCoverage() {
  return useMutation<GroceryListData, ApiError, GroceryCoverageVars>({
    mutationKey: ["grocery", "coverage"],
  });
}
export function useGrocerySubstitution() {
  return useMutation<GroceryListData, ApiError, GrocerySubstitutionVars>({
    mutationKey: ["grocery", "substitution"],
  });
}
export function useGroceryRelist() {
  return useMutation<GroceryListData, ApiError, GroceryRelistVars>({ mutationKey: ["grocery", "relist"] });
}

export function usePantryOps() {
  return useMutation<void, ApiError, PantryOpsVars>({ mutationKey: ["pantry", "ops"] });
}

export function usePantryVerify() {
  return useMutation<void, ApiError, PantryVerifyVars>({ mutationKey: ["pantry", "verify"] });
}

/** EXPLICIT favorite set (never a toggle — D8): the caller computes the target state. */
export function useSetFavorite() {
  return useMutation<void, ApiError, FavoriteVars>({ mutationKey: ["overlay", "favorite"] });
}

/** Row-level plan ops (class (b), keyed by the client-minted plan-row id). Resolves to the
 *  parsed `{applied, conflicts}` so call sites surface conflicts instead of false successes. */
export function usePlanOps() {
  return useMutation<PlanOpsResult, ApiError, PlanOpsVars>({ mutationKey: ["plan", "ops"] });
}

export function useLogAdd() {
  return useMutation<void, ApiError, LogAddVars>({ mutationKey: ["log", "add"] });
}

export function useLogRemove() {
  return useMutation<void, ApiError, LogRemoveVars>({ mutationKey: ["log", "remove"] });
}

export function useNoteAdd() {
  return useMutation<void, ApiError, NoteAddVars>({ mutationKey: ["notes", "add"] });
}

export function useNoteEdit() {
  return useMutation<void, ApiError, NoteEditVars>({ mutationKey: ["notes", "edit"] });
}

export function useNoteRemove() {
  return useMutation<void, ApiError, NoteRemoveVars>({ mutationKey: ["notes", "remove"] });
}

export function useVibeAdd() {
  return useMutation<void, ApiError, VibeAddVars>({ mutationKey: ["vibes", "add"] });
}

export function useVibeRemove() {
  return useMutation<void, ApiError, VibeRemoveVars>({ mutationKey: ["vibes", "remove"] });
}

export function useProposalConfirm() {
  return useMutation<void, ApiError, ProposalConfirmVars>({ mutationKey: ["proposals", "confirm"] });
}
