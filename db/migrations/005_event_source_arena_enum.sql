-- Novo valor de enum deve ser commitado antes de ser referenciado (ex.: CHECK em outra migração).
DO $$ BEGIN
  ALTER TYPE event_source_type ADD VALUE 'ARENA_RESERVATION';
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
