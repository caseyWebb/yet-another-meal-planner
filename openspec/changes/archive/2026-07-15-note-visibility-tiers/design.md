# note-visibility-tiers — design

## Context

Current notes reality (verified in code during planning):

- `recipe_notes` was created by `0006_shared_corpus.sql`: `id TEXT PRIMARY KEY` (composite string `"<author> <recipe> <created_at>"`), `recipe`, `author`, `body`, `tags` (JSON array), `private INTEGER` (0/1), `created_at TEXT`, with `idx_recipe_notes_recipe`. There is **no tenant column** — the authoring household is derivable only through `members.tenant` via `author`.
- The one read predicate lives in `packages/worker/src/corpus-db.ts` (`readNotes`, generic over `recipe_notes`/`store_notes`): `WHERE recipe = ?1 AND (private = 0 OR author = ?2)`. Insert/update/delete (`insertNote`/`updateOwnNote`/`removeOwnNote`) address rows by the composite id and are self-scoped by author.
- The MCP tools (`packages/worker/src/notes-tools.ts`) take `private: z.boolean().optional()` and — post-identity-split — stamp `author` from `tenant.member`. The member `/api` routes (`packages/worker/src/api/cookbook.ts`, GET/POST/PATCH/DELETE under `/cookbook/recipes/:slug/notes`) still stamp `tenant.id`; byte-identical today under the founding-member invariant, but a divergence this change unifies (both paths stamp the resolved member id — member-identity-split design D8's stated end state).
- Note writes are D15 class (b): idempotent, keyed on `(author, slug, client-minted created_at)`, registered offline mutations (`member-app-offline` "note add/edit/remove"; the `/api` POST comment says exactly this). Nothing in this change alters the key or the class.
- The composer (`packages/app/src/routes/_app.recipe.$slug.tsx`) renders a Private **checkbox** (`.note-priv`), a free-text tag input, and own-note edit/delete; community notes filter client-side on `!n.private`. `SegmentedControl` (`packages/ui/src/components/controls.tsx`) is the shipped single-select segmented primitive — the cookbook **Time filter** uses it, which is precisely the treatment design request #9 names.
- The anonymous `/cookbook` site (`packages/worker/src/cookbook.ts`) renders **no notes today**; its recipe page renders untrusted markdown through a raw-HTML-dropping `marked` renderer under a strict CSP.
- Landed/ratified band-5 contracts this change builds on: `(tenantId, memberId)` resolved before any tool/route; `members(id, tenant, handle, created_at)` with founding member id = tenant id (so every legacy `recipe_notes.author` value is a real members row — the identity-split's gated capture asserts `SELECT DISTINCT author FROM recipe_notes WHERE author NOT IN (SELECT id FROM members)` is empty); ONE lens enforcement point (`src/visibility.ts`) with `read_recipe_notes` an enumerated D11 consumer (notes for an out-of-lens recipe return the indistinguishable `not_found`), a named **friend-seam provider** that `households-friends-and-people-page` fills with the real `friendships` subquery, and the anonymous position = curated-only under SaaS / full attached corpus under self-hosted.

**Ratification order**: DECISIONS.md's ratifications block wins — **D30-final** (tiers `public | friends | private`, NO household tier, default `friends` under both profiles, public bounded by the recipe's own lens, private = author-only, migration private→private / non-private→friends, retroactivity as drafted) supersedes draft D30's `private | household | friends` set and its SaaS-default question.

**Design authorization**: no Claude Design export exists for design request #9 (the three-state tier composer). The operator has authorized a **local design** for this change this session (the `offline-stores-and-store-walk` / lens-change precedent), under the constraint: stay as close to the current design export as possible, mimic existing styles — the #9 prompt itself names the Time-filter segmented treatment — and use existing shared primitives (`SegmentedControl`). The #9 prompt is the brief; Decision 7 encodes it; tasks carry the Playwright obligations.

**Sequencing**: implementation lands after `households-friends-and-people-page` (friendships + handles UX; its planning artifacts were not yet written when this plan was authored — see Decision 1 for the migration-number dependency and Risks for the seam contract this plan assumes from the lens change instead).

## Goals / Non-Goals

**Goals:**

- One tier column, one pure-mapping migration, zero data surgery: every pre-migration row lands exactly where D30-final says (`private=1` → `private`, else `friends`), and self-hosted deployments see **zero member-visible change** (friends tier under implicit all-to-all = today's shared note; private = today's private).
- One tiered read predicate in the existing one place (`corpus-db.ts` notes read), consuming the lens module's friend-seam provider — no second friendship enumeration, no per-surface reimplementation.
- Tier + author handle on every returned note, on both the MCP and `/api` read paths, with one members join serving both needs.
- Rollback safety: a deploy revert must never widen a private note's audience (Decision 2's dual-write).
- The composer per design request #9, on existing primitives, with the same control in the edit state.
- Public tier reaching the anonymous surface exactly where the recipe itself is anonymously visible — and nowhere else, under either profile.

