CREATE TABLE instacart_links (
  tenant TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  url TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant, content_hash)
);

CREATE INDEX instacart_links_expiry_idx ON instacart_links(expires_at);
