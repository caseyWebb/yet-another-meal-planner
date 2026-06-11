## ADDED Requirements

### Requirement: Data template vendored as a submodule

The repository SHALL vendor the public data-repo template (`caseyWebb/groceries-agent-data-template`) as a git submodule at `docs/data-template/`, providing an in-repo, versioned reference of the data-repo layout and the caller workflows it ships. The submodule SHALL pin a specific commit (not auto-track the template's default branch); refreshing the reference SHALL be a deliberate `git submodule update --remote` followed by committing the bumped pointer. Because the submodule is reference-only, the repository's build and test (`ci.yml`) SHALL NOT depend on it being checked out.

The repository SHALL NOT keep separate hand-maintained copies of the data-repo caller workflows under `docs/`; the submodule is the single in-repo reference. The explanatory content formerly in `docs/data-repo-workflows/README.md` — the mapping of each data-repo caller workflow to this repo's reusable workflow, and the rationale for running them in the private data repo — SHALL be preserved in `docs/SELF_HOSTING.md`, pointing at `docs/data-template/.github/workflows/` as the canonical example.

#### Scenario: Template is present as a submodule

- **WHEN** a developer initializes submodules (`git submodule update --init`) and inspects `docs/data-template/`
- **THEN** it contains the template's data layout and `.github/workflows/` caller workflows, tracked as a submodule via `.gitmodules`

#### Scenario: No duplicated caller-workflow copies remain

- **WHEN** the repository is searched for hand-maintained data-repo workflow copies
- **THEN** `docs/data-repo-workflows/` does not exist, and the caller→reusable-workflow mapping and rationale are found in `docs/SELF_HOSTING.md`

#### Scenario: CI does not require the submodule

- **WHEN** `ci.yml` runs on a checkout that has not fetched submodules
- **THEN** typecheck and the test suites still pass, because no built or tested source imports `docs/data-template/`
