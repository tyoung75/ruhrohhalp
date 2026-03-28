-- Extend activity_log type constraint to include new types
ALTER TABLE public.activity_log DROP CONSTRAINT IF EXISTS activity_log_type_check;
ALTER TABLE public.activity_log ADD CONSTRAINT activity_log_type_check
  CHECK (type IN (
    'task_created', 'task_updated', 'task_completed', 'task_cancelled',
    'briefing_generated', 'command_processed', 'agent_dispatched', 'feedback_submitted',
    'zombie_alert', 'goal_signal', 'ai_call', 'task_dismissed'
  ));
