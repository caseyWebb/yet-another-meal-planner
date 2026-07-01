// Structural write-time validation (data-write-tools capability). Runs on workerd at the
// recipe write tools (create_recipe / update_recipe): every staged file parses,
// enumerated fields hold legal values, and recipe controlled-vocabulary fields
// (protein / cuisine / requires_equipment) are vocab-checked against the SAME shared
// definition (src/vocab.js / src/recipe-contract.js) the Worker recipe-index reconcile
// (src/recipe-projection.ts) uses over the whole corpus. Cross-reference / index
// validation (slug resolution) is the reconcile's job — it needs the whole corpus. Any
// problem throws ToolError("validation_failed") so the write tool persists nothing, and
// the member's agent gets an immediate, fixable error.

import { load as loadYaml } from "js-yaml";
import { ToolError } from "./errors.js";
import { validateRecipeContract } from "./recipe-contract.js";

// The per-tenant recipe `status` lifecycle (active/draft/rejected/archived) is
// RETIRED — the overlay collapsed to favorite/reject and visibility is opt-out, so a
// recipe carries no status. A lingering frontmatter `status` on an old file is tolerated
// and ignored (the build strips it from the index); it is no longer validated here.
// PROTEIN_VOCAB / CUISINE_VOCAB / EQUIPMENT_VOCAB come from the single shared
// source (src/vocab.js) that the recipe-index reconcile (src/recipe-projection.ts, via
// src/recipe-contract.js) also validates against — so the write-time gate and the
// reconcile gate cannot disagree. recipes/*.md
// protein / cuisine / requires_equipment ARE vocab-enforced here now (an off-vocab
// value can otherwise only be caught post-push, where it breaks the public site
// deploy and the index regen with no signal to the agent). A `none`/empty
// protein|cuisine is normalized to absent upstream in the write path
// (src/serialize.ts), so it never reaches this check.

function fail(path: string, message: string): never {
  throw new ToolError("validation_failed", `${path}: ${message}`, { path });
}

// kebab-case location slug; anchored so it also rejects path traversal.
const STORE_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Write-time store-identity validation (moved off the build into the Worker, slice 6).
 * `slug` must be kebab-case; `name` required; `domain` a non-empty string when given.
 * Throws ToolError("validation_failed") so add_store / update_store make no write.
 */
export function validateStoreInput(input: {
  slug: string;
  name: string;
  domain?: string;
}): void {
  if (!STORE_SLUG_RE.test(input.slug)) {
    throw new ToolError("validation_failed", `Invalid store slug: ${input.slug}`, { slug: input.slug });
  }
  if (typeof input.name !== "string" || !input.name.trim()) {
    throw new ToolError("validation_failed", "store name must not be empty", { slug: input.slug });
  }
  if (input.domain != null && (typeof input.domain !== "string" || !input.domain.trim())) {
    throw new ToolError("validation_failed", `\`domain\` must be a non-empty string`, { slug: input.slug });
  }
}

/**
 * Write-time discovery-candidate validation (the email-ingest inbox writer, slice 6).
 * A candidate needs a non-empty `url`. Throws ToolError("validation_failed").
 */
export function validateDiscoveryCandidate(cand: { url: string }): void {
  if (typeof cand.url !== "string" || !cand.url.length) {
    throw new ToolError("validation_failed", "inbox candidate is missing required field `url`", {});
  }
}

function parseFrontmatterOrFail(path: string, content: string): Record<string, unknown> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content);
  if (!match) fail(path, "missing leading --- frontmatter fence");
  try {
    const parsed = loadYaml(match[1]);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch (e) {
    fail(path, `frontmatter is not valid YAML — ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Validate one staged file's full new content by path. Throws
 * ToolError("validation_failed") on any structural problem; returns on success.
 */
export function validateFile(path: string, content: string): void {
  if (path.startsWith("recipes/") && path.endsWith(".md")) {
    const fm = parseFrontmatterOrFail(path, content);
    // The full required-field contract (blunt-uniform) is enforced HERE at the write
    // boundary AND in the Node build validator, both drawing from the single shared
    // definition (src/recipe-contract.js), so a non-compliant recipe is a fixable error
    // the agent sees immediately instead of a post-push build failure on main. For
    // `update_recipe` the commit engine validates the MERGED file content, so a
    // one-field patch on an already-compliant recipe passes while an edit that strips or
    // empties a required field is rejected. `status` is retired — not in the contract;
    // a lingering value is tolerated and stripped from the index by the build. Slug
    // *resolution* for `pairs_with` stays the post-push build's job (no corpus on
    // workerd). The contract returns every violation; we surface the first.
    const errs = validateRecipeContract(fm);
    if (errs.length) fail(path, errs[0]);
    return;
  }

  // After d1-shared-corpus (slice 6), recipes/*.md are the ONLY files the commit
  // engine ever writes — every other artifact (profile, session, cooking log, and the
  // whole shared corpus: stores, notes, aliases, feeds, discovery, SKU cache, flyer
  // terms) is a D1 table written + validated at its own write tool, NOT committed to
  // GitHub. So there is no non-recipe file to structurally validate here. The former
  // store/discovery/inbox TOML checks moved to write-time validators above
  // (validateStoreInput / validateDiscoveryCandidate). Anything else (freeform
  // markdown like taste.md): no structural contract to enforce.
}
