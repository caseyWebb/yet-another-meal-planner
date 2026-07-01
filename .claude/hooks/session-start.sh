#!/bin/bash
# SessionStart hook for Claude Code on the web.
#
# The repo's local toolchain is bootstrapped via mise (.devcontainer + mise.toml),
# but the web remote environment does not build the devcontainer or run its
# postCreateCommand, so node_modules is never populated. The environment setup
# script installs mise + aube globally; this hook trusts the repo's mise.toml and
# restores node_modules so the openspec CLI, the Worker, and the build tooling are
# runnable before the session begins. It also exposes those CLIs as bare commands
# (see the wrapper-shim block below), since the agent's non-interactive shell never
# activates mise on its own.
set -euo pipefail

# Only needed in the remote (web) environment; local devcontainers handle setup
# via mise's postCreateCommand.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

export PATH="$HOME/.local/bin:$PATH"

# Apply the operator's identity to git. The environment injects CLAUDE_CODE_USER_EMAIL
# from the web environment settings; CLAUDE_CODE_USER_NAME is set the same way.
# Without this, git falls back to the Claude-default identity (noreply@anthropic.com).
if [ -n "${CLAUDE_CODE_USER_EMAIL:-}" ]; then
  git config --global user.email "$CLAUDE_CODE_USER_EMAIL"
fi
if [ -n "${CLAUDE_CODE_USER_NAME:-}" ]; then
  git config --global user.name "$CLAUDE_CODE_USER_NAME"
fi

# Sign web-session commits as the operator so each commit is BOTH authored by and
# cryptographically verified as them — satisfying the CLA bot (author identity)
# and GitHub's "Verified" badge (signature) in one shot. The web environment ships
# a remote signer (gpg.ssh.program=/tmp/code-sign) keyed to a non-operator
# identity, so operator-authored commits don't verify as the operator; when the
# operator supplies their own key we replace it with GPG signing instead.
# (SSH signing isn't viable here: ssh-keygen/openssh-client aren't installed, but
# gpg is.)
#
# Provision once: generate a passphrase-less GPG signing key whose UID email is a
# GitHub-verified email, upload its PUBLIC half to GitHub (Settings -> SSH and GPG
# keys -> New GPG key), and set the web environment secret GPG_SIGNING_KEY_B64 to
# `base64 -w0` of its ASCII-armored PRIVATE half. Leaving it unset keeps the
# environment default, so this block is a no-op until the secret exists.
if [ -n "${GPG_SIGNING_KEY_B64:-}" ]; then
  mkdir -p "$HOME/.gnupg"
  chmod 700 "$HOME/.gnupg"
  # Non-interactive signing: no controlling tty, loopback pinentry for the agent.
  grep -qxF 'no-tty' "$HOME/.gnupg/gpg.conf" 2>/dev/null || echo 'no-tty' >> "$HOME/.gnupg/gpg.conf"
  grep -qxF 'pinentry-mode loopback' "$HOME/.gnupg/gpg.conf" 2>/dev/null || echo 'pinentry-mode loopback' >> "$HOME/.gnupg/gpg.conf"
  grep -qxF 'allow-loopback-pinentry' "$HOME/.gnupg/gpg-agent.conf" 2>/dev/null || echo 'allow-loopback-pinentry' >> "$HOME/.gnupg/gpg-agent.conf"
  gpgconf --launch gpg-agent >/dev/null 2>&1 || true

  # Import the operator key and take *its* fingerprint straight from the import
  # status (IMPORT_OK <flags> <fpr>). Don't just grab the first secret key in the
  # ring: gpg lists keys by fingerprint order, not import order, so a warm/cached
  # container that already holds another signer would otherwise sign as the wrong
  # identity — the exact failure this feature exists to prevent.
  import_status="$(printf '%s' "$GPG_SIGNING_KEY_B64" | base64 -d 2>/dev/null | gpg --batch --import --status-fd=1 2>/dev/null)" || true
  signing_key="$(printf '%s\n' "$import_status" | awk '/IMPORT_OK/{print $NF; exit}')"
  if [ -n "${signing_key:-}" ]; then
    git config --global gpg.format openpgp
    git config --global gpg.program gpg
    git config --global user.signingkey "$signing_key"
    git config --global commit.gpgsign true
    git config --global tag.gpgsign true
    # Setting gpg.format=openpgp is what actually stops the env's SSH signer being
    # used; clearing gpg.ssh.program is just tidy-up (and only reaches --global).
    git config --global --unset gpg.ssh.program 2>/dev/null || true
    # Keep the author name in sync with this key's UID (unless the environment
    # already provided one) so the author line and the Verified badge agree. Scope
    # the UID lookup to the imported key, and ignore a bare-email UID (no real name).
    if [ -z "${CLAUDE_CODE_USER_NAME:-}" ]; then
      uid="$(gpg --list-secret-keys --with-colons "$signing_key" 2>/dev/null | awk -F: '/^uid:/{print $10; exit}')"
      uid_name="${uid%% <*}"
      case "$uid_name" in
        ''|*@*) : ;;   # empty or bare-email UID -> leave the existing user.name
        *) git config --global user.name "$uid_name" ;;
      esac
    fi
    echo "session-start: GPG commit signing enabled (key ${signing_key})" >&2
  else
    echo "session-start: WARNING: GPG_SIGNING_KEY_B64 is set but key import failed; keeping default signing" >&2
  fi
fi

cd "$CLAUDE_PROJECT_DIR"

# Trust this repo's mise.toml and install its pinned toolchain (node + aube).
mise trust
mise install

# Idempotent: `aube install` is a no-op when node_modules is already in sync, and is
# preferred over `aube ci` so the cached container state speeds up later sessions.
# `mise exec` runs it under the repo-pinned toolchain without relying on shell init.
mise exec -- aube install

# Expose the repo's CLIs as bare commands. mise.toml activates the toolchain (its
# tools + the `_.path` -> node_modules/.bin entries) only in an *interactive* shell,
# via `mise activate` in ~/.bashrc. Claude's Bash tool runs a non-interactive,
# non-login shell (`bash -c`) that sources neither ~/.bashrc nor ~/.profile, so mise
# never activates and `openspec`, `aubr`, `wrangler`, etc. are not on PATH — even
# though they're installed. The docs (CLAUDE.md, CONTRIBUTING.md) invoke them as bare
# commands, so generate thin wrappers in ~/.local/bin (already on PATH) that re-enter
# the repo toolchain via `mise exec`, pinned to the repo root so config discovery and
# trust resolve regardless of the caller's cwd.
mkdir -p "$HOME/.local/bin"
for cmd in aube aubr aubx openspec wrangler vitest; do
  cat > "$HOME/.local/bin/$cmd" <<EOF
#!/bin/sh
# Auto-generated by .claude/hooks/session-start.sh — re-enter the repo toolchain.
cd "$CLAUDE_PROJECT_DIR" && exec mise exec -- $cmd "\$@"
EOF
  chmod +x "$HOME/.local/bin/$cmd"
done
