## Context

The repo already ships two generated, committed artifacts built from a single source: `plugin/` (from `AGENT_INSTRUCTIONS.md`, via `build-plugin.mjs`) and `admin/dist/` (from `admin/src/`, via `build-admin.mjs`, per `operator-admin-panel`), both with a `--check` drift gate in CI. An authoring vault generated from `src/vocab.js` is the same pattern a third time. The vocab modules (`PROTEIN_VOCAB`, `CUISINE_VOCAB`, `SEASON_VOCAB`, `EQUIPMENT_VOCAB`) are the server validator's source of truth; the vault's dropdowns must derive from them or drift.

Obsidian native Properties (1.4+) have typed properties (text/list/number/checkbox/date) but **no constrained enum/select** — confirmed an open feature request. The community plugin **Metadata Menu** provides `Select` (single) and `Multi` (multi) field types with preset options, organized by `fileClass` (a per-note-type schema). That is the mechanism for vocab-bound dropdowns.

## Goals / Non-Goals

**Goals**
- A turnkey, shippable Obsidian vault that makes corpus authoring easy and **valid-by-construction** for vocab-bound fields.
- Dropdown options generated from `src/vocab.js` (single source of truth), with a `--check` drift gate.
- A vault schema that contains **only human-authored fields** — derived fields (`description`, and any future derived field) are absent, per the placement rule in `ai-derived-recipe-metadata`.

**Non-Goals**
- A friend-group-wide tool — this is for the few corpus authors. Friends read via the agent/cookbook.
- A non-Obsidian web authoring UI.
- AI facet proposal/repair — a separate change; this vault is where a human would *confirm* such proposals if/when they exist.
- Shipping per-author secrets (R2 credentials are entered per author).

## Decisions

1. **Metadata Menu for constrained dropdowns.** Native properties lack enum; Metadata Menu's `fileClass` + `Select`/`Multi` is the established way to bind a field to a fixed option set. Vendor it (and a minimal companion set — likely Templater or QuickAdd for the new-recipe command) into the shipped `.obsidian/`.

2. **Generate the vault from `vocab.js`; never hand-maintain options.** `build-vault.mjs` reads the vocab modules and emits the Metadata Menu fileClass options, so the dropdowns and the server validator share one source. CI `build-vault --check` fails on drift — the exact discipline `plugin/` and `admin/dist/` already use. This is the load-bearing decision: it is what makes client-side and server-side validation provably agree.

3. **The vault schema is human-authored fields only.** It exposes `title`, `ingredients_key`, `course`, `protein`, `cuisine`, `time_total`, `source`, `dietary`, `season`, `tags`, `pairs_with`, `perishable_ingredients`, `requires_equipment`, `side_search_terms` — and **omits** `description` (derived, D1-owned per `ai-derived-recipe-metadata`). A derived field has no authoring control because no human authors it. This keeps the two changes coherent: change 1 decides *what is derived*; this change simply doesn't offer those fields.

4. **Committed built artifact, not a build step for the author.** The author downloads a ready vault; they need no Node/Elm/build toolchain. Treat the built vault like `plugin/`/`admin/dist/` — generated, committed, never hand-edited; the authored source is `vault-template/`.

5. **Client-side validation is a convenience + fast feedback, not the security boundary.** The reconcile's server-side `validate.ts` remains authoritative (an author could disable plugins, or edit outside the vault). The dropdowns make the *common path* valid-by-construction and give instant feedback; they do not replace the backstop. This is the honest framing — it complements `r2-recipe-corpus`'s eventual server feedback, it doesn't substitute for it.

## Risks / Trade-offs

- **[Restricted Mode friction]** Obsidian disables community plugins until the user trusts the vault. **Mitigation:** unavoidable for community plugins; a one-time click, documented; fine for a small trusted author set.
- **[Vendored plugins don't auto-update]** the shipped snapshot ages. **Mitigation:** re-bundle on a vocab/plugin change (the artifact is rebuilt anyway when vocab changes); the same maintenance tail the plugin bundle already has.
- **[Plugin security]** community plugins have full filesystem access; shipping them asks authors to trust the bundle. **Mitigation:** small trusted group; documented; pin plugin versions.
- **[Drift if generation is bypassed]** a hand-edited fileClass would desync from `vocab.js`. **Mitigation:** `build-vault --check` in CI; `vault-template/` (source) vs the built vault (generated) treated like the other generated artifacts.
- **[Per-author R2 creds]** authors need write credentials to the shared bucket. **Mitigation:** scoped per-author R2 tokens (decided with `r2-recipe-corpus`) — revoking one author doesn't rotate the rest; entered per author, never shipped in the vault.

## Open Questions

- **Plugin set:** Metadata Menu (certain) + Templater vs. QuickAdd for the new-recipe flow; whether Linter is worth bundling for frontmatter tidiness. Keep the set minimal.
- **Mobile vs desktop:** Metadata Menu and Remotely Save both work on mobile; confirm the dropdown UX is acceptable on phones (authors may add recipes from a phone).
- **Help-text mechanism:** Metadata Menu field tooltips vs. a pinned help note vs. template comments — likely a combination.
- **Credential distribution — RESOLVED: scoped per-author R2 tokens** (decided with `r2-recipe-corpus`). The vault ships everything except the sync credential; each author pastes their own scoped Remotely Save token. Open sub-question: admin-panel-minted vs. dashboard-created.
- **Cookbook reader for friends:** confirm the friend read-path is the cookbook site (not a shipped read-only vault), so this artifact stays author-only.

## Implementation refinements (resolved during apply)

1. **Plugin set — RESOLVED: Metadata Menu + Templater + Remotely Save.** Templater (not QuickAdd) drives the new-recipe flow via a `recipes/` **folder template** (`trigger_on_file_creation`), so creating a note there scaffolds the human-authored frontmatter automatically. Linter is **not** bundled (keep the set minimal). Pins live in `vault-template/plugin-pins.json`.

2. **Course options — `COURSE_SUGGESTIONS`, not a controlled vocab.** `course` is open server-side (shape-validated only — see `recipe-contract.js` / ARCHITECTURE.md), so the build sources its dropdown from a new `COURSE_SUGGESTIONS` export in `src/vocab.js` that is explicitly **non-enforced**: the vault offers it as an open Multi (the author may still add a value), while `protein`/`cuisine`/`season`/`requires_equipment` are strictly constrained. This keeps every dropdown's options in one module (`vocab.js`) without misrepresenting `course` as closed.

3. **Plugin binaries are vendored, not committed.** The committed `vault/` carries the generated config + each plugin's small `manifest.json`; the multi-MB `main.js`/`styles.css` are fetched by `build-vault --fetch-plugins` (sha256-verified from the pins) into the distributable and **gitignored**. This keeps the public repo free of large third-party bundles and keeps `build-vault --check` **offline** (it validates only the deterministic, vocab-derived config — the actual drift gate), at the cost of one fetch step when packaging the distributable (documented in SELF_HOSTING).

4. **Help text — combination.** A pinned "How to add a recipe" note (the one-time trust + R2-credential setup and the authoring flow), Templater-comment guidance in the template, and a generated banner in the fileClass note. Metadata Menu field tooltips were not pursued (the note + banner suffice).

5. **Mobile vs desktop:** not separately verified during apply — Metadata Menu and Remotely Save both support mobile; the dropdown UX on phones remains a manual check (task 4.2).
