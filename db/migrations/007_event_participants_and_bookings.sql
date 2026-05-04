DO $$ BEGIN
  CREATE TYPE event_participant_status AS ENUM ('CONFIRMED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE booking_status AS ENUM ('RESERVED', 'EXPIRED', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS event_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  status event_participant_status NOT NULL DEFAULT 'CONFIRMED',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_participants_one_per_user_event UNIQUE (event_id, user_id)
);

CREATE TABLE IF NOT EXISTS bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  status booking_status NOT NULL DEFAULT 'RESERVED',
  reserved_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  redis_key text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bookings_expires_after_reserved CHECK (expires_at > reserved_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS bookings_one_active_reserved_per_user_event_idx
  ON bookings (event_id, user_id)
  WHERE (status = 'RESERVED');

CREATE INDEX IF NOT EXISTS bookings_event_id_idx ON bookings (event_id);
CREATE INDEX IF NOT EXISTS bookings_user_id_idx ON bookings (user_id);
CREATE INDEX IF NOT EXISTS bookings_expires_at_idx ON bookings (expires_at) WHERE (status = 'RESERVED');

CREATE INDEX IF NOT EXISTS event_participants_event_id_idx ON event_participants (event_id);
CREATE INDEX IF NOT EXISTS event_participants_user_id_idx ON event_participants (user_id);
