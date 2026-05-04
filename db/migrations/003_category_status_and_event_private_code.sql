DO $$ BEGIN
  CREATE TYPE category_status AS ENUM ('ACTIVE', 'INACTIVE');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE event_categories
  ADD COLUMN IF NOT EXISTS status category_status NOT NULL DEFAULT 'ACTIVE';

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS private_code text NULL;

UPDATE events SET private_code = NULL WHERE visibility = 'PUBLIC';

UPDATE events
SET private_code = translate(encode(gen_random_bytes(18), 'base64'), '+/', 'xx')
WHERE visibility = 'PRIVATE'
  AND (private_code IS NULL OR btrim(private_code) = '');

ALTER TABLE events
  DROP CONSTRAINT IF EXISTS events_visibility_private_code;

ALTER TABLE events
  ADD CONSTRAINT events_visibility_private_code CHECK (
    visibility::text = 'PUBLIC'
    OR (
      visibility::text = 'PRIVATE'
      AND private_code IS NOT NULL
      AND length(btrim(private_code)) >= 8
    )
  );
