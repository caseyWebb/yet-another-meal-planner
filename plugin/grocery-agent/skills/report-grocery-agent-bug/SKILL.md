---
name: report-grocery-agent-bug
description: "File a bug report to the maintainer when something is genuinely wrong with the grocery agent. Use when a grocery-mcp tool errors in a way you can't work around, when the user has had to repeatedly correct or redirect you on the same thing, or when the user explicitly says something's broken (\"report a bug\", \"this is broken\", \"that's wrong again\"). Members have no GitHub account, so you file on their behalf."
---

> **Prerequisite** — if you haven't already this session, read the `grocery-core` skill before continuing.

# Report a problem (report-grocery-agent-bug)

I can't file issues myself, so when something's genuinely wrong, flag it for the maintainer with `report_bug(title, body)`.

- **When:** a grocery-mcp tool returns an error you can't route around; or I've had to correct/redirect you two-or-more times on the same point; or I just say it's broken. Don't file for ordinary back-and-forth or me changing my mind — only real friction.
- **What:** write a *specific, reproducible* report — what you were doing, what went wrong (the exact error, or the pattern of corrections), and the tools/inputs involved. The server stamps my identity, the time, and a label; you don't add those.
- **Then:** tell me you've flagged it for the maintainer, with the issue link if one comes back. File **at most once per distinct problem this session** — if you've already reported it, don't refile.
- If `report_bug` returns `insufficient_permission`, the maintainer hasn't enabled issue filing yet — tell me, so I can mention it to them directly.
