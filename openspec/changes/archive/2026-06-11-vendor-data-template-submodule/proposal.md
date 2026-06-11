## Why

The public code repo and the private data repos are coupled by contract — operators' data repos call this repo's reusable workflows, and `relocate-ready-to-eat-to-profile` will change a data-repo file (`ready_to_eat.toml`). Today the only in-repo view of that contract is `docs/data-repo-workflows/` — hand-maintained reference *copies* of three of the five caller workflows. They've already drifted: the README still says to copy `deploy.yml`/`onboard.yml`/`revoke.yml` from there if a data repo predates them, but the live template (`caseyWebb/groceries-agent-data-template`, public) now ships all five callers plus the full data layout.

Vendoring the template as a git submodule replaces a drifting partial copy with the real, versioned thing — an always-correct local reference, and a place to make data-repo edits (like the RTE relocation) in-repo and bump the pointer. This lands **first** so `relocate-ready-to-eat-to-profile` can edit the template through the submodule rather than as an out-of-repo coordinated change.

## What Changes

- Add `caseyWebb/groceries-agent-data-template` as a git submodule at **`docs/data-template/`** (reference location; signals "for looking at, not building from").
- **Remove `docs/data-repo-workflows/`** — its `deploy.yml`/`onboard.yml`/`revoke.yml` copies are now in the submodule under `.github/workflows/`.
- **Preserve the deleted README's content** — the caller→reusable-workflow mapping table and the "run it in your data repo, not a fork, so invite codes stay out of public logs" rationale — into `docs/SELF_HOSTING.md`, repointed at `docs/data-template/.github/workflows/` as the live reference. Drop the now-false "copy these if your data repo predates them" note.
- Update `CLAUDE.md`'s references to `docs/data-repo-workflows/` to point at the submodule.
- Document the refresh ritual (`git submodule update --remote` to bump the pinned SHA) — the reference is easy to update, not auto-tracking.

## Capabilities

### New Capabilities
<!-- None — this is repo-structure plumbing and reference hygiene. -->

### Modified Capabilities
- `repo-structure`: the data template is vendored as a submodule at `docs/data-template/`; the duplicated caller-workflow reference copies under `docs/data-repo-workflows/` are removed and their explanatory content preserved in `docs/SELF_HOSTING.md`.

## Impact

- **New:** `.gitmodules`, the `docs/data-template/` submodule pointer.
- **Removed:** `docs/data-repo-workflows/` (4 files).
- **Edited:** `docs/SELF_HOSTING.md` (absorb the mapping table + rationale), `CLAUDE.md` (reference path).
- **CI:** none — `actions/checkout` does not fetch submodules unless asked, so `ci.yml` is unaffected.
- **Downstream:** unblocks `relocate-ready-to-eat-to-profile` task 5.1 (edit the template's `ready_to_eat/` layout in-repo via the submodule).
