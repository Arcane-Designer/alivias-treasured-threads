CREATE TABLE IF NOT EXISTS manual_orders (
  id TEXT PRIMARY KEY,
  customer_name TEXT,
  customer_email TEXT NOT NULL,
  items_text TEXT,
  shipping_text TEXT,
  notes TEXT,
  sale_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS thank_you_outbox (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  customer_name TEXT,
  items_text TEXT,
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  first_attempt_at INTEGER,
  lease_token TEXT,
  payload_json TEXT,
  last_error TEXT,
  provider_id TEXT,
  created_at INTEGER NOT NULL,
  accepted_at INTEGER
);

CREATE INDEX IF NOT EXISTS thank_you_source_idx
  ON thank_you_outbox (source_type, source_id, created_at DESC);

CREATE INDEX IF NOT EXISTS thank_you_delivery_idx
  ON thank_you_outbox (state, next_attempt_at);

CREATE TABLE IF NOT EXISTS studio_preferences (
  preference_key TEXT PRIMARY KEY,
  preference_value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
