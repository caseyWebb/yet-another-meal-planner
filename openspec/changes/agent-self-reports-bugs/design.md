## Context

The Worker (`buildServer(env, tenant)`) registers MCP tools per request. It already mints short-lived GitHub App installation tokens (`src/github-app.ts`) and wraps them in a REST client (`src/github.ts` → `createGitHubClient(coords, auth)`) that hits `api.github.com/repos/{owner}/{repo}/…`. `dataGh = createGitHubClient(tenant.dataRepo, installationAuth)` is the repo-level (un-prefixed) client; `tenant.username` identifies the caller. So filing an issue is one new client method + one tool — no new auth, no new dependency.

Decided with Casey (2026-06-11): reports go to the **private data repo**; **file-and-inform** (don't ask first); scoped as its own change.

## Goals / Non-Goals

**Goals:**
- Capture real friction (tool errors, repeated correction) from members who can't/won't file issues.
- Attributed, actionable reports in the operator's private control plane.
- Graceful degradation when the App can't file (no `Issues: write` yet).

**Non-Goals:**
- A public issue tracker for members (privacy — stays in the private data repo).
- Telemetry / analytics / always-on logging — this is event-driven, only on errors or evident repeated correction.
- Letting the agent file unbounded issues (session dedupe caps it).

## Decisions

### D1 — `createIssue` on the existing GitHub client
Add `createIssue(title, body, labels?): Promise<{ url: string; number: number }>` to `GitHubClient`, implemented as `POST /repos/{owner}/{repo}/issues` through the same retry/token path as the other methods. A non-transient `403` (App lacks `Issues: write`) surfaces as `GitHubError(403)`; the tool maps it to `insufficient_permission`. Use the **un-prefixed `dataGh`** — issues are repo-level, not under a tenant subtree.

### D2 — `report_bug` tool, server-attributed
`report_bug(title: string, body: string)` registered in `buildServer`. The Worker, not the agent, appends a trailer to the body: `username`, a UTC timestamp, and a marker; and applies the `agent-reported` label. So attribution can't be spoofed or forgotten by the agent, and the operator can filter. Returns `{ url, number }` on success; structured `insufficient_permission` / `upstream_unavailable` on failure (the agent relays the failure to the user rather than pretending it filed).

### D3 — Skill behavior: file-and-inform, session-deduped
The `report-grocery-agent-bug` skill (core-only — no cart/corpus depth) fires when: a grocery-mcp tool returns an error the agent can't work around, OR the user has repeatedly corrected/redirected on the same point, OR the user explicitly asks ("report a bug", "this is broken"). It writes a concise, specific issue (what the agent was attempting, the failure or correction pattern, the tools/inputs involved — enough for the operator to reproduce), calls `report_bug`, and **tells the user it flagged the issue** (with the URL if returned). It files **at most one issue per distinct problem per session** — if it already filed for this, it doesn't refile. On `insufficient_permission`, it tells the user it couldn't file and suggests mentioning it to the operator directly.

### D4 — `grocery-core` trigger (one line)
Core gains a single conditional reference (it's cross-cutting — any skill can hit an error): *"If the grocery-mcp server errors, or you find yourself repeatedly corrected or redirected on the same thing, use the `report-grocery-agent-bug` skill — members can't file issues themselves."* This is the agreed cost of one line back in the lean core; it earns its place because the failure can occur in any flow.

## Risks / Trade-offs

- **Permission prerequisite.** `Issues: write` must be granted to the App (operator action). Until then the feature no-ops gracefully (`insufficient_permission`). Documented in SELF_HOSTING.
- **Noise / over-reporting.** An over-eager agent could file thin issues. Mitigated by session dedupe + a skill that demands a *specific, reproducible* report, and the `agent-reported` label so the operator can batch-triage. Acceptable for a small friend group; revisit (rate-limit, or a daily digest) if volume becomes a problem.
- **Privacy.** Report bodies carry conversation context + username. Mitigated by sending only to the **private** data repo and informing the user it was filed. Not sent anywhere public.
- **Spoofing.** Attribution (username/timestamp/label) is added server-side, not trusted from the agent's arguments.
