DO $$ BEGIN
  CREATE TYPE reservation_status AS ENUM ('CONFIRMED', 'CANCELLED', 'CONSUMED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE reservation_type AS ENUM ('SINGLE');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id uuid NOT NULL REFERENCES arena_slots (id) ON DELETE RESTRICT,
  organizer_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  type reservation_type NOT NULL DEFAULT 'SINGLE',
  status reservation_status NOT NULL DEFAULT 'CONFIRMED',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS reservations_one_confirmed_per_slot_idx
  ON reservations (slot_id)
  WHERE (status = 'CONFIRMED');

CREATE INDEX IF NOT EXISTS reservations_organizer_id_idx ON reservations (organizer_id);
CREATE INDEX IF NOT EXISTS reservations_slot_id_idx ON reservations (slot_id);

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS reservation_id uuid NULL REFERENCES reservations (id);

ALTER TABLE events DROP CONSTRAINT IF EXISTS events_source_reservation_chk;

ALTER TABLE events
  ADD CONSTRAINT events_source_reservation_chk CHECK (
    (source_type = 'FREE_LOCATION' AND reservation_id IS NULL)
    OR (source_type = 'ARENA_RESERVATION' AND reservation_id IS NOT NULL)
  );
