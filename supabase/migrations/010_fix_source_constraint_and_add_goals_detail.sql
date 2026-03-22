-- Migration: Fix source constraint and add goals detail tracking
-- Description: Updates tasks source constraint, adds leverage_reason column, and creates goal_history table
-- Timestamp: 2026-03-22

-- 1. Fix the tasks.source check constraint
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_source_check;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_source_check CHECK (source IN ('linear_import', 'manual', 'cowork', 'api', 'command'));

-- 2. Add leverage_reason column to tasks table
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS leverage_reason TEXT DEFAULT '';

-- 3. Create goal_history table for tracking goal changes over time
CREATE TABLE IF NOT EXISTS public.goal_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id UUID NOT NULL REFERENCES public.goals(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  field_changed TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  change_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create index for efficient goal history queries
CREATE INDEX IF NOT EXISTS idx_goal_history_goal ON public.goal_history(goal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_goal_history_user ON public.goal_history(user_id, created_at DESC);

-- Enable Row Level Security on goal_history
ALTER TABLE public.goal_history ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only select their own goal history
DROP POLICY IF EXISTS goal_history_select_own ON public.goal_history;
CREATE POLICY goal_history_select_own ON public.goal_history
  FOR SELECT
  USING (auth.uid() = user_id);

-- RLS Policy: Users can only insert their own goal history
DROP POLICY IF EXISTS goal_history_insert_own ON public.goal_history;
CREATE POLICY goal_history_insert_own ON public.goal_history
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- 4. Add progress tracking columns to goals table
ALTER TABLE public.goals ADD COLUMN IF NOT EXISTS progress_current TEXT;
ALTER TABLE public.goals ADD COLUMN IF NOT EXISTS progress_target TEXT;
ALTER TABLE public.goals ADD COLUMN IF NOT EXISTS progress_metric TEXT;
