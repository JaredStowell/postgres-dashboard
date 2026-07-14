CREATE SCHEMA IF NOT EXISTS sales;
CREATE SCHEMA IF NOT EXISTS support;
CREATE SCHEMA IF NOT EXISTS analytics;

CREATE TABLE IF NOT EXISTS sales.customers (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email text NOT NULL UNIQUE,
  region text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sales.orders (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id bigint NOT NULL REFERENCES sales.customers(id),
  status text NOT NULL,
  total_cents integer NOT NULL CHECK (total_cents >= 0),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS support.tickets (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id bigint NOT NULL REFERENCES sales.customers(id),
  state text NOT NULL,
  priority integer NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);

CREATE TABLE IF NOT EXISTS analytics.events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id bigint,
  event_name text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS orders_customer_created_idx
  ON sales.orders (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_customer_created_duplicate_idx
  ON sales.orders (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_customer_prefix_idx
  ON sales.orders (customer_id);
CREATE INDEX IF NOT EXISTS orders_status_unused_idx
  ON sales.orders (status);
CREATE INDEX IF NOT EXISTS tickets_customer_idx
  ON support.tickets (customer_id);
CREATE INDEX IF NOT EXISTS events_name_time_idx
  ON analytics.events (event_name, occurred_at DESC);

INSERT INTO sales.customers (email, region, created_at)
SELECT
  'customer-' || n || '@example.test',
  (ARRAY['na', 'eu', 'apac'])[1 + (n % 3)],
  now() - make_interval(days => n % 365)
FROM generate_series(1, 500) AS n
ON CONFLICT (email) DO NOTHING;

INSERT INTO sales.orders (customer_id, status, total_cents, notes, created_at, updated_at)
SELECT
  1 + (n % 500),
  (ARRAY['pending', 'paid', 'shipped', 'refunded'])[1 + (n % 4)],
  500 + (n * 7919 % 150000),
  CASE WHEN n % 17 = 0 THEN repeat('customer note ', 8) ELSE NULL END,
  now() - make_interval(hours => n % 8760),
  now() - make_interval(hours => n % 240)
FROM generate_series(1, 8000) AS n
WHERE NOT EXISTS (SELECT 1 FROM sales.orders);

INSERT INTO support.tickets (customer_id, state, priority, subject, body, created_at, closed_at)
SELECT
  1 + (n % 500),
  (ARRAY['open', 'waiting', 'closed'])[1 + (n % 3)],
  1 + (n % 4),
  'Ticket ' || n,
  repeat('fixture ticket body ', 4),
  now() - make_interval(hours => n % 2000),
  CASE WHEN n % 3 = 2 THEN now() - make_interval(hours => n % 1000) END
FROM generate_series(1, 2500) AS n
WHERE NOT EXISTS (SELECT 1 FROM support.tickets);

INSERT INTO analytics.events (customer_id, event_name, payload, occurred_at)
SELECT
  1 + (n % 500),
  (ARRAY['page_view', 'checkout', 'login', 'search'])[1 + (n % 4)],
  jsonb_build_object('fixture', true, 'sequence', n),
  now() - make_interval(mins => n % 50000)
FROM generate_series(1, 15000) AS n
WHERE NOT EXISTS (SELECT 1 FROM analytics.events);

ANALYZE sales.customers;
ANALYZE sales.orders;
ANALYZE support.tickets;
ANALYZE analytics.events;
SELECT pg_stat_force_next_flush();

GRANT USAGE ON SCHEMA sales, support, analytics TO analyzer_monitor;
GRANT SELECT ON ALL TABLES IN SCHEMA sales, support, analytics TO analyzer_monitor;
ALTER DEFAULT PRIVILEGES IN SCHEMA sales, support, analytics GRANT SELECT ON TABLES TO analyzer_monitor;
