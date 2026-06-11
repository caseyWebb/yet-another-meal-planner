## 1. Schema + docs (cut ingredients.toml, document storage_guidance/)

- [x] 1.1 In `docs/SCHEMAS.md`, **remove** the reserved `ingredients.toml (Phase 7)` block entirely.
- [x] 1.2 In `docs/SCHEMAS.md`, add a `storage_guidance/` entry: shared-corpus (data-repo root) curated config; markdown prose keyed by storage **class** (`tender-herbs.md`, `hardy-herbs.md`, `leafy-greens.md`, `alliums.md`, …), singletons (`basil.md`, `tomatoes.md`, `avocados.md`) for class-breakers, and `_ethylene.md` for relational "don't store together" rules. Note it is read-only/edit-when-directed (no write tool) and optionally carries a one-line `description` per file for `list_storage_guidance`.
- [x] 1.3 In `CLAUDE.md`, add `storage_guidance/` to the curated-config (edit-when-directed) list, and remove any `ingredients.toml` mention.

## 2. Storage-guidance content tree (data repo)

- [x] 2.1 Seed `storage_guidance/*.md` from `docs/notes/2026-06-11-storage-guidance-research.md`, curated to the opinionated, non-obvious head of each class; pre-hedge contested tips in the prose (berry vinegar rinse, the basil "blackens" mechanism, apple-in-potato-bin folklore, the tomato ATK↔SE nuance). Encode the verified tender-herb placement (other tender herbs → jar in the fridge; `basil.md` → counter).
- [x] 2.2 Create `_ethylene.md` with the producers/sensitive lists and the pairwise rules (onions↔potatoes apart; producers away from greens/broccoli; intentional ripening pairing). (Content tree lives in the data repo, not this code repo.)

## 3. Read tools (`src/`)

- [x] 3.1 Implement `read_storage_guidance(slugs)` returning the named entries, paralleling `read_diet_principles`/`read_recipe` in `src/tools.ts` (GitHub read of `storage_guidance/<slug>.md` at HEAD; structured `not_found` for an unknown slug, per the `src/errors.ts` convention).
- [x] 3.2 Implement `list_storage_guidance()` returning the available class slugs (+ optional one-line description sourced per the 1.2 decision), following the `list_recipes` shape.
- [x] 3.3 Confirm **no** write/edit tool for `storage_guidance/` is added anywhere in the tool surface (`src/write-tools.ts`).
- [x] 3.4 Update `docs/TOOLS.md` with both read tools (params/returns) and the no-write-tool note; keep it in sync with the implementation.
- [x] 3.5 Add Worker tests: `read_storage_guidance` returns content for known slugs and a structured `not_found` for an unknown slug; `list_storage_guidance` returns the slug set. Use mocked GitHub responses, matching the existing read-tool test pattern.

## 4. Put-away behavior (`AGENT_INSTRUCTIONS.md` → regenerate plugin)

- [x] 4.1 In `AGENT_INSTRUCTIONS.md`, add the put-away tip rule to **both** the order `received` restock flow and the farmers-market `update_pantry` haul: when new perishables enter, `list_storage_guidance` then `read_storage_guidance` the relevant class(es) mapped by the agent's own world knowledge; surface ~2–3 relevant, non-obvious tips.
- [x] 4.2 Encode the guarantees: no matching class file → **no tip** (silence over invention); relay contested tips with their in-prose hedge (never assert folklore as fact); don't nag the same tip every trip.
- [x] 4.3 Regenerate the plugin bundle with `npm run build:plugin` (`scripts/build-plugin.mjs`); do not hand-edit `plugin/`. Confirm the relevant skills reflect the new behavior.

## 5. Verification

- [x] 5.1 Run `npm run typecheck`, `npm test`, and `npm run test:tooling` — all green.
- [x] 5.2 Confirm `read_pantry(stale_only)` still returns the structured `unsupported` error (now justified by LLM-judged freshness, not a forthcoming `ingredients.toml`); update its message/test if it references `ingredients.toml`.
- [x] 5.3 `openspec validate add-storage-guidance` passes.
