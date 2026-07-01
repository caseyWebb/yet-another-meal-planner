-- 0027_discovery_log_pushed — provenance for pushed candidates (recipe-ingestion +
-- discovery-sweep). A candidate that arrived via POST /admin/api/ingest carries
-- `pushed = 1` and its `origin` (the batch source) on its discovery_log row, so the
-- admin Discovery view can badge it and render its `acquire` stage as arrived-via-push.
ALTER TABLE discovery_log ADD COLUMN pushed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE discovery_log ADD COLUMN origin TEXT;
