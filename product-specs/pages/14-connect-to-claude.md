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
  `/authorize`, `/connect` approval, Kroger OAuth). Zero backend — steps are templated
  from deployment config (operator repo, name), never hardcoded; `config/whoami` gains
  `{ profile, operator }` for modal copy + D9 gating.
- Rides band 7a with `account-security-basics` (D25).
- The web tab has no Kroger step (agent-initiated via `kroger_login_url` in chat) —
  confirm intentional, or add an optional step for parity.
- The `?tenant=` slug in the connect URL is retained — it is the member's own id,
  already present in existing copyable URLs.
- Story 01 note (D10): invite codes mint/resolve (tenant, member) pairs; the footer's
  "codes are minted per member" already matches.

## 3. Delta

New UI; tweak-level effort. Sequence anywhere.
