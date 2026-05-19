DO $$ BEGIN
  CREATE TYPE idempotency_record_status AS ENUM ('PROCESSING', 'COMPLETED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  method text NOT NULL,
  route text NOT NULL,
  request_hash text NOT NULL,
  status idempotency_record_status NOT NULL DEFAULT 'PROCESSING',
  response_status integer NULL,
  response_body jsonb NULL,
  resource_type text NULL,
  resource_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,
  expires_at timestamptz NOT NULL,
  CONSTRAINT idempotency_keys_key_not_empty CHECK (char_length(trim(idempotency_key)) > 0),
  CONSTRAINT idempotency_keys_method_not_empty CHECK (char_length(trim(method)) > 0),
  CONSTRAINT idempotency_keys_route_not_empty CHECK (char_length(trim(route)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idempotency_keys_user_scope_unique_idx
  ON idempotency_keys (user_id, method, route, idempotency_key);

CREATE INDEX IF NOT EXISTS idempotency_keys_expires_at_idx ON idempotency_keys (expires_at);
