# CLAUDE.md

@AGENTS.md

## Claude Code Notes

Claude-specific plugins and the Claude web-session start hook are configured in `.claude/settings.json`. Shared subagents live in `.claude/agents/`; shared skills live in `.claude/skills/`; Codex links to those same directories from `.codex/`.

OpenSpec slash commands are available under `.claude/commands/opsx/`: `/opsx:explore`, `/opsx:propose`, `/opsx:apply`, and `/opsx:archive`.

Hosted Claude Code stop hooks may give generic git-identity advice. In this repo, PR commits must be authored by the real user for CLA Bot acceptance. Keep the user as author and include Claude as a co-author trailer when appropriate.