**Non-Goals:**

- Store notes stay on the binary `private` flag. They are a household-scoped surface (no cross-household store-note read exists), D30 is a recipe-notes decision, and tiering them would invent an unspecced feature. The shared note-mutation core stays generic; the tier column and predicate apply to `recipe_notes` only.
- No household tier (D30-final drops it deliberately — a household-only note is not expressible), no per-note ACLs, no note search/aggregation changes, no `favorites` (overlay) changes — the group-favorites aggregate was lens-scoped by the lens change and is not tiered.
- No new routes, bindings, cron entries, or dependencies. `/cookbook*` is already Worker-first.
- No friendship mechanics — the friends tier reads the seam; `households-friends-and-people-page` owns the edges.
- No retroactive materialization: visibility is computed per read (D30's live lens); no visibility rows, caches, or fan-out writes exist to reconcile.

## Decisions

### 1. Schema: `tier TEXT` on `recipe_notes`; migration is a pure mapping (expected `0061`)

```sql
-- packages/worker/migrations/d1/0061_note_tiers.sql  (number: first free after the
-- households change claims its own; 0059 = lens, 0060 expected = households)
ALTER TABLE recipe_notes ADD COLUMN tier TEXT
  CHECK (tier IN ('public','friends','private'));
UPDATE recipe_notes
   SET tier = CASE WHEN private = 1 THEN 'private' ELSE 'friends' END
 WHERE tier IS NULL;
```

- Exactly D30-final's mapping; nothing else is touched. Pre-migration production rows are the implicit acceptance fixtures: the gated capture (tasks §8) records the private/shared counts before merge and asserts the post-migration tier distribution equals them.
- The column is nullable (SQLite ADD COLUMN) with a CHECK; the NULL case is handled at read time (Decision 2), so the migration is idempotent-shaped (NULL-guarded UPDATE) and a row inserted by old code during a rollback window heals organically — the repo's converge-don't-surgeon doctrine.
- The migration **number is a dependency on the sibling change**: `households-friends-and-people-page` was still being planned when this was written. Tasks pin "next free number after the households change's claim" with an explicit pre-implementation check; `0061` is the expectation, not a hardcoded fact.

*Alternative rejected:* a new `note_visibility` table or rebuilding `recipe_notes` without `private`. A 12-year-shaped ALTER + backfill is the house idiom (0058/0059 precedent); dropping `private` breaks rollback (see Decision 2) for zero benefit.

### 2. `tier` is the source of truth; `private` is dual-written for rollback safety; reads heal NULLs

- **Reads** compute the effective tier as `COALESCE(tier, CASE WHEN private = 1 THEN 'private' ELSE 'friends' END)` — the same mapping as the migration, so a NULL-tier row (possible only during a rollback window) behaves identically to its migrated form.
- **Writes** set both columns: `tier` as passed/defaulted, and `private = (tier = 'private')`. This is load-bearing for rollback: the previous Worker reads only `private`, so a note authored as `private` under the new code must carry `private = 1` or a deploy revert would **widen its audience** — the one unacceptable failure direction. (The reverse — a `public` note narrowing to shared-with-deployment under old code — is a safe direction.) `private` is documented in SCHEMAS.md as a legacy derived column; no read path consults it once this change lands.

*Alternative rejected:* stop writing `private` and accept the risk. Privacy regressions are the defect class this change exists to prevent; one extra bound column is free.

### 3. The tiered read predicate: one place, one members join, the lens module's friend seam

The recipe visibility gate is **already upstream** (lens change): `read_recipe_notes`, the notes `/api` GET, and the anonymous page all resolve the recipe through `src/visibility.ts` before any notes read — out-of-lens ⇒ indistinguishable `not_found`. This change only replaces the per-note predicate inside `corpus-db.ts`'s recipe-notes read (the `store_notes` arm keeps the old predicate — Non-Goals):

```sql
-- member viewer (:member, :tenant, :profile); effTier = COALESCE(tier, CASE private…)
SELECT n.author, m.handle, n.created_at, n.body, n.tags, <effTier> AS tier
FROM recipe_notes n
LEFT JOIN members m ON m.id = n.author
WHERE n.recipe = ?1 AND (
     n.author = :member                       -- own notes, every tier
  OR <effTier> = 'public'                     -- anyone who can see the recipe
  OR (<effTier> = 'friends' AND (
        :profile = 'self-hosted'              -- implicit all-to-all (D9): everyone
     OR m.tenant = :tenant                    -- author's household = viewer's
     OR m.tenant IN (<friend-seam(:tenant)>)  -- author's household is a friend
  ))
)
-- anonymous viewer (the /cookbook page; recipe already anonymously visible):
--   WHERE n.recipe = ?1 AND <effTier> = 'public'
```

- **Friends tier semantics**: a friends note is visible where the *author's household* is the viewer's own or a friend of it. Friendship is symmetric, so this is equivalently "the author's household is in the viewer's lens households" — the same relation the lens predicate uses, read through the **same named friend-seam provider** in `src/visibility.ts` (empty relation under SaaS until the households change fills it; bypassed under self-hosted). One seam, zero drift: when `households-friends-and-people-page` lands the `friendships` subquery, notes inherit it with no notes-side edit.
- **Under self-hosted** the friends arm admits every member — byte-equivalent to today's `private = 0` behavior, which is D30's forcing constraint (a defaulted note must behave exactly like today's shared note). Combined with the migration mapping, a self-hosted deployment sees zero change anywhere but the composer.
- **Private is member-level**: the own-notes arm matches `n.author = :member` (the resolved member id), not the tenant. **Legacy-row semantics, decided deliberately**: legacy private notes carry `author` = founding member (= tenant id), so after the People change mints member #2, a pre-split private note remains visible **only to the founding member** — correct, because the founding member was the only person who could have authored it. It is *not* household-visible: D30-final says private = author-only, and the household tier that "my household may see my private notes" would approximate was deliberately dropped. Behavior today (every household single-member) is identical either way.
- **`LEFT JOIN members` + `COALESCE(m.handle, n.author)`** for the handle: the identity-split invariant makes every author a members row (its gated capture asserts it), but the read must not drop a note if the invariant is ever violated; the author id doubles as the historical username, which is exactly what founding handles are. The same join row supplies `m.tenant` for the friends arm — one join serves both needs. Own/other partitioning stays a return-shape concern (the tools/API label own notes; the app splits on `author`).
- **Retroactivity is free**: the predicate is computed per read over live `friendships` rows and the live `tier` column — creating/severing a friendship or editing a tier changes the next read in both directions, with no materialized state to reconcile. The spec states it as a requirement so no future change may materialize visibility without revisiting it.

*Alternative rejected:* filtering tiers in JS after the existing query. The current SQL already embeds the visibility rule (`private = 0 OR author = ?`); moving the rule out of SQL would ship every non-visible note's body to the Worker on each read and split the rule across layers.

### 4. Tool contract: `tier` param + `tier`/`handle` returns; `private` demoted to a deprecated alias

- `add_recipe_note(slug, body, tags?, tier?, private?)` — `tier: z.enum(["public","friends","private"]).optional()`, default **`friends`** (D30-final, both profiles). `private` stays accepted as a **deprecated alias** (`true` → `private`, `false` → `friends`) so stale plugin bundles keep working (the lens change's stale-plugin posture on `create_recipe`); when both are passed, `tier` wins and the alias is ignored. Returns `{ slug, author, created_at, tier }`.
- `update_recipe_note(slug, created_at, body?, tags?, tier?, private?)` — same alias rule; passing `tier` re-tiers the note (this IS the tier-change surface — no separate op); omitted fields unchanged. Returns `{ slug, author, created_at, tier }`.
- `read_recipe_notes(slug)` — notes entries become `{ author, handle, created_at, body, tags, tier, private }` where `private` is **derived** (`tier === 'private'`) and documented deprecated, kept one band for stale readers; `favorites` unchanged. Tool description owns the visibility guarantees (tiers, lens bound, anonymous rule) — skills stay choreography-only.
- `remove_recipe_note` unchanged.
- **D15 classification, checked and kept**: note create/update/delete are class (b) idempotent writes keyed on `(author, slug, client-minted created_at)` and are already registered offline mutations. `tier` rides the existing note upsert/edit exactly as `location` rides the pantry upsert — same key, same replay semantics, no new writer, no `member-app-offline` delta.

### 5. `/api` surface: same fields, member-stamped author, `anonymously_visible` on the notes GET

- POST/PATCH gain `tier` (validated against the enum; legacy `private` boolean still accepted with the same alias rule); GET returns `tier` + `handle` per note. Response/request typing flows through the app's typed client.
- **Author stamping unifies on the resolved member**: the four notes routes switch `tenant.id` → `tenant.member` (byte-identical today; correct at member #2). If the in-flight identity-split implementation has already done this by implementation time, the task is a no-op check. Flagged to the orchestrator as an observed divergence rather than silently absorbed.
- The notes GET response gains **`anonymously_visible: boolean`** for the recipe (one `isVisible(anonymous, slug)` point query) — the datum design request #9's conditional Public copy needs. It lives on the notes GET because it exists for the composer; the detail payload is untouched.

### 6. Anonymous `/cookbook/<slug>`: a net-new public-notes section, sanitized, public tier only

The public site renders no notes today, so D30-final's anonymous clause is net-new rendering, not a filter change. The recipe page (`packages/worker/src/cookbook.ts`) gains a notes section rendered **only when** the recipe is anonymously visible (the page already 404s otherwise, lens change) **and** public-tier notes exist — no empty-section chrome. Each note renders handle-attributed ("@handle") with its tags as plain text and its body through the **same raw-HTML-dropping `marked` renderer** the recipe body already uses; the CSP posture is untouched. The anonymous query is tier-scoped in SQL (`<effTier> = 'public'`) — friends/private rows never leave D1 for this surface, under either profile. This is the only tier that ever reaches the anonymous surface; the threat-model task (tasks §8) walks the new exposure explicitly (member-authored content newly rendered to anonymous visitors: sanitization, attribution, tier-scoped query, no enumeration surface beyond the already-visible recipe).

*Alternative rejected:* deferring anonymous rendering ("public" = member surfaces only). It would make `public` indistinguishable from `friends` under self-hosted and contradict D30-final's explicit anonymous clause; the composer copy design request #9 mandates ("including the public cookbook site") would be false.

### 7. Composer and note list (design request #9, encoded)

- **Control**: `SegmentedControl` from `packages/ui` (the Time-filter treatment the brief names), three options Public / Friends / Private, **Friends pre-selected** (never neutral), replacing the `.note-priv` checkbox. Beneath it, one line of description for the selected tier: Friends — "Your household and friends can see this"; Private — "Only you"; Public — "Anyone who can see this recipe — including the public cookbook site if this recipe is public".
- **Conditional Public copy**: when the notes GET reports `anonymously_visible: false`, the Public option stays selectable but its description reads "Visible to everyone who can see this recipe — it isn't on the public site, so this note won't be either".
- **Chips on rendered notes**: non-Friends notes carry a small tier indicator — a lock glyph for Private (replacing today's `note-priv-badge`), a globe for Public; Friends renders unmarked. Community notes show author **handle** + tag chips.
- **Edit state**: `OwnNote`'s inline editor gains the same segmented control seeded with the note's current tier; the PATCH sends `tier` alongside `body` (today's edit path sends only `body` — it grows, key unchanged).
- The free-text tag input and edit/delete affordances are untouched (the tag-UI contract belongs to `recipe-detail-tweaks`; see Risks for the collision).
- **Test surface**: `packages/worker/app/visual/pages/recipe.page.ts` (`addNote({ priv })` → `{ tier }`) and `app/visual/specs/cookbook.spec.ts` extend to the three tiers, the chips, the conditional copy, and the edit-state control; `aubr test:app`.

### 8. Docs and persona lockstep (Appendix C band 5 — the notes line binds HERE)

- `docs/TOOLS.md`: notes tools gain the `tier` param/alias/returns; `read_recipe_notes` documents the tiered visibility guarantees (own always; friends = author household + friends, everyone under self-hosted; public = recipe's audience incl. the anonymous surface where the recipe is anonymously visible; private = author-only) replacing the "own private + everyone's shared" sentence.
- `docs/SCHEMAS.md`: `recipe_notes` gains `tier` (with the legacy-derived `private` note and the NULL-healing rule); the aggregate-read sentence is re-worded to tiers.
- `packages/worker/AGENT_INSTRUCTIONS.md`: the notes skill block (the "defaults to shared… pass `private: true` only when I say it's just for me" line) becomes tier vocabulary — default friends; "just for me" → `tier: "private"`; "share it on the public cookbook" → `tier: "public"` with the recipe-lens caveat; the group-signal and capture-tweaks lines stay truthful unmodified. The lens change explicitly assigned this Appendix C line here and carried only its own corpus-tier neutralization. Run `aubr build:plugin --check`.

### 9. Gated production capture (member-identity-split task 8.1 precedent)

Remote reads were permission-denied during planning. Pre-merge, operator-gated, read-only: `SELECT COUNT(*), SUM(private = 1) FROM recipe_notes;` (the migration fixture — post-migration `tier='private'`/`tier='friends'` counts must equal it), `SELECT COUNT(*) FROM recipe_notes WHERE tier IS NULL;` (post-migration, expect 0), and re-run the identity-split's `SELECT DISTINCT author FROM recipe_notes WHERE author NOT IN (SELECT id FROM members);` (expect empty — the handle join's ground truth). Divergent observations become test fixtures before merge.

## Risks / Trade-offs

- **[Rollback widens a private note's audience]** → Decision 2's dual-write (`private` kept in sync) makes the previous Worker's read correct for new rows; NULL-healing reads make post-rollback rows correct after re-deploy. The one-way-safe direction is chosen everywhere.
- **[Public notes on curated recipes are deployment-wide speech]** Under SaaS, a public note on a curated recipe renders for every household and for anonymous visitors — a new cross-household content surface. → Accepted by D30-final explicitly ("public = anyone who can see the recipe"); mitigations: handle attribution (accountability), the operator's member-revoke purges the member's `AUTHOR_TABLES` rows (notes included, identity-split D7), and the tier is a deliberate authoring choice with the composer stating the audience. Flagged to the orchestrator as the change's main product-risk acceptance.
- **[XSS / content injection on the anonymous surface]** → the public page renders note bodies through the existing raw-HTML-dropping renderer under the existing CSP; tags/handles render as text; the threat-pass task walks it; Playwright asserts a script-bearing note body renders inert.
- **[recipe-notes spec collision with `recipe-detail-tweaks`]** Band 2's tag-UI delta on `recipe-notes` had not landed at planning time; both changes copy MODIFIED blocks from the same living text. → Whichever archives second rebases its delta blocks onto the then-current spec text (mechanical: this change's edits touch tier/visibility sentences, that change's touch tag-UI sentences). Tasks carry the rebase check.
- **[Deltas target text the lens change introduces]** The `shared-corpus` and `data-read-tools` blocks here modify requirement text ADDED/MODIFIED by `deployment-profiles-and-visibility-lens`. → This change implements and archives strictly after the lens change (band order); the delta blocks were copied from that change's ratified artifacts; tasks re-verify against the archived text.
- **[Households change unwritten at planning time]** The friend-seam contract consumed here is taken from the lens change's ratified design (named provider, symmetric accepted-only edges keyed by tenant), not from households artifacts. The migration number (0061) assumes households takes 0060. → Both pinned as pre-implementation checks in tasks; the seam contract is stated in the lens change's spec delta, so households cannot reshape it without violating its own contract.
- **[Divergent author stamping on `/api`]** If the identity-split implementation lands the member stamp on `/api` notes routes first, this change's unification task is a no-op; if not, this change carries it. Either way the observed divergence is reported to the orchestrator rather than silently owned twice.
- **[Stale plugins pass `private`]** → the alias mapping keeps them working with today's exact semantics (`true` → private, `false`/omitted → friends = today's shared behavior under self-hosted); `tier` wins on conflict; TOOLS.md marks the alias deprecated.

## Migration Plan

1. Land the migration (Decision 1) and the tier-aware code in one deploy (migrations apply before traffic): reads switch to the tier predicate with NULL-healing; writes dual-write `tier` + `private`.
2. Self-hosted deployments observe zero behavior change (friends ≡ today's shared, private ≡ today's private, the anonymous full-corpus site now also shows public notes — of which zero exist at migration time, since nothing maps to `public`).
3. Pre-merge gated capture (Decision 9) records production counts; post-deploy the same queries verify the mapping.
4. Rollback: revert the Worker deploy. Old code reads `private` (dual-written, correct), ignores `tier`; rows inserted during the window have NULL `tier` and heal on re-deploy via the COALESCE read and a re-run of the idempotent backfill (safe to re-apply by hand-shipping the same NULL-guarded UPDATE in a follow-up migration if the window saw writes).

## Open Questions

None left open for the implementer. Resolved here: legacy private-row semantics (Decision 3 — founding-member-only, deliberately), the tier-change write path (Decision 4 — rides `update_recipe_note`/PATCH, no new op), the `private` alias/return deprecation posture (Decision 4), the anonymous-rendering question (Decision 6 — the page renders no notes today; the public section is net-new), the composer's data need (Decision 5 — `anonymously_visible` on the notes GET), and the D15 classification (Decision 4 — class (b) unchanged). Two items are flagged to the orchestrator, not open for implementation: the public-tier product-risk acceptance and the `/api` author-stamp divergence (Risks).
