#!/bin/bash
# SessionStart hook for Claude Code on the web.
#
# The repo's local toolchain is bootstrapped via mise (.devcontainer + mise.toml),
# but the web remote environment does not build the devcontainer or run its
# postCreateCommand, so node_modules is never populated. The environment setup
# script installs mise + aube globally; this hook trusts the repo's mise.toml and
# restores node_modules so the openspec CLI, the Worker, and the build tooling are
# runnable before the session begins.
set -euo pipefail

# Only needed in the remote (web) environment; local devcontainers handle setup
# via mise's postCreateCommand.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

export PATH="$HOME/.local/bin:$PATH"

cd "$CLAUDE_PROJECT_DIR"

# Trust this repo's mise.toml and install its pinned toolchain (node + aube).
mise trust
mise install

# Idempotent: `aube install` is a no-op when node_modules is already in sync, and is
# preferred over `aube ci` so the cached container state speeds up later sessions.
# `mise exec` runs it under the repo-pinned toolchain without relying on shell init.
mise exec -- aube install
