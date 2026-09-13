-- Runs once, on an empty data directory, as the superuser.
--
-- Creating extensions here rather than in a migration is deliberate: CREATE EXTENSION
-- needs superuser, and the application role must not have it. Migrations then run as
-- the application role against a database where the extensions already exist.

CREATE EXTENSION IF NOT EXISTS postgis;        -- investigator discovery, service areas
CREATE EXTENSION IF NOT EXISTS vector;         -- pgvector — RAG embeddings (ADR-0001)
CREATE EXTENSION IF NOT EXISTS pg_trgm;        -- trigram search for hybrid retrieval
CREATE EXTENSION IF NOT EXISTS citext;         -- case-insensitive email (T-004)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Fail loudly now rather than at the first query that needs one.
DO $$
DECLARE missing text;
BEGIN
  SELECT string_agg(e, ', ') INTO missing
  FROM unnest(ARRAY['postgis','vector','pg_trgm','citext']) AS e
  WHERE NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = e);

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Extensions failed to install: %', missing;
  END IF;
  RAISE NOTICE 'Extensions ready: postgis, vector, pg_trgm, citext, uuid-ossp';
END $$;
