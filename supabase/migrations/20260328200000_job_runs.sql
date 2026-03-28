-- Item 5: job_runs state machine for idempotent job execution
CREATE TABLE IF NOT EXISTS public.job_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'dead_letter')),
  idempotency_key TEXT UNIQUE,
  payload JSONB DEFAULT '{}',
  result JSONB,
  error TEXT,
  retries INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_runs_type_status ON job_runs(job_type, status);
CREATE INDEX IF NOT EXISTS idx_job_runs_created ON job_runs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_runs_idempotency ON job_runs(idempotency_key) WHERE idempotency_key IS NOT NULL;

-- RLS: service role access only (internal routes use admin client)
ALTER TABLE public.job_runs ENABLE ROW LEVEL SECURITY;
