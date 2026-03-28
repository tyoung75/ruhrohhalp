-- Postgres function to increment goal progress when tasks are completed
-- Called by application code or can be used in triggers

CREATE OR REPLACE FUNCTION public.increment_goal_progress(
  p_goal_id UUID,
  p_signal_value NUMERIC DEFAULT 1
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current TEXT;
  v_new_val NUMERIC;
BEGIN
  -- Get current progress
  SELECT progress_current INTO v_current
  FROM public.goals
  WHERE id = p_goal_id;

  -- Try to parse as number and increment
  BEGIN
    v_new_val := COALESCE(v_current::NUMERIC, 0) + p_signal_value;
    UPDATE public.goals
    SET progress_current = v_new_val::TEXT,
        updated_at = NOW()
    WHERE id = p_goal_id;
  EXCEPTION WHEN OTHERS THEN
    -- progress_current is not numeric (e.g. "3:23:02") — skip increment
    NULL;
  END;
END;
$$;
