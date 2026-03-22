-- App Stats relay table
-- Stores the latest stats snapshot pushed by Motus and Iron Passport.
-- One row per app (upsert on "app" column).
-- The "stats" column holds the full JSON payload as JSONB so each app
-- can send whatever shape it wants without schema changes here.

CREATE TABLE IF NOT EXISTS app_stats (
  app        TEXT PRIMARY KEY,            -- 'motus' | 'ironpassport'
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  stats      JSONB NOT NULL DEFAULT '{}'  -- full stats payload from the app
);

-- Index for fast lookups by app (primary key already covers this,
-- but adding a comment for clarity)
COMMENT ON TABLE app_stats IS 'Latest analytics snapshot per BDHE app, pushed by each app''s cron and read by the Command Center briefing.';
COMMENT ON COLUMN app_stats.stats IS 'Full JSON payload — shape varies by app. Motus sends subscribers/MRR/churn; Iron Passport sends users/searches/cities.';
