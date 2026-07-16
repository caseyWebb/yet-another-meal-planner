-- 0059_recipe_imports — the visibility-lens substrate (deployment-profiles-and-visibility-lens,
-- shared-corpus capability). Four statement groups:
--
--   * recipe_imports — the canonical visibility-grant relation (D12): one provenance row
--     per (recipe, household). Visibility is COMPUTED at read time from these rows plus
--     the friendship relation (implicit all-to-all under the self-hosted profile); no
--     per-viewer visibility row is ever materialized. `tenant` is the owning household
--     OR the reserved curated system tenant (`~curated` — a code constant syntactically
--     outside the tenant-username space; see src/visibility.ts). `member` is the
--     importing member, NEVER NULL — reconciled/backfilled and curated rows stamp the
--     founding-member value (= tenant id). `via` records how the recipe first arrived
--     for that household: 'agent' | 'feed:<url>' | 'satellite' | 'curated'. A household's
--     second import of the same recipe is INSERT OR IGNORE — first provenance wins.
--
--   * discovery_matches.member — per-member match attribution (member-identity-split
--     declined domain-table member keys; the lens change adds this one). Backfilled to
--     the founding member (= tenant id), exact under the founding-member invariant:
--     every pre-existing match was made for the household's only member.
--
--   * operator_config.deployment_profile / curated_source_url — the D9 profile flag's
--     configuration channel (NULL resolves to 'self-hosted'; existing deployments need
--     no write) and the curated-source knob (NULL = the compiled product default;
--     empty string = disabled; any other value = an operator repoint).
--
--   * profile.curated_hide — the household-level curated-tier hide (D13-amendment).
--     NULL/0 = curated shown (the default); 1 = the whole curated tier leaves this
--     household's lens. Reversible; deletes nothing.
CREATE TABLE IF NOT EXISTS recipe_imports (
  recipe      TEXT NOT NULL,  -- recipe slug (joins recipes.slug)
  tenant      TEXT NOT NULL,  -- owning household; or the reserved curated tenant
  member      TEXT NOT NULL,  -- importing member; founding member (= tenant id) for
                              -- reconciled/backfilled rows and the curated tenant
  via         TEXT NOT NULL,  -- 'agent' | 'feed:<url>' | 'satellite' | 'curated'
  imported_at TEXT NOT NULL,  -- YYYY-MM-DD
  PRIMARY KEY (recipe, tenant)
);
CREATE INDEX IF NOT EXISTS idx_recipe_imports_tenant ON recipe_imports(tenant);

ALTER TABLE discovery_matches ADD COLUMN member TEXT;
UPDATE discovery_matches SET member = tenant WHERE member IS NULL;

ALTER TABLE operator_config ADD COLUMN deployment_profile TEXT
  CHECK (deployment_profile IN ('self-hosted','saas'));
ALTER TABLE operator_config ADD COLUMN curated_source_url TEXT;

ALTER TABLE profile ADD COLUMN curated_hide INTEGER;  -- NULL/0 = show curated tier
