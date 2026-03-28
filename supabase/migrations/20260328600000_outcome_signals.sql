-- Item 9: Outcome telemetry
CREATE TABLE IF NOT EXISTS public.outcome_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pillar_id UUID REFERENCES pillars(id),
  goal_id UUID REFERENCES goals(id),
  signal_type TEXT NOT NULL,
  value NUMERIC,
  value_text TEXT,
  recorded_at TIMESTAMPTZ DEFAULT NOW(),
  source TEXT
);

CREATE INDEX IF NOT EXISTS idx_outcome_signals_goal ON outcome_signals(goal_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_outcome_signals_pillar ON outcome_signals(pillar_id, recorded_at DESC);

-- RLS: admin access (internal routes use service role)
ALTER TABLE public.outcome_signals ENABLE ROW LEVEL SECURITY;

-- Add gmail_draft_pending to briefings for the Gmail contract
ALTER TABLE public.briefings ADD COLUMN IF NOT EXISTS gmail_draft_pending BOOLEAN DEFAULT false;

-- Add weekly while keeping legacy daily rows and routes valid during migration.
ALTER TABLE public.briefings DROP CONSTRAINT IF EXISTS briefings_period_check;
ALTER TABLE public.briefings ADD CONSTRAINT briefings_period_check
  CHECK (period IN ('morning', 'evening', 'daily', 'weekly'));
