## 1. Directory skeleton

- [x] 1.1 Create directories: `recipes/`, `ready_to_eat/`, `skus/`, `_indexes/`, `worker/`, `scripts/`, `.github/workflows/`, `docs/`
- [x] 1.2 Add `.gitkeep` to directories that ship with no content: `recipes/`, `_indexes/`, `worker/`, `scripts/`, `.github/workflows/`

## 2. Stub data files (TOML)

- [x] 2.1 Create `pantry.toml` with header comment + commented-out `[[items]]` examples per SCHEMAS.md
- [x] 2.2 Create `preferences.toml` with header + commented examples (`default_cooking_nights`, `lunch_strategy`, `[brands]`, `[stores]`, `[dietary]`)
- [x] 2.3 Create `substitutions.toml` with header + commented `[[rules]]` examples
- [x] 2.4 Create `aliases.toml` with header + commented `[aliases]` examples
- [x] 2.5 Create `feeds.toml` with header + commented `[[feeds]]` examples
- [x] 2.6 Create `stockup.toml` with header + commented `freezer_capacity_estimate` and `[[items]]` examples
- [x] 2.7 Create `ingredients.toml` with header comment only, marked RESERVED for Phase 7 (no active/example entries)
- [x] 2.8 Create `skus/kroger.toml` with header + commented `[[mappings]]` examples
- [x] 2.9 Create `ready_to_eat/breakfast.toml`, `ready_to_eat/lunch.toml`, `ready_to_eat/dinner.toml`, each with header + commented `[[items]]` and `[variety_rules]` examples
- [x] 2.10 Verify every stub TOML parses cleanly (e.g. with a TOML parser / `yq`)

## 3. User-curated narrative stubs

- [x] 3.1 Create `taste.md` with the Loves / Dislikes / Notes headings and placeholder content
- [x] 3.2 Create `diet_principles.md` with the Variety targets / Restrictions / Reasoning headings and placeholder content

## 4. Canonical docs placement

- [x] 4.1 Confirm `CLAUDE.md` is at the repo root (already present from initial commit)
- [x] 4.2 Move `PROJECT.md`, `SCHEMAS.md`, `TOOLS.md` into `docs/` (use `git mv` to preserve history)
- [x] 4.3 Rename `BUILD-SEQUENCE.md` → `ROADMAP.md`, kept at the repo root (use `git mv`)
- [x] 4.4 Update any references to the moved/renamed docs to their new paths (CLAUDE.md already points to `docs/TOOLS.md`; check README, ROADMAP, and the docs themselves for cross-references)

## 5. Repo metadata

- [x] 5.1 Create `README.md` explaining the project (what it is, architecture summary, how to use the repo, pointers to `docs/PROJECT.md` and `CLAUDE.md`)
- [x] 5.2 Create `.gitignore` covering Node (`node_modules/`, build output), OS (`.DS_Store`), editor files, and Cloudflare Worker secrets (`.dev.vars`, `.wrangler/`)

## 6. Verification

- [x] 6.1 Verify a fresh `git clone` (or `git archive` extract) reproduces the full directory tree from PROJECT.md
- [x] 6.2 Confirm all stub TOML files parse and all required files/directories from the spec are present
- [x] 6.3 Commit the skeleton; push to the private GitHub repo
