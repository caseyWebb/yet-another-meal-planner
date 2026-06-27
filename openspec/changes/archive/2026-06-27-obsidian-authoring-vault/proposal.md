## Why

Once the corpus lives in R2 (`r2-recipe-corpus`), authoring is **Obsidian → Remotely Save → R2**. But hand-authoring the controlled-vocabulary frontmatter (`protein`, `cuisine`, `course`, `dietary`, `season`, `requires_equipment`) is error-prone, and with CI gone the immediate "you typed an invalid value" feedback is gone with it (the reconcile catches it, but only *eventually*). Obsidian's **native** properties have no constrained-enum/dropdown type — it is a long-standing, still-unimplemented feature request.

A shipped, preconfigured Obsidian vault fixes both problems at once. Using the **Metadata Menu** community plugin's `fileClass` + `Select`/`Multi` fields, each vocab-bound facet becomes a **dropdown constrained to the exact vocabulary** — so an author *cannot type* `poltry`; the dropdown only offers valid values. That is **client-side vocabulary enforcement**: it restores the fast, in-your-face validation loop CI used to provide, but at the *editing* surface, with the reconcile's server-side validation as the backstop. Add a "new recipe" template, help text, and styling, and authoring is turnkey.

Critically, the dropdown options must come from the **same source of truth** as the server validator (`src/vocab.js`) or they will drift. So the vault is a **generated, committed artifact** built from `vocab.js` — exactly the pattern the repo already runs twice (`plugin/` from `AGENT_INSTRUCTIONS.md`, `admin/dist/` from `admin/src/`). The vault becomes the third generated artifact, with a `--check` drift gate.

## What Changes

- **A new `vault-template/` source tree + `scripts/build-vault.mjs`** (deterministic, `--check`) that emits a committed, distributable Obsidian vault with `.obsidian/` preconfigured:
  - **Metadata Menu** `fileClass` for `recipe`: each vocab-bound field a `Select`/`Multi` whose options are **generated from `src/vocab.js`** (`PROTEIN_VOCAB`, `CUISINE_VOCAB`, `SEASON_VOCAB`, `EQUIPMENT_VOCAB`, the open `course` set);
  - a **Templater/QuickAdd** "New recipe" command inserting the human-authored frontmatter skeleton + body scaffold (only the fields a human authors — derived fields like `description` are deliberately **absent**, per `derived-recipe-metadata`);
  - a **help note** ("How to add a recipe") and CSS snippets for the editing surface;
  - bundled (vendored) plugins so the vault works on open.
- **`vocab.js` is the single source** for the dropdown options; CI runs `build-vault --check` to fail on drift, so the vault's dropdowns can never disagree with the server validator.
- **Distribution** is a zip/repo an author opens as a vault; one-time "trust author & enable plugins" + entering their own Remotely Save R2 credentials (per-author secret, not shipped).
- **Scope** is explicitly an **author tool** (operator + a few co-authors who write the shared corpus), **not** friend-group-wide. Friends consume recipes via the agent and read via the cookbook site; they need no vault.

## Capabilities

### New Capabilities
- `recipe-authoring-vault`: the generated, distributable Obsidian authoring vault — its build-from-`vocab.js` contract, the constrained-dropdown client-side validation it provides, the human-authored-fields-only schema (no derived fields), and its committed-artifact + `--check` drift discipline.

## Impact

- **New (code repo):** `vault-template/**` (authored source: the `.obsidian/` config template, the Metadata Menu fileClass template, the recipe template, the help note, CSS), `scripts/build-vault.mjs`, the committed built vault output, an `aubr` script (`build:vault`), a build-tooling test.
- **Edited:** CI runs `build-vault --check` (drift gate, mirroring the plugin/admin build checks); `docs/SELF_HOSTING.md` gains an "authoring in Obsidian" section; `docs/ARCHITECTURE.md` notes the third generated artifact and the client-side-validation role.
- **Dependencies/relationships:** requires `r2-recipe-corpus` (the sync target) to be useful; composes with `derived-recipe-metadata` (the vault schema **omits** derived fields — they are D1-owned — and, if a later change adds AI facet *proposal*, the dropdowns become the human *confirmation/correction* surface, especially for the safety field `dietary`).
- **Out of scope:** a non-Obsidian web authoring UI; AI facet proposal/repair (a separate change); per-author R2 credential provisioning beyond documenting it.
