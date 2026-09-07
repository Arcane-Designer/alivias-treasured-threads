CREATE TABLE IF NOT EXISTS customer_email_outbox (
  order_ref TEXT PRIMARY KEY REFERENCES orders(order_ref),
  state TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  first_attempt_at INTEGER,
  lease_token TEXT,
  payload_json TEXT,
  provider_id TEXT,
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS customer_email_due ON customer_email_outbox(state, next_attempt_at);
