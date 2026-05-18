ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS total_price numeric(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS required_payment_amount numeric(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paid_amount numeric(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz NULL;

ALTER TABLE payments
  ALTER COLUMN booking_id DROP NOT NULL;

CREATE TABLE IF NOT EXISTS reservation_recurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL UNIQUE REFERENCES reservations (id) ON DELETE CASCADE,
  frequency recurrence_frequency NOT NULL DEFAULT 'WEEKLY',
  day_of_week smallint NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reservation_occurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recurrence_id uuid NOT NULL REFERENCES reservation_recurrences (id) ON DELETE CASCADE,
  slot_id uuid NOT NULL REFERENCES arena_slots (id) ON DELETE RESTRICT,
  status reservation_occurrence_status NOT NULL DEFAULT 'PENDING_PAYMENT',
  due_at timestamptz NOT NULL,
  paid_at timestamptz NULL,
  released_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS reservation_id uuid NULL REFERENCES reservations (id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS reservation_occurrence_id uuid NULL REFERENCES reservation_occurrences (id) ON DELETE RESTRICT;

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_booking_unique;

CREATE UNIQUE INDEX IF NOT EXISTS payments_booking_id_unique_idx
  ON payments (booking_id)
  WHERE booking_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS payments_reservation_id_unique_idx
  ON payments (reservation_id)
  WHERE reservation_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS payments_reservation_occurrence_id_unique_idx
  ON payments (reservation_occurrence_id)
  WHERE reservation_occurrence_id IS NOT NULL;

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_exactly_one_context;

ALTER TABLE payments
  ADD CONSTRAINT payments_exactly_one_context CHECK (
    (
      (booking_id IS NOT NULL)::int
      + (reservation_id IS NOT NULL)::int
      + (reservation_occurrence_id IS NOT NULL)::int
    ) = 1
  );

CREATE INDEX IF NOT EXISTS reservation_occurrences_recurrence_id_idx ON reservation_occurrences (recurrence_id);
CREATE INDEX IF NOT EXISTS reservation_occurrences_slot_id_idx ON reservation_occurrences (slot_id);
CREATE INDEX IF NOT EXISTS reservation_occurrences_due_at_idx ON reservation_occurrences (due_at)
  WHERE status = 'PENDING_PAYMENT';

CREATE INDEX IF NOT EXISTS reservations_pending_expires_idx ON reservations (expires_at)
  WHERE status = 'PENDING';
