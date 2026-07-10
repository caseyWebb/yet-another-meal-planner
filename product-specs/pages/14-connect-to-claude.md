# Page 14 — Connect-to-Claude modal

Screen: `screens/connect-modal.png`.

## 1. Functional requirements

Sidebar CTA "Connect to Claude.ai" opens a guided modal: "Run yamp as a chat agent
inside Claude. Pick your client below and follow the steps — no GitHub or Kroger account
needed on your end." Two tabs, steps templated with the operator's repo/name:

**Claude.ai tab** (default): 1. Add the marketplace (Customize → Plugins → Add
Marketplace → From a Repository; copyable repo slug). 2. Turn on auto-sync ("so you get
updates {operator} ships"). 3. Install the yamp plugin. 4. Open Connectors. 5. Connect
yamp ("enter the invite code your operator sent you if prompted").

**Claude Code tab**: 1. `/plugin marketplace add {repo}`. 2. `/plugin install yamp@yamp`.
3. `/authorize` + invite code. 4. Optional Kroger cart: `/oauth/init?tenant={tenant}`.
All steps copyable with per-step "Copied" feedback.

Footer: "Don't have an invite code? Ask your operator — codes are minted per member and
shown once in the admin panel." + "Open Claude.ai" (claude.ai/new, new tab).

## 2. Notes

- Pure guided UI over the existing distribution/connect flow (marketplace publish,
  `/authorize`, `/connect` approval, Kroger OAuth). No new backend.
- The web tab has no Kroger step (agent-initiated via `kroger_login_url` in chat) —
  confirm intentional, or add an optional step for parity.
- `?tenant={tenant}` in a copyable URL leaks the tenant slug — acceptable? Consider a
  short-lived opaque ref.
- Steps must be generated from deployment config (operator repo, name), not hardcoded.
- Story 01 note: invite codes are per-member in the multi-member model; the footer copy
  already matches.

## 3. Delta

New UI; tweak-level effort. Sequence anywhere.
