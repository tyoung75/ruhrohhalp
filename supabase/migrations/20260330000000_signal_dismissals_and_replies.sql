-- Signal dismissals: persistent, fuzzy-matched suppression of briefing signals
-- Signal replies: inline feedback tied to specific signals for AI learning

-------------------------------------------------------------------------------
-- signal_dismissals: tracks dismissed signals by normalized fingerprint
-------------------------------------------------------------------------------

create table if not exists public.signal_dismissals (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,

  -- Normalized fingerprint for fuzzy matching (lowercase, sorted key terms)
  fingerprint   text not null,

  -- Original signal text for display in "dismissed" list
  original_text text not null,

  -- The category of signal that was dismissed
  category      text,

  -- Source that generated this signal
  source        text,

  -- Whether this dismissal is still active
  active        boolean not null default true,

  created_at    timestamptz not null default now()
);

-- Unique constraint: one active dismissal per fingerprint per user
create unique index if not exists idx_signal_dismissals_user_fp
  on signal_dismissals (user_id, fingerprint) where active = true;

-- Fast lookup for filtering during briefing generation
create index if not exists idx_signal_dismissals_user_active
  on signal_dismissals (user_id, active, created_at desc);

-- RLS
alter table public.signal_dismissals enable row level security;

create policy "Users manage own dismissals"
  on signal_dismissals for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-------------------------------------------------------------------------------
-- signal_replies: user responses to specific signals for AI learning
-------------------------------------------------------------------------------

create table if not exists public.signal_replies (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,

  -- The fingerprint of the signal being replied to
  signal_fingerprint text not null,

  -- Original signal text for context
  signal_text   text not null,

  -- The category of signal
  signal_category text,

  -- User's reply
  reply         text not null,

  -- Whether this feedback has been incorporated into briefing generation
  applied       boolean not null default false,

  -- Scope: does this feedback apply to just this signal or broadly?
  -- 'specific' = only this exact signal topic
  -- 'broad' = adjust general briefing behavior
  scope         text not null default 'specific'
                check (scope in ('specific', 'broad')),

  created_at    timestamptz not null default now()
);

-- Index for querying unapplied replies during briefing generation
create index if not exists idx_signal_replies_user_unapplied
  on signal_replies (user_id, applied, created_at desc);

-- Index for looking up replies to a specific signal
create index if not exists idx_signal_replies_fingerprint
  on signal_replies (user_id, signal_fingerprint, created_at desc);

-- RLS
alter table public.signal_replies enable row level security;

create policy "Users manage own signal replies"
  on signal_replies for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
