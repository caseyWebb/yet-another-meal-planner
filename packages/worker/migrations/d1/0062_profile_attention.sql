-- 0062_profile_attention — the read_user_profile attention block's one new column
-- (narrow-mcp-surface / data-read-tools D8): a per-tenant watermark for the last time
-- the caller read a retrospective, stamped by the `retrospective` tool and the member
-- `GET /profile/retrospective` endpoint (both ride `loadRetrospective`) — the
-- `last_planned_at` precedent. NULL means the retrospective has never been read, which
-- (together with a non-empty cooking log) makes `attention.retrospective_due` true.
ALTER TABLE profile ADD COLUMN last_retrospective_at TEXT;
