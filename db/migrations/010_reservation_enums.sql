DO $$ BEGIN
  ALTER TYPE reservation_status ADD VALUE IF NOT EXISTS 'PENDING';
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TYPE reservation_type ADD VALUE IF NOT EXISTS 'RECURRING';
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE recurrence_frequency AS ENUM ('WEEKLY');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE reservation_occurrence_status AS ENUM (
    'PENDING_PAYMENT',
    'CONFIRMED',
    'RELEASED',
    'CANCELLED'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
