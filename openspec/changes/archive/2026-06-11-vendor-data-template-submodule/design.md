## Context

`docs/data-repo-workflows/` holds reference copies of three caller workflows (`deploy.yml`, `onboard.yml`, `revoke.yml`) plus a README mapping them to this repo's reusable workflows. The live source of truth is `caseyWebb/groceries-agent-data-template` (public), which ships all five callers under `.github/workflows/` plus the full data layout (`recipes/`, `ready_to_eat/`, `users/`, `wrangler.jsonc`, stubs). The copies have already drifted from the template. A submodule replaces the copy with the real repo, pinned to a SHA the operator bumps deliberately.

## Goals / Non-Goals

**Goals:**
- One in-repo, versioned, always-correct view of the data template.
- Remove the drifting partial copy without losing its explanatory prose.
- Land before `relocate-ready-to-eat-to-profile` so that change edits the template in-repo.

**Non-Goals:**
- Auto-syncing the submodule to the template's `main` (it pins a SHA on purpose).
- Making CI build or test the submodule (it is reference only).
- Changing any reusable workflow or the operator self-hosting procedure itself — only where the reference *lives*.

## Decisions

### Mount at `docs/data-template/`
Reference material belongs under `docs/` per repo convention; the name says "data template," and the location signals "for reading, not the buildable worker at the root." It directly succeeds the `docs/data-repo-workflows/` it replaces.
*Alternatives:* root `data-repo-template/` (more discoverable but looks buildable beside `src/`); hidden `.data-template/` (out of the way but obscure). Rejected in favor of the docs-reference framing.

### Submodule, not subtree or vendored copy
A submodule keeps the template's own history and identity intact and makes "bump to latest" a one-liner (`git submodule update --remote`). A subtree merge or a fresh copy would re-introduce exactly the drift this removes.
*Trade-off:* contributors must `git submodule update --init` after clone to populate it; documented in `CLAUDE.md`/`README.md`. Since it is reference-only, a missing checkout never breaks build or test.

### Preserve the README prose into `docs/SELF_HOSTING.md`
The deleted README carries real value: the caller→reusable mapping table and the rationale for running workflows in the private data repo (invite codes out of public logs). That belongs with the operator self-hosting guide, repointed at `docs/data-template/.github/workflows/` as the canonical example. The stale "copy deploy/onboard/revoke if your repo predates them" note is dropped, since the template now ships them.

### CI untouched
`actions/checkout@v4` defaults to `submodules: false`. `ci.yml` runs typecheck + tests over this repo's own sources, which do not import the submodule. No workflow change needed; explicitly *not* adding `submodules: recursive` so CI stays fast and decoupled.

## Risks / Trade-offs

- **Stale pointer** (submodule SHA lags the template) → mitigated by documenting the `--remote` bump and by it being reference-only — a lagging pointer misleads no build, only a reader, who can bump it.
- **Clone friction** (fresh clone has an empty `docs/data-template/`) → mitigated by a one-line note in `CLAUDE.md`/`README.md`; reference-only so nothing breaks if skipped.
- **Public-on-public coupling** → none beyond what already exists (the template already publicly depends on this repo's reusable workflows).

## Migration Plan

1. `git submodule add https://github.com/caseyWebb/groceries-agent-data-template docs/data-template` → creates `.gitmodules` + the pinned pointer.
2. Move the README's mapping table + rationale into `docs/SELF_HOSTING.md`; repoint at `docs/data-template/.github/workflows/`.
3. `git rm -r docs/data-repo-workflows`.
4. Update `CLAUDE.md` reference paths.
*Rollback:* `git submodule deinit`, remove the `.gitmodules` entry and the pointer, restore the directory from history.

## Open Questions

- None blocking. (Mount path and scope settled during exploration.)
