DO $$ BEGIN
  CREATE TYPE arena_status AS ENUM ('ACTIVE', 'INACTIVE');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE arena_space_status AS ENUM ('ACTIVE', 'INACTIVE', 'BLOCKED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE arena_slot_status AS ENUM (
    'AVAILABLE',
    'HOLD',
    'RESERVED',
    'BLOCKED',
    'EXPIRED',
    'CANCELLED'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS arenas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  name text NOT NULL,
  slug citext NOT NULL UNIQUE,
  description text NULL,
  phone text NOT NULL,
  email citext NOT NULL,
  document text NOT NULL,
  status arena_status NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arena_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  arena_id uuid NOT NULL UNIQUE REFERENCES arenas (id) ON DELETE CASCADE,
  zip_code text NOT NULL,
  street text NOT NULL,
  number text NOT NULL,
  district text NOT NULL,
  city text NOT NULL,
  state text NOT NULL,
  latitude numeric(10, 7) NULL,
  longitude numeric(10, 7) NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arena_policies (
  arena_id uuid PRIMARY KEY REFERENCES arenas (id) ON DELETE CASCADE,
  allow_recurring boolean NOT NULL,
  min_advance_hours integer NOT NULL CHECK (min_advance_hours >= 0),
  min_reservation_payment_percent integer NOT NULL CHECK (
    min_reservation_payment_percent >= 0
    AND min_reservation_payment_percent <= 100
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arena_spaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  arena_id uuid NOT NULL REFERENCES arenas (id) ON DELETE CASCADE,
  name text NOT NULL,
  type text NOT NULL,
  description text NULL,
  capacity_suggestion integer NULL CHECK (capacity_suggestion IS NULL OR capacity_suggestion > 0),
  status arena_space_status NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arena_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES arena_spaces (id) ON DELETE CASCADE,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  price numeric(12, 2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  status arena_slot_status NOT NULL DEFAULT 'AVAILABLE',
  allows_recurring boolean NOT NULL DEFAULT false,
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT arena_slots_time_order CHECK (end_at > start_at)
);

CREATE INDEX IF NOT EXISTS arenas_owner_id_idx ON arenas (owner_id);
CREATE INDEX IF NOT EXISTS arena_spaces_arena_id_idx ON arena_spaces (arena_id);
CREATE INDEX IF NOT EXISTS arena_slots_space_id_idx ON arena_slots (space_id);
CREATE INDEX IF NOT EXISTS arena_slots_space_time_idx ON arena_slots (space_id, start_at, end_at);
