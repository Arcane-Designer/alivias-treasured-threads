CREATE TABLE IF NOT EXISTS orders (
  order_ref TEXT PRIMARY KEY,
  checkout_attempt_id TEXT NOT NULL UNIQUE,
  stripe_session_id TEXT UNIQUE,
  checkout_url TEXT,
  status TEXT NOT NULL,
  currency TEXT NOT NULL,
  subtotal_cents INTEGER NOT NULL,
  shipping_cents INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  total_cents INTEGER,
  customer_email TEXT,
  customer_name TEXT,
  shipping_json TEXT,
  created_at INTEGER NOT NULL,
  paid_at INTEGER,
  stripe_event_id TEXT
);
CREATE TABLE IF NOT EXISTS order_items (
  order_ref TEXT NOT NULL,
  inventory_key TEXT NOT NULL,
  product_id TEXT NOT NULL,
  listing_id TEXT,
  display_name TEXT NOT NULL,
  unit_amount_cents INTEGER NOT NULL,
  PRIMARY KEY (order_ref, inventory_key),
  FOREIGN KEY (order_ref) REFERENCES orders(order_ref)
);
CREATE TABLE IF NOT EXISTS inventory_reservations (
  inventory_key TEXT PRIMARY KEY,
  order_ref TEXT NOT NULL,
  status TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (order_ref) REFERENCES orders(order_ref)
);
CREATE TABLE IF NOT EXISTS stripe_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  processed_at INTEGER NOT NULL
);
