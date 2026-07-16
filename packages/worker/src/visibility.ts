// The visibility LENS (shared-corpus, deployment-profiles-and-visibility-lens): the ONE
// enforcement point every corpus read surface resolves visibility through. Recipe
// visibility is an overlay over one monolithic corpus, never segmentation: a recipe
// exists once (one R2 body, one index row, one set of derived artifacts) regardless of
// how many households can see it. The grant structure is the D1 `recipe_imports` table
// (migration 0059) — one provenance row per (recipe, household) — and visibility is
// COMPUTED at read time as: the viewer's household owns an import row, OR a friend
// household owns one, OR the curated tenant owns one (subject to the household's
// curated-hide setting). The imports×friendship join IS the grant; nothing per-viewer
// is ever materialized. Under the self-hosted profile the friend input is the computed
// all-to-all relation (any household's non-curated import grants visibility — today's
// full shared corpus, with zero stored edges); under SaaS it is the real friendship
// relation, read through the ONE seam provider below.
//
// Enumerated consumers (the spec's list — per-surface reimplementation is a defect
// class): search_recipes (both modes), read_recipe/display_recipe, read_recipe_notes,
// list_new_for_me, the propose candidate pools, similar-recipes, trending and
// picked-for-you, the member cookbook /api reads, the anonymous /cookbook routes, and
// recipe_site_url. Whole-index consumers inherit the lens through the viewer-scoped
// `loadRecipeIndex` (src/recipe-index.ts, which calls `visibleSlugs`); point reads call
// `isVisible`. Derivation pipelines (index projection, embedding reconcile, facet
// classification, dup-scan) are corpus-wide by design (D2 compute-once) and are NOT
// lens consumers.
//
// 404 indistinguishability: point-read consumers resolve visibility BEFORE existence is
// disclosed — out-of-lens and nonexistent slugs take the identical `not_found` path with
// no body read, so no surface is a slug-probing oracle.

import type { Env } from "./env.js";
import { db } from "./db.js";
import { loadDeploymentProfile, type DeploymentProfile } from "./deployment.js";

/**
 * The reserved curated system tenant (D12/D13): the owner of curated-tier grants. `~` is
 * outside the canonical tenant-username space (lowercase [a-z0-9][a-z0-9_-]*) AND the
 * product handle grammar, so no signup, onboarding, or invite path can ever claim it; it
 * gets no allowlist entry, no `tenants` registry row, no `members` row, and can never
 * resolve a session or token. It exists ONLY as a value in `recipe_imports.tenant`/`member`.
 */
export const CURATED_TENANT = "~curated";

/** The `recipe_imports.via` value for curated-tier grants. */
export const CURATED_VIA = "curated";

/** A lens position: a household member, or the anonymous bottom position (`/cookbook`). */
export type Viewer =
  | { kind: "member"; tenant: string; member: string }
  | { kind: "anonymous" };

/** The anonymous viewer (the `/cookbook` surface's bottom lens position). */
export const ANONYMOUS: Viewer = { kind: "anonymous" };

/** Build a member viewer. `member` defaults to the founding member (= tenant id) at call
 *  sites that carry only the tenant — the lens predicate keys on the HOUSEHOLD; the
 *  member is attribution, never a visibility boundary. */
export function memberViewer(tenant: string, member: string = tenant): Viewer {
  return { kind: "member", tenant, member };
}

/**
 * THE FRIEND-RELATION SEAM (D11): the one named provider of the viewer household's
 * friend households, consumed by the lens predicate, the trending aggregation, and the
 * group-signal reads. Contract: return the tenants joined to `tenant` by SYMMETRIC,
 * ACCEPTED-only friendship edges (never pending/blocked), keyed by tenant id, excluding
 * `tenant` itself and the curated tenant. The `friendships` table satisfies it by
 * construction (households-friends-and-people-page): a row exists only for an ACCEPTED
 * edge (pending state lives in `social_requests`), stored once as a canonically ordered
 * pair whose CHECK makes self-edges unrepresentable, and the curated tenant can never
 * be a party (it has no members and no signup path). Both UNION arms are indexed (the
 * PK prefix and `idx_friendships_b`). The self-hosted all-to-all arm never calls this
 * (it needs no enumeration — see `lensGrantWhere`).
 */
export async function friendHouseholds(env: Env, tenant: string): Promise<string[]> {
  const rows = await db(env).all<{ friend: string }>(
    "SELECT tenant_b AS friend FROM friendships WHERE tenant_a = ?1 " +
      "UNION SELECT tenant_a AS friend FROM friendships WHERE tenant_b = ?1",
    tenant,
  );
  return rows.map((r) => r.friend);
}

