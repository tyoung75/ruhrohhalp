-- Expand the feedback.action CHECK constraint to support new briefing feedback actions:
-- already_done, wont_do, helpful, not_helpful (in addition to existing values)
alter table public.feedback drop constraint if exists feedback_action_check;
alter table public.feedback add constraint feedback_action_check
  check (action in ('more','less','remove','fix','thumbs_up','thumbs_down','helpful','not_helpful','already_done','wont_do'));
