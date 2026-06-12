## 1. `profile_status` read tool (per-tenant)

- [x] 1.1 Add `src/profile-status.ts` with a pure `deriveProfileStatus(entries: DirEntry[] | null)` → `{ initialized, missing }`: a fixed area→file mapping (`store`→`preferences.toml`, `taste`→`taste.md`, `diet`→`diet_principles.md`, `equipment`→`kitchen.toml`, `pantry`→`pantry.toml`, `ready-to-eat`→`ready_to_eat.toml`, `stockup`→`stockup.toml`, `corpus`→`overlay.toml`); `initialized = preferences.toml present`; `missing` = area keys whose file is absent; `entries === null` (a 404 subtree) → `{ initialized: false, missing: <all keys> }`.
- [x] 1.2 In the same module add `profileStatus(gh: GitHubClient)` that calls `gh.listDir("")` and returns `deriveProfileStatus(entries)`, catching `GitHubError` 404 → `deriveProfileStatus(null)` and mapping other `GitHubError`s to a structured `upstream_unavailable` (mirrors `storage-guidance`'s catch). Mirror the `fakeGh({ dir })` testing seam used by `storage-guidance`.
- [x] 1.3 Register `profile_status` in `src/tools.ts` against the **prefixed (per-tenant)** `gh` client: empty `inputSchema`, body `() => runTool(() => profileStatus(gh))`. Description: returns `{ initialized, missing }` from one subtree listing; `initialized` true once `preferences.toml` exists; a brand-new member (no subtree) is `initialized: false` with all areas missing; never writes.
- [x] 1.4 Add `test/profile-status.test.ts`: `deriveProfileStatus` unit cases (all files present → `initialized: true`, `missing: []`; `preferences.toml` only → `true` with the rest in `missing`; `null` → `false` with all keys; absent `preferences.toml` but other files present → `false`); plus `profileStatus` against a fake client where `listDir` throws `GitHubError(404)` (→ all-missing) and where it throws a 500 (→ structured `upstream_unavailable`).

## 2. Initialization gate in `grocery-core`

- [x] 2.1 Add the gate paragraph to the `<!-- persona: core -->` tier of `AGENT_INSTRUCTIONS.md`: before the first substantive action in a session, call `profile_status`; on `initialized: false`, run `configure-grocery-profile` (passing `missing` so completed areas are skipped) and then resume the original request; **fail open** — if the call errors, proceed normally; **skip the gate** when the active flow is itself `configure-grocery-profile` or `report-grocery-agent-bug`.
- [x] 2.2 Confirm the `configure-grocery-profile` flow reads `missing` as its area-skip hint (it already does per-area resumability — reference `profile_status` as the cheap up-front snapshot rather than the existing read-by-read probing). No behavior change beyond the reference.
- [x] 2.3 Run `npm run build:plugin` (mise env supplies `GROCERY_MCP_URL`) to regenerate the `plugin/grocery-agent/` bundle from the edited source (never hand-edit `plugin/`). Gate text verified in `skills/grocery-core/SKILL.md`; connector URL preserved.

## 3. Docs

- [x] 3.1 Add a `profile_status()` entry to `docs/TOOLS.md` (no params; per-tenant; returns `{ initialized, missing }`; derived from one `listDir` of the caller's subtree; 404 subtree = not initialized), keeping the tool contract in sync with the implementation.

## 4. Verify

- [x] 4.1 Run the test suite and the typecheck (`npm test`, `npm run typecheck`; plus `npm run test:tooling` for the regenerated bundle) and confirm `profile-status.test.ts` passes and the bundle regenerates cleanly. Result: typecheck clean, 455 Worker tests + 75 tooling tests pass.