/** The household-level curated-tier hide (D13-amendment): `profile.curated_hide`.
 *  NULL/0/absent row = shown (the default). Household-scoped — one setting suppresses
 *  the whole curated tier from every member of the household's lens. */
export async function readCuratedHide(env: Env, tenant: string): Promise<boolean> {
  const row = await db(env).first<{ curated_hide: number | null }>(
    "SELECT curated_hide FROM profile WHERE tenant = ?1",
    tenant,
  );
  return row?.curated_hide === 1;
}

/** A resolved lens: everything the predicate needs, loaded once per read. */
interface ResolvedLens {
  profile: DeploymentProfile;
  viewer: Viewer;
  /** SaaS member viewers only: the seam's friend households. */
  friends: string[];
  /** SaaS member viewers only: the household's curated-hide setting. */
  curatedHide: boolean;
}

async function resolveLens(env: Env, viewer: Viewer): Promise<ResolvedLens> {
  const profile = await loadDeploymentProfile(env);
  if (profile === "saas" && viewer.kind === "member") {
    const [friends, curatedHide] = await Promise.all([
      friendHouseholds(env, viewer.tenant),
      readCuratedHide(env, viewer.tenant),
    ]);
    return { profile, viewer, friends, curatedHide };
  }
  return { profile, viewer, friends: [], curatedHide: false };
}

/**
 * The ONE private predicate-fragment builder: the WHERE arm over `recipe_imports` rows
 * (aliased `i`) that decides whether a grant row admits the viewer. Every lens read —
 * whole-index (`visibleSlugs`), point (`isVisible`), and provenance — is built from this
 * fragment, so the lens has exactly one SQL definition.
 *
 *   self-hosted (any viewer):  i.tenant <> '~curated'            — implicit all-to-all;
 *                              the curated tier is SaaS-only (D9), so curated rows never
 *                              grant under self-hosted.
 *   saas, anonymous:           i.tenant = '~curated'             — the bottom position is
 *                              exactly the curated tier (the household hide never applies:
 *                              it scopes ONE household's lens; the anonymous reader has none).
 *   saas, member:              own ∨ friend ∨ (curated ∧ ¬hide)  — the friend arm binds the
 *                              seam's enumerated households.
 */
function lensGrantWhere(lens: ResolvedLens): { sql: string; binds: unknown[] } {
  if (lens.profile === "self-hosted") {
    return { sql: "i.tenant <> ?", binds: [CURATED_TENANT] };
  }
  if (lens.viewer.kind === "anonymous") {
    return { sql: "i.tenant = ?", binds: [CURATED_TENANT] };
  }
  const arms: string[] = ["i.tenant = ?"];
  const binds: unknown[] = [lens.viewer.tenant];
  if (lens.friends.length > 0) {
    arms.push(`i.tenant IN (${lens.friends.map(() => "?").join(", ")})`);
    binds.push(...lens.friends);
  }
  if (!lens.curatedHide) {
    arms.push("i.tenant = ?");
    binds.push(CURATED_TENANT);
  }
  return { sql: `(${arms.join(" OR ")})`, binds };
}

// db(env) binds positionally over numbered `?N` placeholders; the fragment builder emits
// bare `?` for composability, renumbered here at the one place queries are assembled.
function numberPlaceholders(sql: string): string {
  let n = 0;
  return sql.replace(/\?/g, () => `?${++n}`);
}

/**
 * The viewer's visible slug set, computed in ONE indexed query over `recipe_imports`.
 * `loadRecipeIndex(env, viewer)` applies this to the whole-index read, so every
 * whole-index consumer inherits the lens by construction. A slug with zero grant rows
 * (a legacy recipe the lens reconcile has not yet attached) is NOT visible — the
 * reconcile (src/lens-reconcile.ts) converges that class organically.
 */
export async function visibleSlugs(env: Env, viewer: Viewer): Promise<Set<string>> {
  const lens = await resolveLens(env, viewer);
  const where = lensGrantWhere(lens);
  const rows = await db(env).all<{ recipe: string }>(
    numberPlaceholders(`SELECT DISTINCT i.recipe AS recipe FROM recipe_imports i WHERE ${where.sql}`),
    ...where.binds,
  );
  return new Set(rows.map((r) => r.recipe));
}

