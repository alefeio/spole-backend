DO $$ BEGIN
  CREATE TYPE event_type AS ENUM ('FREE', 'PAID');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE event_visibility AS ENUM ('PUBLIC', 'PRIVATE');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE event_source_type AS ENUM ('FREE_LOCATION');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE event_status AS ENUM ('DRAFT', 'PUBLISHED', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS event_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug citext NOT NULL UNIQUE,
  icon text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  category_id uuid NOT NULL REFERENCES event_categories (id) ON DELETE RESTRICT,
  title text NOT NULL,
  description text NULL,
  type event_type NOT NULL,
  visibility event_visibility NOT NULL,
  source_type event_source_type NOT NULL DEFAULT 'FREE_LOCATION',
  status event_status NOT NULL,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  address_name text NOT NULL,
  street text NOT NULL,
  number text NOT NULL,
  district text NOT NULL,
  city text NOT NULL,
  state text NOT NULL,
  capacity integer NOT NULL,
  price_per_person numeric(12, 2) NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT events_capacity_positive CHECK (capacity > 0),
  CONSTRAINT events_dates_ordered CHECK (end_at > start_at),
  CONSTRAINT events_price_rules CHECK (
    (type = 'FREE' AND (price_per_person IS NULL OR price_per_person = 0))
    OR (type = 'PAID' AND price_per_person IS NOT NULL AND price_per_person > 0)
  )
);

CREATE INDEX IF NOT EXISTS events_organizer_id_idx ON events (organizer_id);
CREATE INDEX IF NOT EXISTS events_category_id_idx ON events (category_id);
CREATE INDEX IF NOT EXISTS events_list_public_idx ON events (visibility, status, start_at);
CREATE INDEX IF NOT EXISTS events_city_idx ON events (city);
