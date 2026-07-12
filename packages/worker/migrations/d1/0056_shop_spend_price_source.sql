-- Receipt-backed manual/walk spend retains the estimate ladder source for audit.
-- Order-send assertions leave this nullable column unset.
ALTER TABLE spend_events ADD COLUMN price_source TEXT;
