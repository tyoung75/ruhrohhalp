-- Fix briefings.period CHECK constraint
-- The original constraint only allowed 'morning'|'evening' but the application
-- code uses 'daily'|'weekly'. This caused all briefing inserts to silently fail,
-- breaking persistence across page reloads.

ALTER TABLE public.briefings
  DROP CONSTRAINT IF EXISTS briefings_period_check;

ALTER TABLE public.briefings
  ADD CONSTRAINT briefings_period_check
  CHECK (period IN ('morning', 'evening', 'daily', 'weekly'));
