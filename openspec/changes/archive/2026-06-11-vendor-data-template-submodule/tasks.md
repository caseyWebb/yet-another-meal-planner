## 1. Add the submodule

- [x] 1.1 `git submodule add https://github.com/caseyWebb/groceries-agent-data-template docs/data-template` — creates `.gitmodules` + the pinned pointer.
- [x] 1.2 Verify `git submodule status` shows `docs/data-template` at a real SHA and `docs/data-template/.github/workflows/` lists all five callers.

## 2. Preserve and relocate the reference prose

- [x] 2.1 In `docs/SELF_HOSTING.md`, absorb the deleted README's caller→reusable-workflow mapping table and the "run it in your private data repo, not a fork, so invite codes stay out of public logs" rationale; point at `docs/data-template/.github/workflows/` as the live example. Drop the stale "copy deploy/onboard/revoke if your data repo predates them" note (the template ships them now).
- [x] 2.2 `git rm -r docs/data-repo-workflows`.

## 3. Update in-repo references

- [x] 3.1 Update `CLAUDE.md` — replace the `docs/data-repo-workflows/` mention with `docs/data-template/` (the submodule) as the reference for the data-repo caller workflows. Also added the submodule init/`--remote` ritual to the `## Toolchain` setup section so it's discoverable up front.
- [x] 3.2 Add a one-line note to `README.md` (and/or `CLAUDE.md`) that the template is a submodule — run `git submodule update --init` after clone to populate it, `git submodule update --remote` to bump the reference.
- [x] 3.3 Grep the repo for any remaining `data-repo-workflows` references (docs, openspec prose) and repoint them.

## 4. Verification

- [x] 4.1 `npm run typecheck`, `npm test`, `npm run test:tooling` green (confirms the submodule does not affect build/test).
- [x] 4.2 `openspec validate "vendor-data-template-submodule"` passes.
- [x] 4.3 Fresh-clone smoke: confirmed `ci.yml` (`actions/checkout@v6`) does not fetch submodules and no built/tested source references `docs/data-template/`, so a clone without `--recurse-submodules` still builds/tests; `git submodule update --init` populates `docs/data-template/`.