/**
 * Point visibility for one slug — the SAME fragment as `visibleSlugs`, as an indexed
 * point query (the PK prefix). Point-read consumers (read_recipe / display_recipe,
 * read_recipe_notes, similar-recipes, new-for-me, recipe_site_url, /cookbook/<slug>)
 * call this BEFORE any existence-disclosing read: out-of-lens and nonexistent slugs are
 * both simply "not visible" — the byte-identical not_found/404, no body read either way.
 */
export async function isVisible(env: Env, viewer: Viewer, slug: string): Promise<boolean> {
  const lens = await resolveLens(env, viewer);
  const where = lensGrantWhere(lens);
  const row = await db(env).first<{ ok: number }>(
    numberPlaceholders(`SELECT 1 AS ok FROM recipe_imports i WHERE i.recipe = ? AND ${where.sql} LIMIT 1`),
    slug,
    ...where.binds,
  );
  return row !== null;
}

/** Row provenance for list surfaces: the highest-precedence grant that admits the row
 *  for the viewer's household (own > friend > curated). Under self-hosted another
 *  household's import reads as `friend` (the implicit all-to-all edge). */
export type Provenance = "own" | "friend" | "curated";

/**
 * The viewer's visible slugs WITH per-slug provenance, in one query — the member
 * cookbook index/search hit shape carries this so list surfaces render curated (and
 * later friend) provenance without a second read. Anonymous viewers have no household,
 * so every row reads `curated` under SaaS and `friend` under self-hosted; the member
 * app is the only consumer today.
 */
export async function visibleSlugProvenance(env: Env, viewer: Viewer): Promise<Map<string, Provenance>> {
  const lens = await resolveLens(env, viewer);
  const where = lensGrantWhere(lens);
  const rows = await db(env).all<{ recipe: string; tenant: string }>(
    numberPlaceholders(`SELECT i.recipe AS recipe, i.tenant AS tenant FROM recipe_imports i WHERE ${where.sql}`),
    ...where.binds,
  );
  const own = lens.viewer.kind === "member" ? lens.viewer.tenant : null;
  const out = new Map<string, Provenance>();
  for (const { recipe, tenant } of rows) {
    const p: Provenance = tenant === own ? "own" : tenant === CURATED_TENANT ? "curated" : "friend";
    const prev = out.get(recipe);
    if (prev === undefined || rank(p) < rank(prev)) out.set(recipe, p);
  }
  return out;
}

function rank(p: Provenance): number {
  return p === "own" ? 0 : p === "friend" ? 1 : 2;
}

/**
 * The households whose activity is inside the viewer's lens — the aggregation set for
 * the group-signal reads (group favorites/notes) and SaaS trending. Under self-hosted
 * this is null, meaning "every household" (today's deployment-wide read — the implicit
 * all-to-all lens needs no enumeration); under SaaS it is the caller's household plus
 * the seam's friend households.
 */
export async function lensHouseholds(env: Env, tenant: string): Promise<string[] | null> {
  const profile = await loadDeploymentProfile(env);
  if (profile === "self-hosted") return null;
  return [tenant, ...(await friendHouseholds(env, tenant))];
}

// --- grant writes (import-path attribution at creation) --------------------------------

/** One visibility grant to record. */
export interface ImportGrant {
  recipe: string;
  tenant: string;
  /** The importing member; the founding member (= tenant id) for reconciled/curated rows. */
  member: string;
  /** 'agent' | 'feed:<url>' | 'satellite' | 'curated'. */
  via: string;
  /** YYYY-MM-DD. */
  importedAt: string;
}

const GRANT_SQL =
  "INSERT OR IGNORE INTO recipe_imports (recipe, tenant, member, via, imported_at) VALUES (?1, ?2, ?3, ?4, ?5)";

/** Record one household's grant. Idempotent on the (recipe, tenant) PK — a household's
 *  second import of the same recipe changes nothing (first provenance wins). */
export async function recordImportGrant(env: Env, grant: ImportGrant): Promise<void> {
  await db(env).run(GRANT_SQL, grant.recipe, grant.tenant, grant.member, grant.via, grant.importedAt);
}

/** The grant INSERT as a prepared statement, for write paths that mint the grant in the
 *  same batch as sibling rows (the sweep's match+grant single write path, D13). */
export function importGrantStmt(env: Env, grant: ImportGrant): D1PreparedStatement {
  return db(env).prepare(GRANT_SQL, grant.recipe, grant.tenant, grant.member, grant.via, grant.importedAt);
}
