-- 0035_reaudit — normalization decision re-audit (normalization-decision-reaudit).
-- The first ~300 identity decisions were captured under pre-hardening rules; two rolling
-- scheduled passes re-audit the AUTO backlog (alias mappings re-decided by the hardened
-- classifier, edges validated/deleted) and self-quiesce on these one-shot stamps.
-- NULL = the pre-hardening backlog (eligible); epoch ms once audited. Capture/re-confirm
-- writes are born-stamped, so post-hardening rows never enter the backlog.

ALTER TABLE ingredient_alias ADD COLUMN audited_at INTEGER;

ALTER TABLE ingredient_edge ADD COLUMN audited_at INTEGER;
