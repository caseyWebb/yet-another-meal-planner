-- 0060_households_social — the social-graph substrate (households-friends-and-people-page,
-- social-graph capability). Five new tables, no ALTERs of existing ones:
--
--   * friendships — the symmetric, accepted-only tenant↔tenant edge, stored ONCE as a
--     canonically ordered pair (tenant_a < tenant_b, CHECK-enforced) so duplicates and
--     self-edges are unrepresentable. Accepted-only BY CONSTRUCTION: pending state lives
--     in social_requests, never here — a row here IS an accepted friendship, exactly the
--     lens seam provider's contract (src/visibility.ts friendHouseholds).
--
--   * social_requests — append-then-resolve request rows for both tiers. The requester's
--     view derives from state: 'pending', 'declined', and 'swallowed' all render "Request
--     sent" (D24's invisible decline). 'swallowed' rows exist so the outgoing cap counts
--     them and the requester's view stays plausible; they never reach an inbox and their
--     note/display_name are never delivered.
--
--   * member_invites — member-minted invite links, the THIRD invite kind beside KV
--     bootstrap invites (resolve an existing member) and D1 group codes (create a
--     standalone tenant): a link creates a RELATIONSHIP, and an account when needed.
--     Single-use, 14-day expiry; revocation is oracle-free (unknown / expired / revoked /
--     redeemed collapse to one uniform invalid_or_expired surface).
--
--   * nicknames — per-viewer, others-only aliases (viewer member → target member), never
--     shown to the named person. `tenant` is the VIEWER's household (isolation/purge).
--
--   * blocks — directional, tier-scoped suppression records, minted by one member but
--     evaluated household-wide (one member's block binds the household). Household-tier
--     blocks record blocked_member and match by member id (the protection follows the
--     person across member-moves); friend-tier blocks match by tenant.
CREATE TABLE IF NOT EXISTS friendships (
  tenant_a   TEXT NOT NULL,      -- lexicographically LOWER tenant id
  tenant_b   TEXT NOT NULL,      -- lexicographically HIGHER tenant id
  requested_by TEXT NOT NULL,    -- member id that sent the originating request
  created_at INTEGER NOT NULL,   -- epoch ms
  PRIMARY KEY (tenant_a, tenant_b),
  CHECK (tenant_a < tenant_b)
);
CREATE INDEX IF NOT EXISTS idx_friendships_b ON friendships(tenant_b);

CREATE TABLE IF NOT EXISTS social_requests (
  id          TEXT PRIMARY KEY,  -- ULID
  tier        TEXT NOT NULL,     -- 'household' | 'friend'
  from_tenant TEXT NOT NULL,
  from_member TEXT NOT NULL,
  to_tenant   TEXT NOT NULL,     -- friend tier: the target household
  to_member   TEXT NOT NULL,     -- the looked-up member; household tier: the invitee
  note        TEXT,              -- inert plain text, <= 200 chars
  display_name TEXT,             -- sender-supplied self-introduction (nickname seed)
  state       TEXT NOT NULL,     -- 'pending' | 'accepted' | 'declined' | 'cancelled' | 'swallowed'
  created_at  INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_social_requests_to ON social_requests(to_tenant, state);
CREATE INDEX IF NOT EXISTS idx_social_requests_from ON social_requests(from_tenant, state);

CREATE TABLE IF NOT EXISTS member_invites (
  token          TEXT PRIMARY KEY,  -- >= 128-bit random, URL-safe
  tenant         TEXT NOT NULL,     -- inviter household
  inviter_member TEXT NOT NULL,
  tier           TEXT NOT NULL,     -- 'household' | 'friend'
  created_at     INTEGER NOT NULL,
  expires_at     INTEGER NOT NULL,  -- default mint: created_at + 14 days
  revoked_at     INTEGER,
  redeemed_at    INTEGER,
  redeemed_by    TEXT               -- resulting member id (household) or tenant id (friend)
);
CREATE INDEX IF NOT EXISTS idx_member_invites_tenant ON member_invites(tenant);

CREATE TABLE IF NOT EXISTS nicknames (
  tenant        TEXT NOT NULL,      -- viewer's household (isolation/purge column)
  viewer_member TEXT NOT NULL,
  target_member TEXT NOT NULL,
  nickname      TEXT NOT NULL,      -- <= 40 chars plain text
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (viewer_member, target_member)
);
CREATE INDEX IF NOT EXISTS idx_nicknames_tenant ON nicknames(tenant);

CREATE TABLE IF NOT EXISTS blocks (
  tenant          TEXT NOT NULL,    -- blocking household
  blocking_member TEXT NOT NULL,
  tier            TEXT NOT NULL,    -- the tier this record suppresses
  blocked_tenant  TEXT NOT NULL,    -- counterparty household at mint time
  blocked_member  TEXT,             -- set for household-tier blocks (follows the person)
  created_at      INTEGER NOT NULL,
  PRIMARY KEY (tenant, tier, blocked_tenant)
);
