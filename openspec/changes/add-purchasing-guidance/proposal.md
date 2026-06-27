## Why

Members read genuinely useful *buying* writing (ATK taste tests, Serious Eats buying guides) about which product to put in the cart — "for sauce, pick canned whole tomatoes with **no** calcium chloride," "which supermarket olive oil is actually good" — and the occasional non-obvious "how do I pick a ripe one." There's no home for it. The proof is already in the data: `canned-tomatoes.md` sits in `guidance/cooking_techniques/`, yet every word is a *shelf* decision ("read the ingredient list, not the front of the can") that's already spent by the time you're at the stove. Guidance is **moment-anchored** — storage fires at put-away, technique at the stove — and the **SHOP** moment has no domain.

## What Changes

- **Add a third guidance domain `guidance/purchasing/`** — shared and **agent-writable**, keyed by **product/item slug** (`canned-tomatoes.md`, `olive-oil.md`), holding "what kind of X should I get" selection wisdom plus the handful of non-obvious "how do I tell if Y is good/ripe" judgments. It rides the **existing** generic tool trio — **no new MCP surface**.
- **Extend the controlled vocabulary and the writable-domain allowlist** to admit `purchasing` (joins `cooking_techniques` as writable; `ingredient_storage` stays read-only). This is the payoff of the `guidance/<domain>/` umbrella built for cooking-techniques: a new domain is a vocabulary entry, not new machinery. **Not breaking** — additive; no tool rename, no corpus relocation.
- **Inherit storage's anti-folklore hedge** *on top of* the writable posture. Buying advice — ripeness especially — is folklore-prone (thump the melon), so contested tips SHALL be pre-hedged in prose, and the agent gives **no** tip for an item with no entry rather than improvising.
- **Scope by a self-limiting inclusion gate**: an entry earns its place only when the knowledge is non-obvious enough you'd *pull your phone out in the aisle* for it (the buy-side analogue of storage's "skip the obvious"). Excludes the obvious and the well-understood — notably produce **seasonality**, which is out of scope.
- **Add a capture skill** (sibling of `save-technique`): the member posts a buying guide / taste test / their own distillation; the agent compresses it to "what to actually grab" and persists via `save_guidance("purchasing", …)` with `source`. Its description SHALL disambiguate from its siblings — a *buying guide* → purchasing (surfaced at SHOP); a *technique* piece → cooking_techniques (surfaced at COOK); a *one-recipe* tweak → recipe-note.
- **Surface at SHOP time inside `shop-groceries`** — the trip's front bookend, mirroring storage at the `received` back bookend:
  - **In-store walk**: weave a couple of non-obvious selection/ripeness tips in as the relevant aisle is reached, mapped to list items by world-knowledge (no manifest), capped like storage's 2–3.
  - **Online (Kroger) flush**: a single consolidated "eyeball these in the cart and swap manually" callout — **narration only**, no influence on SKU matching.
- **Re-home the misfiled entry**: `git mv guidance/cooking_techniques/canned-tomatoes.md → guidance/purchasing/canned-tomatoes.md` in the data repos, and seed one more worked example (`olive-oil.md`).

## Capabilities

### New Capabilities
- `purchasing-guidance`: the shared, agent-writable `guidance/purchasing/` corpus keyed by product/item slug (selection + non-obvious ripeness), governed by the phone-out inclusion gate and storage's anti-folklore hedge; the buying-guide capture skill; and SHOP-time surfacing (in-store per-aisle tips + the online manual-swap callout).

### Modified Capabilities
- `cooking-techniques` (owns the generic guidance surface): the `guidance/` umbrella controlled vocabulary admits a third domain, and `purchasing` joins the `save_guidance` **writable-domain allowlist** alongside `cooking_techniques`.
- `repo-structure`: the data-repo `guidance/` umbrella gains a `purchasing/` subtree alongside `ingredient_storage/` and `cooking_techniques/`.
- `data-validation`: the existence-only `guidance/**/*.md` prose check covers the new `purchasing/` subtree.

## Impact

- **Code**: `src/guidance.ts` (add `purchasing` to `GUIDANCE_DOMAINS` and to `WRITABLE_DOMAINS` — a few lines; the read/list/save/validation logic is already domain-generic); `src/tools.ts` (the `list_guidance` / `read_guidance` / `save_guidance` descriptions enumerate the domains — add `purchasing` and what it covers).
- **Tests**: `test/guidance.test.ts` — `purchasing` lists/groups, reads, and is **writable** (create + refine); `ingredient_storage` stays rejected. No new test file needed.
- **Docs (same-pass, no drift)**: `docs/SCHEMAS.md` (the `guidance/` section gains the `purchasing` domain shape — item-keyed, `description`/`source` frontmatter), `docs/TOOLS.md` (the guidance tool domain enumeration), `docs/ARCHITECTURE.md` (the guidance-umbrella reference, if it lists domains).
- **Persona**: `AGENT_INSTRUCTIONS.md` — new capture skill; `shop-groceries` surfacing (in-store walk per-aisle tips + the online cart callout); then rebuild the bundle with `aubr build:plugin` (never hand-edit `plugin/`).
- **Data repos** (`groceries-agent-data`, `groceries-agent-data-template`): `git mv` `canned-tomatoes.md` into `guidance/purchasing/`, seed `olive-oil.md`, update READMEs.
- **No D1 migration**: the corpus is GitHub-hosted curated markdown, like the other guidance domains.
- **Non-goal, named so it isn't lost**: purchasing guidance does **not** influence `match_ingredient_to_kroger_sku` or auto-write `preferences.brands` in v1. Online stays a manual-swap callout; feeding the matcher and hardening a settled choice into a `brands` preference are a deliberate **future arc**.
