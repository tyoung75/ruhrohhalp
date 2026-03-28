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

-- Older environments may already have a legacy content_feedback table with
-- `feedback` instead of `content`, and without `context` / `active`.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'content_feedback'
      and column_name = 'feedback'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'content_feedback'
      and column_name = 'content'
  ) then
    alter table public.content_feedback rename column feedback to content;
  end if;
end $$;

alter table public.content_feedback
  add column if not exists content_queue_id uuid references public.content_queue(id) on delete set null,
  add column if not exists feedback_type text,
  add column if not exists content text,
  add column if not exists context jsonb default '{}'::jsonb,
  add column if not exists active boolean default true,
  add column if not exists created_at timestamptz default now();

update public.content_feedback
set context = '{}'::jsonb
where context is null;

update public.content_feedback
set active = true
where active is null;

update public.content_feedback
set content = ''
where content is null;

alter table public.content_feedback
  alter column content set not null,
  alter column active set default true,
  alter column active set not null,
  alter column created_at set default now();

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
