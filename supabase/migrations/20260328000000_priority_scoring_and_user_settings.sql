-- Item 1: Priority scoring engine + user_settings table
-- Adds priority_score and ai_metadata to tasks, creates user_settings for scoring weights

-- 1. Add scoring columns to tasks
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS priority_score FLOAT DEFAULT 0;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS ai_metadata JSONB DEFAULT '{}';
CREATE INDEX IF NOT EXISTS idx_tasks_priority_score ON public.tasks(priority_score DESC) WHERE state NOT IN ('done');

-- 2. Create user_settings table for scoring weights, brain dump, content patterns
CREATE TABLE IF NOT EXISTS public.user_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  scoring_weights JSONB DEFAULT '{"goal_impact": 0.4, "urgency": 0.3, "energy_fit": 0.2, "recency": 0.1}',
  brain_dump_week TEXT,
  top_of_mind TEXT,
  content_patterns JSONB DEFAULT '{}',
  content_patterns_updated_at TIMESTAMPTZ,
  content_patterns_manual_override JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_settings_select_own" ON public.user_settings;
CREATE POLICY "user_settings_select_own" ON public.user_settings
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_settings_insert_own" ON public.user_settings;
CREATE POLICY "user_settings_insert_own" ON public.user_settings
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_settings_update_own" ON public.user_settings;
CREATE POLICY "user_settings_update_own" ON public.user_settings
  FOR UPDATE USING (auth.uid() = user_id);

CREATE TRIGGER trg_user_settings_updated_at
  BEFORE UPDATE ON public.user_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
