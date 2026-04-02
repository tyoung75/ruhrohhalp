create table if not exists public.financial_statement_ingestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_name text not null,
  institution text,
  statement_month date not null,
  file_name text not null,
  content_type text,
  bytes bigint not null default 0,
  ingestion_status text not null default 'queued' check (ingestion_status in ('queued','processed','failed')),
  ingestion_notes text,
  extracted_text text,
  uploaded_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_fin_stmt_ingestions_user_uploaded
  on public.financial_statement_ingestions(user_id, uploaded_at desc);

alter table public.financial_statement_ingestions enable row level security;

create policy "Users can view own statement ingestions"
  on public.financial_statement_ingestions for select
  using (auth.uid() = user_id);

create policy "Users can insert own statement ingestions"
  on public.financial_statement_ingestions for insert
  with check (auth.uid() = user_id);

create policy "Users can update own statement ingestions"
  on public.financial_statement_ingestions for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
