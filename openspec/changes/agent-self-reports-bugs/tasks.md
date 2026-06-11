## 1. Worker — GitHub client + tool

- [x] 1.1 Add `createIssue(title, body, labels?)` to `GitHubClient` (`src/github.ts`): `POST /repos/{owner}/{repo}/issues` via the existing token/retry path; returns `{ url, number }`. Non-transient 403 stays a `GitHubError(403)`.
- [x] 1.2 Add `insufficient_permission` to the `ErrorCode` enum (`src/errors.ts`).
- [x] 1.3 Register `report_bug(title, body)` in `buildServer` (`src/tools.ts`): call `dataGh.createIssue(...)` (un-prefixed, repo-level) with a server-added trailer (`tenant.username` + UTC timestamp) and the `agent-reported` label. Map `GitHubError(403)` → `insufficient_permission`, other failures → `upstream_unavailable`. Return `{ url, number }` on success.
- [x] 1.4 Unit tests (`test/*.test.ts`): issue body carries the agent title/body + server trailer + label; 403 → `insufficient_permission`; 5xx → `upstream_unavailable`. Mock the GitHub fetch.

## 2. Skill + core trigger

- [x] 2.1 Add the `report-grocery-agent-bug` flow to `AGENT_INSTRUCTIONS.md` (core-only, no needs): compose a specific reproducible report → `report_bug` → inform the user (with URL); session dedupe (one per distinct problem); on `insufficient_permission`, tell the user it couldn't file. File-and-inform, not ask-first.
- [x] 2.2 Add the one-line conditional reference to the `<!-- persona: core -->` block: errors / repeated correction → use `report-grocery-agent-bug`.
- [x] 2.3 Rebuild the plugin (`npm run build:plugin --out plugin/grocery-agent`); the new skill + the loader stay in sync; tooling tests green.

## 3. Docs

- [x] 3.1 `docs/TOOLS.md`: document `report_bug` (params, returns, `insufficient_permission`/`upstream_unavailable`, the server-added attribution + label, data-repo target).
- [x] 3.2 `docs/SELF_HOSTING.md`: one-time **grant the GitHub App `Issues: write`** on the data repo; note reports land in the data repo's Issues, labeled `agent-reported`.

## 4. Deploy + verify

- [x] 4.1 `npm run typecheck` + `npm test` (Worker) + `npm run test:tooling` green.
- [ ] 4.2 **(operator, Casey)** ~~grant `Issues: write`~~ ✓ done 2026-06-11. REMAINING: land the Worker code on `main`, deploy from the data repo, then exercise `report_bug` once (force a tool error) and confirm an attributed, labeled issue lands in the data repo.
