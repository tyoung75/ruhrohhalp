-- ==========================================================================
-- Creator OS: Follower Tracking + Social Strategy Intelligence
-- ==========================================================================

-- 1. follower_snapshots — daily per-platform follower/engagement snapshots
create table if not exists follower_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) not null,
  platform text not null,               -- 'threads', 'instagram', 'tiktok'
  followers int not null default 0,
  following int not null default 0,
  posts_count int not null default 0,
  -- Advanced KPIs (computed at snapshot time)
  engagement_rate decimal,              -- avg engagement / followers for recent posts
  reach_rate decimal,                   -- avg impressions / followers (organic reach %)
  virality_rate decimal,                -- avg (reposts + quotes) / impressions
  reply_rate decimal,                   -- avg replies / impressions
  non_follower_pct decimal,             -- % of impressions from non-followers (algo push)
  avg_impressions_per_post decimal,     -- rolling avg impressions
  follower_growth_rate decimal,         -- % change vs previous snapshot
  -- Platform-specific extras
  extra jsonb default '{}'::jsonb,      -- profile_views, reach, saves, etc.
  fetched_at timestamptz not null default now()
);

-- One row per platform per day
create unique index if not exists idx_follower_snapshots_daily
  on follower_snapshots (user_id, platform, (fetched_at::date));

create index if not exists idx_follower_snapshots_user_platform
  on follower_snapshots (user_id, platform, fetched_at desc);

alter table follower_snapshots enable row level security;
create policy "Users manage own follower snapshots"
  on follower_snapshots for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);


-- 2. trend_signals — ephemeral trending topic signals
create table if not exists trend_signals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) not null,
  topic text not null,
  platform text,                        -- null = cross-platform trend
  relevance_score decimal default 0.5,  -- 0-1 relevance to Tyler's brand
  source text not null,                 -- 'web_search', 'hashtag_analysis', 'engagement_velocity', 'manual'
  context text,                         -- why this is relevant
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now()
);

create index if not exists idx_trend_signals_active
  on trend_signals (user_id, expires_at desc)
  where expires_at > now();

alter table trend_signals enable row level security;
create policy "Users manage own trend signals"
  on trend_signals for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);


-- 3. strategy_insights — adaptive strategy knowledge store
create table if not exists strategy_insights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) not null,
  insight_type text not null check (insight_type in (
    'content_pattern',   -- what content performs well
    'timing',            -- when to post
    'platform_rec',      -- platform-specific recommendations
    'trend_shift',       -- overarching trend changes
    'velocity',          -- posting frequency recommendations
    'audience',          -- audience behavior patterns
    'algorithm'          -- what the algorithm pushes
  )),
  content text not null,                -- natural language insight
  data jsonb default '{}'::jsonb,       -- supporting metrics/data
  confidence decimal default 0.5,       -- 0-1
  embedding vector(1024),               -- BGE-M3 for semantic search
  active boolean not null default true, -- current vs superseded
  created_at timestamptz not null default now()
);

create index if not exists idx_strategy_insights_active
  on strategy_insights (user_id, insight_type)
  where active = true;

create index if not exists idx_strategy_insights_embedding
  on strategy_insights using ivfflat (embedding vector_cosine_ops)
  with (lists = 10);

alter table strategy_insights enable row level security;
create policy "Users manage own strategy insights"
  on strategy_insights for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
