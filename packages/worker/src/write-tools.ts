// Repo-data write tools (data-write-tools capability). Each tool reads the
// current file/rows, applies a pure transform, and persists via a single-object R2 put
// through the corpus store (validated first) for shared recipe markdown, or D1 rows for
// per-tenant state. Objective recipe content is shared (R2 corpus); a recipe's subjective
// disposition (favorite/hide/none) is per-tenant and routes to the caller's D1 overlay via
// `set_recipe_disposition` (`toggle_favorite`/`toggle_reject` are one-window dispatch
// aliases); the pantry is the D1 `pantry` table (src/session-db.ts), which also carries
// the kitchen-equipment operations (kitchen-equipment). No tool here
// writes a Kroger cart or calls an external service.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "./env.js";
import { db } from "./db.js";
import { type CorpusStore, readCorpusFile } from "./corpus-store.js";
import { enqueueNovelTerms, ingredientContext } from "./corpus-db.js";
import { brandKey } from "./matching.js";
import { parseMarkdown } from "./parse.js";
import { serializeMarkdown } from "./serialize.js";
import { ToolError, runTool } from "./errors.js";
import { applyOverlayEdit, type OverlayRow } from "./overlay.js";
import { applyKitchenOperations, type KitchenOperation } from "./kitchen.js";
import {
  applyRetiredKeyShim,
  convertLegacyBrandRanks,
  mergePatch,
  rejectUnknownPatchKeys,
  validatePreferences,
  type DeprecationWarning,
} from "./preferences.js";
import {
  readProfile,
  readPreferences,
  readOverlay,
  setOverlay,
  setKitchen,
  setProfileFields,
  profileUpsertStmt,
  brandStmt,
} from "./profile-db.js";
import { applyPantryRowOps } from "./session-db.js";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * The subjective recipe fields — the caller's per-tenant disposition, routed through
 * `set_recipe_disposition` to the D1 overlay table rather than the shared recipe.
 * Retained (with `buildRecipeUpdate`) for the fast-follow admin merge screen's
 * objective-only guard over the retained create/update operation core; the retired
 * `status`/`rating` keys stay listed so a stale caller's patch is steered away from
 * writing them as objective content.
 */
export const SUBJECTIVE_KEYS = ["favorite", "reject", "rating", "status"] as const;

// --- file-level builders (return a TreeFile for the atomic commit) -----------

/** Build an objective-content update for a shared recipe (root `recipes/<slug>.md`). */
export async function buildRecipeUpdate(
  store: CorpusStore,
  env: Env,
  slug: string,
  updates: Record<string, unknown>,
): Promise<{ path: string; content: string }> {
  if (!SLUG_RE.test(slug)) throw new ToolError("not_found", `Unknown recipe slug: ${slug}`, { slug });
  const path = `recipes/${slug}.md`;
  const text = await readCorpusFile(store, path, "not_found", `Unknown recipe slug: ${slug}`);
  const { frontmatter, body } = parseMarkdown(text, path);
  const merged = { ...frontmatter, ...updates };
  // perishable_ingredients and ingredients_key are objective shared content;
  // canonicalize the names at WRITE the same way the verify matcher does, so stored
  // names are canonical and cross-recipe overlap (waste detection + the pantry-overlap
  // re-rank) lines up. Only when the caller is writing the field — a non-array passes
  // through unchanged for the contract validator to reject.
  if ("perishable_ingredients" in updates || "ingredients_key" in updates) {
    // Route through the one ingredient funnel: resolveList canonicalizes exactly like
    // normalizeIngredientList AND best-effort-captures any novel surface form for the cron.
    const ctx = await ingredientContext(env);
    if ("perishable_ingredients" in updates)
      merged.perishable_ingredients = ctx.resolveList(merged.perishable_ingredients);
    if ("ingredients_key" in updates)
      merged.ingredients_key = ctx.resolveList(merged.ingredients_key);
  }
  // The full required-field contract is enforced on the serialized (merged) content by
  // the update_recipe handler's validateFile step BEFORE the R2 put (the commit engine
  // used to do this) — so a one-field patch on a compliant recipe passes while an edit
  // that strips or empties a required field, or sets an off-vocabulary value, is rejected
  // (validation_failed) and nothing is written.
  return { path, content: serializeMarkdown(merged, body) };
}

