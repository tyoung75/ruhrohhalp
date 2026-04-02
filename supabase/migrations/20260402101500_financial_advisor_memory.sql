create table if not exists public.financial_advisor_memory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  memory_type text not null check (memory_type in ('advisor_snapshot','user_feedback','system_note')),
  title text,
  content jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_fin_advisor_memory_user_created
  on public.financial_advisor_memory(user_id, created_at desc);

alter table public.financial_advisor_memory enable row level security;

create policy "Users can view own advisor memory"
  on public.financial_advisor_memory for select
  using (auth.uid() = user_id);

create policy "Users can insert own advisor memory"
  on public.financial_advisor_memory for insert
  with check (auth.uid() = user_id);
