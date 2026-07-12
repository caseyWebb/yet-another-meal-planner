-- A per-attempt ownership token gates child/effect writes after the session-id claim.
-- Nullable for forward compatibility with any 0054 receipt written before this additive
-- hardening; every new shop commit supplies a token.
ALTER TABLE shop_commits ADD COLUMN claim_token TEXT;
