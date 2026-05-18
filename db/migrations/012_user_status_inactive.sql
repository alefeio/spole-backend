DO $$ BEGIN
  ALTER TYPE user_status ADD VALUE IF NOT EXISTS 'INACTIVE';
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
