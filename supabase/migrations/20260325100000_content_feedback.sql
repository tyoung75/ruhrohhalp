-- Content Feedback — closed-loop learning for Creator OS agents
--
-- Captures Tyler's direct feedback on generated/published content and
-- strategic directives. Fed into both the strategy agent and content
-- generation agent so they adapt to his preferences.

create table if not exists content_feedback (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,

  -- Optional link to a specific content_queue item
  content_queue_id uuid references content_queue(id) on delete set null,

  -- Feedback classification
  feedback_type text not null check (feedback_type in (
    'like',        -- thumbs up on a post
    'dislike',     -- thumbs down / deleted post
    'correction',  -- "this should have been X instead"
    'directive'    -- standing instruction: "never do X", "always do Y"
  )),

  -- The actual feedback message
  content     text not null,

  -- Auto-captured context about what this feedback references
  context     jsonb default '{}',

  -- Directives can be marked inactive if superseded
  active      boolean not null default true,

  created_at  timestamptz not null default now()
);

-- Index for querying recent active feedback
create index if not exists idx_content_feedback_user_active
  on content_feedback (user_id, active, created_at desc);

-- Index for querying feedback on specific posts
create index if not exists idx_content_feedback_content_queue
  on content_feedback (content_queue_id)
  where content_queue_id is not null;

-- RLS
alter table content_feedback enable row level security;

create policy "Users manage own feedback"
  on content_feedback for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
