-- 0009_discovery_rejections — group-wide suppression of discovery URLs
-- (semantic-meal-plan, the disposition collapse). The aggressive in-session import
-- flow has three dispositions: import (a recipe lands in the corpus), no-action (a
-- candidate is simply left in the pool), and REJECT — "the group shouldn't see this
-- again" (junk, broken, not a recipe, a duplicate, clearly off-base). Reject is
-- deliberately SHARED, asymmetric with the per-tenant `favorite`: rejection is
-- collective curation (one noisy discovery stream curated once), favoriting is
-- personal taste. So this table has no tenant column — a rejected URL is suppressed
-- for everyone; `rejected_by` is provenance only, not a scope.
--
-- Both discovery read paths consult it: fetch_rss_discoveries unions these URLs into
-- its corpus-dedup `seen` set, and read_discovery_inbox drops candidates whose URL is
-- here. Keyed by the CANONICAL url (query/fragment/trailing-slash stripped, the same
-- canonicalizeUrl the feed dedup uses) so a tracker-wrapped and a bare link suppress
-- as one.
CREATE TABLE IF NOT EXISTS discovery_rejections (
  url         TEXT PRIMARY KEY,   -- canonical URL (canonicalizeUrl)
  reason      TEXT,               -- optional free-text ("not a recipe", "duplicate")
  rejected_by TEXT,               -- the tenant who rejected (provenance; suppression is group-wide)
  rejected_at TEXT                -- YYYY-MM-DD
);
