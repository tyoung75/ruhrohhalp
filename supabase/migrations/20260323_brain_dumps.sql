-- Brain Dumps: structured weekly context capture
-- Stores goals snapshot, weekly context, and top-of-mind items

create table if not exists public.brain_dumps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  goals jsonb not null default '[]',
  weekly_context text not null default '',
  top_of_mind text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_brain_dumps_user_created
  on public.brain_dumps(user_id, created_at desc);

alter table public.brain_dumps enable row level security;

create policy "brain_dumps_select_own" on public.brain_dumps
  for select using (auth.uid() = user_id);
create policy "brain_dumps_insert_own" on public.brain_dumps
  for insert with check (auth.uid() = user_id);
create policy "brain_dumps_update_own" on public.brain_dumps
  for update using (auth.uid() = user_id);
create policy "brain_dumps_delete_own" on public.brain_dumps
  for delete using (auth.uid() = user_id);

create trigger trg_brain_dumps_updated_at
  before update on public.brain_dumps
  for each row execute function public.set_updated_at();
