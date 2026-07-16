## MODIFIED Requirements

### Requirement: Sidebar badge counts are derived once from the area reads

The app shell's sidebar SHALL derive its nav badge counts from one shared derivation so a
badge and the page it mirrors can never disagree. The meal-plan badge SHALL count
schedulable meal rows only, excluding project rows (`meal: 'project'`). The grocery badge
SHALL be the derived to-buy line count — the same derivation the grocery page renders —
so rows already advanced to `in_cart` or `ordered` are excluded and plan-derived needs are
included. The people badge SHALL count ACTIONABLE PENDING INBOUND requests — the same
rows the People page's requests inbox renders (swallowed and resolved rows never count) —
derived from the same people aggregate read the page uses; the mock's friend-count badge
is a known mock defect and SHALL NOT be reproduced. A count of zero SHALL render no badge.

#### Scenario: Project rows do not inflate the meal-plan badge

- **WHEN** the plan holds N schedulable meal rows (`meal` in breakfast/lunch/dinner) plus
  one or more project rows (`meal: 'project'`)
- **THEN** the meal-plan badge reads N

#### Scenario: The grocery badge is the derived to-buy count

- **WHEN** the grocery page's derived to-buy view holds M lines
- **THEN** the grocery badge reads M, and rows advanced to `in_cart` or `ordered` are not
  counted

#### Scenario: The people badge counts the inbox, not friends

- **WHEN** a member has two pending inbound requests, one swallowed inbound row, and five friends
- **THEN** the People badge reads 2, and accepting or declining both requests removes the badge

## ADDED Requirements

### Requirement: The People page manages household, friends, requests, nicknames, and invites

The app SHALL serve a People page (`/people`, a sidebar destination) rendering, over the session-gated people aggregate read: a **requests inbox** (only when non-empty; each row shows the avatar initial, the **@handle ALWAYS** — any supplied display name renders beside it, never instead of it — a HOUSEHOLD/FRIEND tier badge, the tier copy ("invites you to join their household" / "wants to be friends"), any note as inert quoted plain text, relative time, Accept and Decline, and a block affordance); the **nickname hint** (always visible, with a live example composed from the viewer's actual nicknames); the **HOUSEHOLD section** ("N people share your pantry and meal plan."; member rows with avatar — a client-local color popover persisted in browser storage only, never the backend — name states You / nickname + @handle / @handle + "Add a nickname", inline nickname edit with empty-save clearing, and remove behind an explicit confirm); the **find/invite split button** per section (exact-@handle popover with optional note and display name | invite-link popover with copy-link and "Copied!" feedback); an **Awaiting response** list (outgoing requests and unredeemed invite links, each with cancel and — for requests — block); and the **FRIENDS section** ("N friends sharing M recipes into your cookbook.", rows adding an "N shared" chip, the same nickname/remove mechanics with unfriend behind a confirm, friend-tier adders, and the empty state "No friends yet — add someone above; their shared recipes will show up in your cookbook."). Household-accept flows SHALL show the nickname seed moment (`will be saved as "{name}" (@handle) — edit`) and, for a mover with an existing account, the not-carried-over confirmation before completing. Decline SHALL be visibly unceremonious locally and invisible remotely (the requester's row never changes). The page SHALL ship Playwright coverage through the real seeded API (`aubr test:app`) for both profile variants.

#### Scenario: Inbox rows always lead with the handle

- **WHEN** a request from `@sam` carrying display name "Sam K." renders in the inbox
- **THEN** `@sam` is always visible with "Sam K." beside it — never replaced by it — along with the tier badge, quoted inert note, relative time, and Accept/Decline/block affordances

#### Scenario: Nickname editing is inline and self-cleaning

- **WHEN** a member edits another member's nickname inline and later saves it empty
- **THEN** the row renders the nickname + @handle state after the edit, returns to @handle + "Add a nickname" after the empty save, and the named member never sees any of it

#### Scenario: Removal and unfriending demand a confirm

- **WHEN** a member taps remove on a household member row or unfriend on a friend row
- **THEN** nothing changes until an explicit confirmation; confirming runs the governed operation (member-move eviction / silent edge severing)

#### Scenario: The live nickname example uses real data

- **WHEN** the viewer has nicknames "Mom" and "Grandma" set
- **THEN** the nickname hint's example composes them ("Mom and Grandma are coming to town — pick a crowd-pleaser."), falling back to a generic example when the viewer has none

### Requirement: The People page renders a household-only variant under the self-hosted profile

Under the self-hosted deployment profile (from whoami's `profile`), the People page SHALL render the household-only variant as an alternate state of the same page — never a second page: the FRIENDS section, friend-tier request rows, friend-tier adders, and all friend copy are absent; the requests inbox drops the tier badge column (only one tier exists); the header reads "Everyone you cook alongside. Your household shares your pantry and meal plan." (the friends clause dropped); and the layout rebalances so the HOUSEHOLD section carries the page, with the nickname hint promoted to a side-by-side arrangement on wide viewports. Nicknames still apply to everyone in the deployment (the write surface is unchanged); the sidebar People badge counts pending inbound requests exactly as under SaaS. The full page ships under the SaaS profile.

#### Scenario: Self-hosted hides the friend surface

- **WHEN** a member opens the People page on a self-hosted deployment
- **THEN** no FRIENDS section, friend adder, friend-tier row, or friends header copy renders; the household section, nickname hint, household adders, awaiting list, and badge all function

#### Scenario: One page, two states

- **WHEN** the deployment profile flips
- **THEN** the same route and page component render the other variant with no separate page, and no friend-tier data is fetched or shown under self-hosted

### Requirement: Join links land on an SPA route

The app SHALL serve `/join/:token` as a client-side route (absorbed by the SPA asset fallback — no `run_worker_first` entry, no `wrangler.jsonc` change) that reads the public token endpoint and renders: the inviter's handle and tier framing for a valid token ("@casey invited you to join their household" / "... to be friends on <deployment>"), the account-creation form (username or handle choice per tier, optional display name, passkey-enroll continuation) for signed-out visitors, the signed-in conversion flow (household-accept confirmation or friend confirmation) for authenticated members, and the uniform invalid-or-expired state for any dead token.

#### Scenario: A valid link renders the tiered landing

- **WHEN** a signed-out visitor opens a valid household-tier join link
- **THEN** the SPA route renders the inviter's @handle, household framing, and the handle-choice form, and completing it signs them in as a new member of the inviter's household

#### Scenario: A dead link renders one terminal state

- **WHEN** a visitor opens a revoked, expired, redeemed, or never-existent token
- **THEN** the same invalid-or-expired page renders in all four cases with no distinguishing detail