/** Profile markdown fields written to the D1 `profile` row (preferences uses merge-patch). */
export const PROFILE_MARKDOWN_FIELDS = {
  taste: "taste",
  diet_principles: "diet_principles",
} as const;

/**
 * The `update_preferences` apply as a shared operation (member-app-core D2):
 * reject-unknown-keys + RFC 7396 merge-patch + result validation + the atomic
 * profile-columns/brands batch. Called by the MCP tool and the member API's
 * `PATCH /api/profile/preferences`. Throws structured `validation_failed` /
 * `malformed_data`; stores nothing on failure. A success return may carry
 * `warnings` (the D21 deprecation convention): entries for patch values that were
 * accepted under a deprecated shape and converted.
 */
export async function applyPreferencesPatch(
  env: Env,
  tenant: string,
  patch: Record<string, unknown>,
): Promise<{ updated: "preferences"; warnings?: DeprecationWarning[] }> {
  // Stage 0 (D21, one deprecation window, BEFORE rejectUnknownPatchKeys): retired keys
  // (lunch_strategy / ready_to_eat_default_action) are accepted-and-dropped — never
  // validation_failed, never the nest-under-custom hint, nothing written — and
  // `default_cooking_nights: N` is aliased onto cadence.dinner (the frozen column is
  // never written). Each conversion lands in `warnings`.
  const shim = applyRetiredKeyShim(patch);
  patch = shim.patch;

  // Stage 1: reject unknown top-level patch keys (authorship-time signal).
  rejectUnknownPatchKeys(patch);

  // Stage 1b: normalize the brands patch BEFORE the merge, so patch keys land on the
  // stored keys and a legacy value converts ahead of validation.
  // - Key each family on the matcher's lookup form — brandKey(canonical id) — so a
  //   write lands on the SAME key the matcher reads (`deps.brands[brandKey(normalizeIngredient(x))]`)
  //   AND a partial family patch merges into the stored family instead of forking a
  //   sibling key. A raw multi-word term ("ground beef") otherwise stored as
  //   "ground beef" but was read as "ground_beef" — a silent miss.
  // - One-window deprecated-shape shim (D21): a legacy `string[]` value is
  //   accepted-and-converted by the migration mapping (never dropped, never bounced),
  //   with a `warnings` entry steering the stale caller to `{ tiers, any_brand }`.
  //   When the window closes, drop this conversion — validatePreferences then rejects
  //   an array value as `malformed_data` like any other type error.
  const warnings: DeprecationWarning[] = [...shim.warnings];
  let brandsPatch: Record<string, unknown> | undefined;
  let novelIds: string[] = [];
  if (patch.brands !== null && patch.brands !== undefined && typeof patch.brands === "object" && !Array.isArray(patch.brands)) {
    // Resolve-only (capture: false): this runs BEFORE validation, and a rejected
    // patch must store nothing — including novel-term queue rows. The write-path
    // capture happens after validation passes (below).
    const ctx = await ingredientContext(env, { capture: false });
    brandsPatch = {};
    const resolvedIds: string[] = [];
    for (const [term, value] of Object.entries(patch.brands as Record<string, unknown>)) {
      const id = ctx.resolve(term);
      resolvedIds.push(id);
      const key = brandKey(id);
      if (Array.isArray(value) && value.every((s) => typeof s === "string")) {
        brandsPatch[key] = convertLegacyBrandRanks(value as string[]);
        warnings.push({
          key: `brands.${term}`,
          reason: "deprecated_shape",
          superseded_by: "{ tiers, any_brand }",
        });
      } else {
        brandsPatch[key] = value;
      }
    }
    patch = { ...patch, brands: brandsPatch };
    novelIds = [...new Set(resolvedIds.filter((id) => id && !ctx.resolver.ids.has(id)))];
  }

  // Stage 2: deep-merge over the current preferences; validate the result's types.
  const current = (await readPreferences(env, tenant)) ?? {};
  const merged = mergePatch(current, patch) as Record<string, unknown>;
  validatePreferences(merged);

  // The patch survived validation — NOW capture its novel ingredient terms for the
  // graph (the write-path capture, deferred past validation so a rejected patch
  // enqueues nothing). enqueueNovelTerms is best-effort and never throws.
  if (novelIds.length > 0) await enqueueNovelTerms(env, novelIds);

  // Stage 3: apply atomically (one batch). Scalar/JSON columns come from the MERGED
  // result. Brands rows: the terms come from the PATCH (a `null` vanishes from the
  // merged object, so the patch is the only place the delete intent survives), but an
  // UPSERT writes the MERGED family value — a partial family patch (`{ any_brand: true }`)
  // must not clobber the stored sibling field.
  // The frozen columns (`default_cooking_nights`, `lunch_strategy`,
  // `ready_to_eat_default_action`) are DELIBERATELY absent: no writer post-0052 — the
  // scalar stays readable for the cadence fallback, the retired pair converges to NULL
  // via the pref-retirement cron, and all three drop at window close.
  const stmts: D1PreparedStatement[] = [];
  const profileFields: Record<string, unknown> = {
    cadence: "cadence" in merged ? JSON.stringify(merged.cadence) : null,
    planning_cadence_days:
      "planning_cadence_days" in merged ? merged.planning_cadence_days : null,
    weekly_budget: "weekly_budget" in merged ? merged.weekly_budget : null,
    stores: "stores" in merged ? JSON.stringify(merged.stores) : null,
    dietary: "dietary" in merged ? JSON.stringify(merged.dietary) : null,
    rotation: "rotation" in merged ? JSON.stringify(merged.rotation) : null,
    custom: "custom" in merged ? JSON.stringify(merged.custom) : null,
    // Household-scoped curated-tier hide (visibility lens): a boolean over the
    // profile.curated_hide column; deleting the key (null patch) clears back to shown.
    curated_hide: "curated_hide" in merged ? (merged.curated_hide === true ? 1 : 0) : null,
  };
  const profileStmt = profileUpsertStmt(env, tenant, profileFields);
  if (profileStmt) stmts.push(profileStmt);

  if (brandsPatch) {
    const mergedBrands = (merged.brands ?? {}) as Record<string, Record<string, unknown>>;
    for (const [key, value] of Object.entries(brandsPatch)) {
      stmts.push(brandStmt(env, tenant, key, value === null ? null : mergedBrands[key]));
    }
  }
  if (stmts.length > 0) await db(env).batch(stmts);
  return warnings.length > 0 ? { updated: "preferences", warnings } : { updated: "preferences" };
}
// --- registration ------------------------------------------------------------

