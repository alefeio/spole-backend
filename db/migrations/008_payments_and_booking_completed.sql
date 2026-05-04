DO $$ BEGIN
  CREATE TYPE payment_status AS ENUM ('PENDING', 'PAID', 'FAILED', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TYPE booking_status ADD VALUE 'COMPLETED';
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS purchase_completed_at timestamptz NULL;

CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  booking_id uuid NOT NULL REFERENCES bookings (id) ON DELETE RESTRICT,
  method text NOT NULL,
  provider text NOT NULL,
  provider_reference text NOT NULL,
  gross_amount numeric(14, 2) NOT NULL,
  fee_amount numeric(14, 2) NOT NULL DEFAULT 0,
  net_amount numeric(14, 2) NOT NULL,
  status payment_status NOT NULL DEFAULT 'PENDING',
  paid_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payments_booking_unique UNIQUE (booking_id),
  CONSTRAINT payments_provider_reference_unique UNIQUE (provider_reference),
  CONSTRAINT payments_amounts_non_negative CHECK (
    gross_amount >= 0 AND fee_amount >= 0 AND net_amount >= 0
  )
);

CREATE INDEX IF NOT EXISTS payments_user_id_idx ON payments (user_id);
CREATE INDEX IF NOT EXISTS payments_booking_id_idx ON payments (booking_id);
