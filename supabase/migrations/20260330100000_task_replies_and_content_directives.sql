-- Task replies: inline feedback on individual tasks for AI learning
-- Content directives: broad strategy instructions for the content generation agents

-------------------------------------------------------------------------------
-- task_replies: user replies tied to specific tasks
-------------------------------------------------------------------------------

create table if not exists public.task_replies (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  task_id       uuid not null references public.tasks(id) on delete cascade,

  -- The reply text
  reply         text not null,

  -- Whether this feedback has been incorporated
  applied       boolean not null default false,

  created_at    timestamptz not null default now()
);

create index if not exists idx_task_replies_task
  on task_replies (task_id, created_at desc);

create index if not exists idx_task_replies_user_unapplied
  on task_replies (user_id, applied, created_at desc);

-- RLS
alter table public.task_replies enable row level security;

create policy "Users manage own task replies"
  on task_replies for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-------------------------------------------------------------------------------
-- content_directives: broad standing instructions for content strategy
-- These are distinct from per-post feedback — they steer the overall
-- content generation approach across all platforms.
-- Examples:
--   "Stop posting motivational quotes"
--   "Shift away from gym mirror selfies"
--   "More behind-the-scenes training content"
--   "I want to lean into race prep content for the next month"
-------------------------------------------------------------------------------

create table if not exists public.content_directives (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,

  -- The directive text
  directive     text not null,

  -- Optional: which platforms this applies to (null = all platforms)
  platforms     text[] default null,

  -- Whether this directive is still active
  active        boolean not null default true,

  -- Whether content agents have incorporated this directive
  applied       boolean not null default false,

  -- Expiry: some directives are time-bounded ("for the next month")
  expires_at    timestamptz default null,

  created_at    timestamptz not null default now()
);

create index if not exists idx_content_directives_user_active
  on content_directives (user_id, active, created_at desc);

-- RLS
alter table public.content_directives enable row level security;

create policy "Users manage own content directives"
  on content_directives for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