/**
 * `env` is D1: the `recipes` index (queried by `set_recipe_disposition` to validate a
 * slug), the profile tables (preferences/taste/diet/kitchen/overlay — via
 * src/profile-db.ts) AND the session-state pantry table (via src/session-db.ts).
 * meal_plan/grocery_list live in their own tool groups. This group no longer touches
 * the R2 corpus store directly — `update_recipe` (the one recipe-content write here)
 * left the MCP surface; `buildRecipeUpdate` takes its own `store` parameter for the
 * fast-follow admin merge screen (recipe-dedup D7) to call directly.
 */
export function registerWriteTools(
  server: McpServer,
  env: Env,
  username: string,
): void {

  // set_recipe_disposition (data-write-tools) resolves the slug against the shared
  // index, then applies a single overlay edit. The overlay carries two mutually-
  // exclusive marks — favorite (the positive taste signal) and reject (hide-from-me, a
  // hard gate) — the `status` lifecycle and `rating` were retired.
  const applyDisposition = async (slug: string, edit: OverlayRow): Promise<Record<string, unknown>> => {
    if (!SLUG_RE.test(slug)) throw new ToolError("not_found", `Unknown recipe slug: ${slug}`, { slug });
    const row = await db(env).first<{ ok: number }>(
      "SELECT 1 AS ok FROM recipes WHERE slug = ?1 LIMIT 1",
      slug,
    );
    if (!row) throw new ToolError("not_found", `Unknown recipe slug: ${slug}`, { slug });
    const current = await readOverlay(env, username);
    const next = applyOverlayEdit(current[slug], edit);
    await setOverlay(env, username, slug, next);
    return { slug, overlay: next ?? {} };
  };

  server.registerTool(
    "set_recipe_disposition",
    {
      description:
        "Set the caller's PERSONAL disposition on a recipe — `favorite` (THE positive taste signal: anchors the semantic-search nearest-liked re-rank and the group 'favorited by N others' signal on read_recipe_notes), `hide` (removes it from the caller's search_recipes results — a hard gate, both membership and ranked modes), or `none` (returns it to neutral/available). The three are mutually exclusive by construction — setting one clears the others. Writes only the caller's overlay — never the shared recipe, so one member's disposition never affects another's. Unknown slug → not_found. Returns { slug, overlay } (no commit_sha; the overlay is D1-backed).",
      inputSchema: { slug: z.string(), disposition: z.enum(["favorite", "hide", "none"]) },
    },
    ({ slug, disposition }) =>
      runTool(() => {
        const edit: OverlayRow =
          disposition === "favorite" ? { favorite: true } : disposition === "hide" ? { reject: true } : { favorite: false, reject: false };
        return applyDisposition(slug, edit);
      }),
  );

  // toggle_favorite / toggle_reject: one-deprecation-window dispatch aliases onto
  // set_recipe_disposition (mcp-tool-gating D3) — identical requests/responses, no
  // warnings injection. At window close they flip to app-plane-only registrations for
  // the recipe-card widget rather than being unregistered (design D2).
  server.registerTool(
    "toggle_favorite",
    {
      description:
        "Deprecated alias of set_recipe_disposition (favorite: true -> \"favorite\", false -> \"none\") for one deprecation window — identical behavior; prefer the new name. Set the caller's PERSONAL favorite flag for a recipe — `favorite: true` marks it a favorite, `false` clears it. Favorites are THE positive taste signal: they anchor the semantic-search nearest-liked re-rank and the group 'favorited by N others' signal (read_recipe_notes). Writes only the caller's overlay — never the shared recipe, so one member's favorites never affect another's. Unknown slug → not_found. Returns { slug, overlay } (no commit_sha; the overlay is D1-backed).",
      inputSchema: { slug: z.string(), favorite: z.boolean() },
    },
    ({ slug, favorite }) => runTool(() => applyDisposition(slug, { favorite })),
  );

  server.registerTool(
    "toggle_reject",
    {
      description:
        "Deprecated alias of set_recipe_disposition (reject: true -> \"hide\", false -> \"none\") for one deprecation window — identical behavior; prefer the new name. Hide a recipe from the CALLER — `reject: true` removes it from the caller's search_recipes results (a hard gate, both membership and ranked modes), `false` un-hides it back to the available default. Per-tenant: one member's reject never affects another's view, and it does NOT remove the shared recipe. Mutually exclusive with favorite (rejecting clears a favorite). Unknown slug → not_found. Returns { slug, overlay } (no commit_sha; the overlay is D1-backed).",
      inputSchema: { slug: z.string(), reject: z.boolean() },
    },
    ({ slug, reject }) => runTool(() => applyDisposition(slug, { reject })),
  );

  // update_pantry absorbs kitchen-equipment edits (kitchen-equipment) and pantry
  // verification (mark_pantry_verified's retired standalone tool — the `verify` op
  // below is the sole verification surface). `equip`/`unequip`/`set_kitchen_note` are
  // renamed op verbs so they never collide with the pantry `add`/`remove` ops in the
  // same operations array; they delegate to the unchanged kitchen apply path
  // (EQUIPMENT_VOCAB conflicts, idempotent equip, absent-unequip conflict).
  const PANTRY_OP_NAMES = new Set(["add", "remove", "verify", "dispose"]);
  const KITCHEN_OP_TO_INTERNAL: Record<string, KitchenOperation["op"]> = {
    equip: "add",
    unequip: "remove",
    set_kitchen_note: "set_note",
  };
  const KITCHEN_OP_FROM_INTERNAL: Record<KitchenOperation["op"], "equip" | "unequip" | "set_kitchen_note"> = {
    add: "equip",
    remove: "unequip",
    set_note: "set_kitchen_note",
  };

  server.registerTool(
    "update_pantry",
    {
      description:
        "Apply pantry add/remove/verify/dispose operations, plus kitchen-equipment operations. `add` is an upsert: re-adding an existing name merges into it (overlay incoming fields, preserve added_at, refresh last_verified_at) rather than duplicating; the result includes merged:true when this happens. " +
        "Items carry two orthogonal fields: `category`, the food taxonomy (produce | dairy | meat | seafood | grains | bakery | canned | condiments | oils | spices | baking | frozen | snacks | beverages), and `location`, where it's kept (fridge | freezer | pantry | spice_rack | counter | cabinet). Omit category to let the background classifier derive it — NULL reads as uncategorized, never an error. An off-vocabulary location is a conflict, never a silent write; an off-vocabulary category is accepted with the field dropped and a warning (legacy values pantry|fridge|freezer|spices are transposed onto location for one deprecation window). " +
        "`remove` is a plain correction/cleanup delete and records nothing. `verify` resets last_verified_at to today on the named item — the only verification surface. When food actually leaves the kitchen, use `dispose`: { op:'dispose', name, disposition: 'used'|'waste', reason?, event_id?, occurred_at? } removes the row, and 'waste' also records a waste event for the waste analyzer — reason is required for waste, exactly one of spoiled | moldy | over_ripe | expired | freezer_burned | stale | forgot | bought_too_much | never_opened | other. Disposition NEVER asks or accepts a dollar value — the event's value is derived later from purchase history, so never prompt the member for what an item cost. The event's analytics department is stamped at capture from the item's identity (a prepared/leftover row stamps 'leftovers'). `event_id` is an optional client-minted idempotency key — a replayed dispose with the same id converges to one event; omit it and the server mints one. `occurred_at` (YYYY-MM-DD) backdates the toss; default today. 'used' records nothing today (pure removal). " +
        "Kitchen-equipment ops: { op:'equip'|'unequip', slug } adds/removes an owned equipment slug — it MUST be a known vocabulary slug (pressure-cooker | sous-vide-circulator | blender | ice-cream-maker); an off-vocab equip is a conflict, never a silent write, and equipping an already-owned slug is idempotent (no-op, not a conflict); an unequip of an absent slug is a conflict. { op:'set_kitchen_note', key, value } sets a freeform kitchen note (oven count, pan sizes — cook-reasoning only, NEVER gates a recipe). Returns applied + conflicts + warnings (e.g. a remove/dispose whose target isn't present, or an off-vocab equip, is a conflict).",
      inputSchema: {
        operations: z.array(
          z.object({
            op: z.enum(["add", "remove", "verify", "dispose", "equip", "unequip", "set_kitchen_note"]),
            item: z.record(z.string(), z.unknown()).optional(),
            name: z.string().optional(),
            disposition: z.enum(["used", "waste"]).optional(),
            reason: z.string().optional(),
            event_id: z.string().optional(),
            occurred_at: z.string().optional(),
            slug: z.string().optional(),
            key: z.string().optional(),
            value: z.unknown().optional(),
          }),
        ),
      },
    },
    ({ operations }) =>
      runTool(async () => {
        const pantryOps = operations.filter((op) => PANTRY_OP_NAMES.has(op.op)) as unknown as Parameters<
          typeof applyPantryRowOps
        >[2];
        const kitchenOps = operations.filter((op) => !PANTRY_OP_NAMES.has(op.op));

        const [pantryResult, kitchenResult] = await Promise.all([
          pantryOps.length > 0
            ? applyPantryRowOps(env, username, pantryOps, today())
            : Promise.resolve({ applied: [], conflicts: [], warnings: [] }),
          (async () => {
            if (kitchenOps.length === 0) return { applied: [], conflicts: [] };
            const mapped: KitchenOperation[] = kitchenOps.map((op) => ({
              op: KITCHEN_OP_TO_INTERNAL[op.op],
              slug: op.slug,
              key: op.key,
              value: op.value,
            }));
            const inventory = (await readProfile(env, username)).kitchen;
            const { inventory: next, applied, conflicts } = applyKitchenOperations(inventory, mapped);
            if (applied.length > 0) await setKitchen(env, username, next);
            return {
              applied: applied.map((a) => ({ op: KITCHEN_OP_FROM_INTERNAL[a.op], target: a.target })),
              conflicts: conflicts.map((c) => ({ op: KITCHEN_OP_FROM_INTERNAL[c.op], target: c.target, reason: c.reason })),
            };
          })(),
        ]);

        return {
          applied: [...pantryResult.applied, ...kitchenResult.applied],
          conflicts: [...pantryResult.conflicts, ...kitchenResult.conflicts],
          ...(pantryResult.warnings.length > 0 ? { warnings: pantryResult.warnings } : {}),
        };
      }),
  );

  // update_stockup / update_staples leave the MCP surface (staples-tracking,
  // data-write-tools): the member web app curates both lists over the SAME shared
  // operations (addStockup/updateStaples, deduped-by-normalized-name preserved) —
  // no tool moves, only the registration.
  //
  // update_kitchen is folded into update_pantry's equip/unequip/set_kitchen_note ops
  // above (kitchen-equipment); mark_pantry_verified is already update_pantry's `verify`
  // op — both standalone tools just unregister here.

  // User-curated config writers — content-faithful: write exactly what the caller
  // supplies. The discipline of WHEN to call these (only on explicit user
  // direction) lives in packages/plugin/AGENT_INSTRUCTIONS.md.

  server.registerTool(
    "update_preferences",
    {
      description:
        "Edit the caller's grocery preferences with a deep merge-patch (RFC 7396): keys present in `patch` set/overwrite, a key set to null is DELETED, nested objects merge to any depth, and arrays replace wholesale. Only the keys you touch change. Defined top-level keys include cadence, planning_cadence_days, weekly_budget, stores ({primary, preferred_location, location_zip, nicknames:{[store_slug]: private household nickname}}), brands, dietary, rotation, curated_hide (boolean, HOUSEHOLD-scoped: true hides the deployment's curated recipe collection from your whole household's cookbook — reversible, nothing is deleted; only meaningful on SaaS-profile deployments), and custom. Offline nicknames are household preferences only: they never change the shared store registry. Returns { updated: 'preferences' } plus any deprecation warnings.",
      inputSchema: { patch: z.record(z.string(), z.unknown()) },
    },
    ({ patch }) => runTool(() => applyPreferencesPatch(env, username, patch)),
  );

  // update_taste carries a `mode` (data-write-tools): "replace" (default — today's
  // whole-field write) or "append" (appends `content` to the existing narrative with a
  // blank-line separator; a null/empty narrative stores `content` as-is, so append and
  // replace converge). Silent ambient captures use append so they can never clobber the
  // member's curated text; a member-directed rewrite uses replace.
  server.registerTool(
    "update_taste",
    {
      description:
        'Write the caller\'s taste narrative (markdown). `mode` (default "replace") picks how: "replace" overwrites the narrative verbatim with `content` — call only when the user has directed an edit. "append" adds `content` to the END of the existing narrative with a blank-line separator, preserving everything already there — use this for a silent ambient capture, never a directed rewrite, so it can never clobber the member\'s curated text (an absent/empty narrative stores `content` as-is either way). Returns { updated: \'taste\' }.',
      inputSchema: { content: z.string(), mode: z.enum(["replace", "append"]).optional() },
    },
    ({ content, mode }) =>
      runTool(async () => {
        if ((mode ?? "replace") === "append") {
          const current = (await readProfile(env, username)).taste;
          const next = typeof current === "string" && current.trim() ? `${current}\n\n${content}` : content;
          await setProfileFields(env, username, { taste: next });
          return { updated: "taste" };
        }
        await setProfileFields(env, username, { taste: content });
        return { updated: "taste" };
      }),
  );

  // Remaining profile markdown fields (diet_principles) write the D1 `profile` row,
  // replace-only — dietary gates are edited deliberately, never appended ambiently.
  for (const [key, column] of Object.entries(PROFILE_MARKDOWN_FIELDS)) {
    if (key === "taste") continue; // handled above, with mode support
    server.registerTool(
      `update_${key}`,
      {
        description: `Write ${key} verbatim with the supplied full content (markdown narrative). Call only when the user has directed an edit.`,
        inputSchema: { content: z.string() },
      },
      ({ content }) =>
        runTool(async () => {
          await setProfileFields(env, username, { [column]: content });
          return { updated: key };
        }),
    );
  }

  // update_aliases leaves the MCP surface (ingredient-normalization, data-write-tools):
  // human alias/display-name overrides are written from the operator admin surface over
  // the same shared `addAliases` write operation (source='human' precedence intact) —
  // there is no member update_aliases tool.
}
