-- Creator OS: Content pipeline tables
-- Supports autonomous content generation, scheduling, publishing, and analytics

-- Platform tokens (OAuth for Threads, Instagram, TikTok, Strava)
create table if not exists platform_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null, -- 'threads', 'instagram', 'tiktok', 'strava'
  access_token text not null,
  refresh_token text,
  token_type text default 'bearer',
  expires_at timestamptz,
  scopes text[],
  platform_user_id text, -- the user's ID on the platform
  platform_username text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, platform)
);

-- Content queue (the core of the creator OS)
create table if not exists content_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null, -- 'threads', 'instagram', 'tiktok'
  content_type text not null default 'text', -- 'text', 'image', 'carousel', 'reel'
  body text not null,
  media_urls text[], -- references to Supabase Storage paths
  hashtags text[],
  scheduled_for timestamptz,
  status text not null default 'draft', -- draft, approved, queued, posting, posted, failed
  post_id text, -- platform's post ID after publishing
  post_url text,
  attempts int default 0,
  max_attempts int default 3,
  last_error text,
  context_snapshot jsonb, -- daily_context at generation time
  agent_reasoning text, -- why the agent chose this content
  confidence_score decimal, -- 0-1 how confident the agent is
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Post analytics (feedback loop)
create table if not exists post_analytics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  content_queue_id uuid references content_queue(id) on delete set null,
  platform text not null,
  post_id text not null,
  impressions int default 0,
  likes int default 0,
  replies int default 0,
  reposts int default 0,
  quotes int default 0,
  follows_gained int default 0,
  engagement_rate decimal,
  fetched_at timestamptz default now(),
  unique(platform, post_id, fetched_at)
);

-- Media library
create table if not exists media_library (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null, -- Supabase Storage path
  thumbnail_path text,
  file_name text,
  mime_type text,
  file_size_bytes int,
  tags text[], -- 'gym', 'run', 'nyc', 'lifestyle'
  source text default 'upload', -- 'upload', 'camera_roll_sync', 'generated'
  used_in_posts uuid[], -- content_queue IDs
  quality_score decimal, -- AI-scored 0-1
  created_at timestamptz default now()
);

-- Content feedback (closing the learning loop)
create table if not exists content_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  content_queue_id uuid references content_queue(id) on delete set null,
  feedback_type text not null, -- 'manual', 'performance', 'audience', 'voice'
  rating int, -- 1-5 manual rating
  feedback text,
  created_at timestamptz default now()
);

-- Indexes for common queries
create index if not exists idx_content_queue_user_status on content_queue(user_id, status);
create index if not exists idx_content_queue_scheduled on content_queue(scheduled_for) where status = 'queued';
create index if not exists idx_content_queue_platform on content_queue(user_id, platform, status);
create index if not exists idx_post_analytics_queue on post_analytics(content_queue_id);
create index if not exists idx_post_analytics_platform on post_analytics(user_id, platform);
create index if not exists idx_media_library_user on media_library(user_id);
create index if not exists idx_media_library_tags on media_library using gin(tags);
create index if not exists idx_platform_tokens_user on platform_tokens(user_id, platform);

-- RLS policies
alter table platform_tokens enable row level security;
alter table content_queue enable row level security;
alter table post_analytics enable row level security;
alter table media_library enable row level security;
alter table content_feedback enable row level security;

create policy "Users can manage own tokens" on platform_tokens
  for all using (auth.uid() = user_id);

create policy "Users can manage own content" on content_queue
  for all using (auth.uid() = user_id);

create policy "Users can view own analytics" on post_analytics
  for all using (auth.uid() = user_id);

create policy "Users can manage own media" on media_library
  for all using (auth.uid() = user_id);

create policy "Users can manage own feedback" on content_feedback
  for all using (auth.uid() = user_id);
