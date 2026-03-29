-- Financial OS: Comprehensive financial tracking for TylerOS
-- Multi-person household support (tyler / spouse / joint / business)
-- Tables: accounts, holdings, income, debts, contributions, rsu_vests, snapshots, config, alerts, audit_log

-- ============================================================
-- 1. financial_accounts — bank, brokerage, retirement, etc.
-- ============================================================
create table if not exists financial_accounts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  owner       text not null default 'tyler' check (owner in ('tyler', 'spouse', 'joint', 'business')),
  account_name text not null,
  institution text not null,
  account_type text not null check (account_type in (
    'checking', 'savings', 'brokerage', '401k', 'ira', 'roth_ira', 'equity_awards', 'crypto', 'other'
  )),
  balance     numeric(14,2) not null default 0,
  currency    text not null default 'USD',
  notes       text,
  last_synced timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table financial_accounts enable row level security;
create policy "users_own_accounts" on financial_accounts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index idx_fin_accounts_user on financial_accounts(user_id);
create index idx_fin_accounts_owner on financial_accounts(user_id, owner);

-- ============================================================
-- 2. financial_holdings — positions within accounts
-- ============================================================
create table if not exists financial_holdings (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references financial_accounts(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  symbol      text not null,
  name        text,
  shares      numeric(14,4) not null default 0,
  current_price numeric(12,4),
  current_value numeric(14,2) not null default 0,
  cost_basis  numeric(14,2),
  holding_type text not null default 'stock' check (holding_type in (
    'stock', 'etf', 'mutual_fund', 'option', 'crypto', 'cash', 'bond', 'other'
  )),
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table financial_holdings enable row level security;
create policy "users_own_holdings" on financial_holdings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index idx_fin_holdings_account on financial_holdings(account_id);
create index idx_fin_holdings_user on financial_holdings(user_id);

-- ============================================================
-- 3. financial_income — salary, spouse income, side income
-- ============================================================
create table if not exists financial_income (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  owner         text not null default 'tyler' check (owner in ('tyler', 'spouse', 'joint', 'business')),
  source        text not null,
  label         text not null,
  amount        numeric(12,2) not null,
  frequency     text not null check (frequency in (
    'weekly', 'biweekly', 'semimonthly', 'monthly', 'quarterly', 'annual', 'one_time'
  )),
  is_active     boolean not null default true,
  effective_date date,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table financial_income enable row level security;
create policy "users_own_income" on financial_income
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index idx_fin_income_user on financial_income(user_id);

-- ============================================================
-- 4. financial_debts — credit cards, loans, margin
-- ============================================================
create table if not exists financial_debts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  owner        text not null default 'tyler' check (owner in ('tyler', 'spouse', 'joint', 'business')),
  name         text not null,
  institution  text not null,
  balance      numeric(14,2) not null default 0,
  credit_limit numeric(14,2),
  apr          numeric(5,2) not null default 0,
  min_payment  numeric(10,2) not null default 0,
  debt_type    text not null check (debt_type in (
    'credit_card', 'personal_loan', 'auto_loan', 'mortgage', 'student_loan',
    'margin_loan', 'line_of_credit', 'other'
  )),
  status       text not null default 'active' check (status in ('active', 'paid_off', 'closed')),
  due_date     int, -- day of month
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table financial_debts enable row level security;
create policy "users_own_debts" on financial_debts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index idx_fin_debts_user on financial_debts(user_id);

-- ============================================================
-- 5. financial_contributions — recurring investments
--    Supports both fixed amounts AND percentage-of-salary
-- ============================================================
create table if not exists financial_contributions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  owner          text not null default 'tyler' check (owner in ('tyler', 'spouse', 'joint', 'business')),
  destination    text not null,
  account_id     uuid references financial_accounts(id) on delete set null,
  amount         numeric(10,2) not null,          -- fixed dollar amount OR percentage (0-100)
  is_percentage  boolean not null default false,   -- if true, amount is % of salary
  frequency      text not null check (frequency in (
    'weekly', 'biweekly', 'semimonthly', 'monthly', 'quarterly', 'annual'
  )),
  contribution_type text not null default 'investment' check (contribution_type in (
    'pre_tax_401k', 'after_tax_401k', 'employer_match', 'roth_ira', 'investment', 'crypto', 'other'
  )),
  is_active      boolean not null default true,
  day_of_month   int,                              -- for monthly contributions (e.g., 3rd of month)
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table financial_contributions enable row level security;
create policy "users_own_contributions" on financial_contributions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index idx_fin_contributions_user on financial_contributions(user_id);

-- ============================================================
-- 6. financial_rsu_vests — future vesting schedule
-- ============================================================
create table if not exists financial_rsu_vests (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  owner        text not null default 'tyler' check (owner in ('tyler', 'spouse')),
  symbol       text not null,
  shares       numeric(10,2) not null,
  vest_date    date not null,
  grant_id     text,
  award_date   date,
  current_price numeric(12,4),
  estimated_value numeric(14,2),
  status       text not null default 'pending' check (status in ('pending', 'vested', 'sold')),
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table financial_rsu_vests enable row level security;
create policy "users_own_rsu_vests" on financial_rsu_vests
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index idx_fin_rsu_user on financial_rsu_vests(user_id);
create index idx_fin_rsu_vest_date on financial_rsu_vests(vest_date);

-- ============================================================
-- 7. financial_snapshots — daily net worth tracking
-- ============================================================
create table if not exists financial_snapshots (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  snapshot_date   date not null,
  total_assets    numeric(14,2) not null default 0,
  total_liabilities numeric(14,2) not null default 0,
  net_worth       numeric(14,2) not null default 0,
  cash_position   numeric(14,2) not null default 0,
  breakdown       jsonb not null default '{}',
  created_at      timestamptz not null default now()
);

alter table financial_snapshots enable row level security;
create policy "users_own_snapshots" on financial_snapshots
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index idx_fin_snapshots_user_date on financial_snapshots(user_id, snapshot_date desc);
create unique index idx_fin_snapshots_unique on financial_snapshots(user_id, snapshot_date);

-- ============================================================
-- 8. financial_config — user-specific settings (tax rate, etc.)
-- ============================================================
create table if not exists financial_config (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  key        text not null,
  value      text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, key)
);

alter table financial_config enable row level security;
create policy "users_own_config" on financial_config
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index idx_fin_config_user on financial_config(user_id);

-- ============================================================
-- 9. financial_alerts — statement closing, balance thresholds
-- ============================================================
create table if not exists financial_alerts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  debt_id      uuid references financial_debts(id) on delete cascade,
  account_id   uuid references financial_accounts(id) on delete cascade,
  alert_type   text not null check (alert_type in (
    'statement_closing', 'balance_threshold', 'payment_due', 'vest_approaching', 'custom'
  )),
  rule         jsonb not null default '{}',        -- e.g. {"trigger": "email_subject", "pattern": "statement closing"}
  message      text,
  is_active    boolean not null default true,
  last_triggered timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table financial_alerts enable row level security;
create policy "users_own_alerts" on financial_alerts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index idx_fin_alerts_user on financial_alerts(user_id);

-- ============================================================
-- 10. financial_audit_log — immutable change tracking
-- ============================================================
create table if not exists financial_audit_log (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  table_name  text not null,
  record_id   uuid not null,
  action      text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  old_value   jsonb,
  new_value   jsonb,
  created_at  timestamptz not null default now()
);

alter table financial_audit_log enable row level security;
create policy "users_own_audit" on financial_audit_log
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index idx_fin_audit_user on financial_audit_log(user_id);
create index idx_fin_audit_table on financial_audit_log(table_name, record_id);

-- ============================================================
-- Updated-at triggers (reuse existing function if present)
-- ============================================================
do $$
begin
  if not exists (select 1 from pg_proc where proname = 'set_updated_at') then
    create function set_updated_at() returns trigger as $fn$
    begin
      new.updated_at = now();
      return new;
    end;
    $fn$ language plpgsql;
  end if;
end $$;

create trigger trg_fin_accounts_updated before update on financial_accounts
  for each row execute function set_updated_at();
create trigger trg_fin_holdings_updated before update on financial_holdings
  for each row execute function set_updated_at();
create trigger trg_fin_income_updated before update on financial_income
  for each row execute function set_updated_at();
create trigger trg_fin_debts_updated before update on financial_debts
  for each row execute function set_updated_at();
create trigger trg_fin_contributions_updated before update on financial_contributions
  for each row execute function set_updated_at();
create trigger trg_fin_rsu_vests_updated before update on financial_rsu_vests
  for each row execute function set_updated_at();
create trigger trg_fin_config_updated before update on financial_config
  for each row execute function set_updated_at();
create trigger trg_fin_alerts_updated before update on financial_alerts
  for each row execute function set_updated_at();

-- ============================================================
-- Audit log trigger function
-- ============================================================
create or replace function fin_audit_trigger() returns trigger as $$
begin
  if (TG_OP = 'INSERT') then
    insert into financial_audit_log (user_id, table_name, record_id, action, new_value)
    values (new.user_id, TG_TABLE_NAME, new.id, 'INSERT', to_jsonb(new));
    return new;
  elsif (TG_OP = 'UPDATE') then
    insert into financial_audit_log (user_id, table_name, record_id, action, old_value, new_value)
    values (new.user_id, TG_TABLE_NAME, new.id, 'UPDATE', to_jsonb(old), to_jsonb(new));
    return new;
  elsif (TG_OP = 'DELETE') then
    insert into financial_audit_log (user_id, table_name, record_id, action, old_value)
    values (old.user_id, TG_TABLE_NAME, old.id, 'DELETE', to_jsonb(old));
    return old;
  end if;
  return null;
end;
$$ language plpgsql;

-- Attach audit triggers to all financial tables
create trigger audit_fin_accounts after insert or update or delete on financial_accounts
  for each row execute function fin_audit_trigger();
create trigger audit_fin_holdings after insert or update or delete on financial_holdings
  for each row execute function fin_audit_trigger();
create trigger audit_fin_income after insert or update or delete on financial_income
  for each row execute function fin_audit_trigger();
create trigger audit_fin_debts after insert or update or delete on financial_debts
  for each row execute function fin_audit_trigger();
create trigger audit_fin_contributions after insert or update or delete on financial_contributions
  for each row execute function fin_audit_trigger();
create trigger audit_fin_rsu_vests after insert or update or delete on financial_rsu_vests
  for each row execute function fin_audit_trigger();
create trigger audit_fin_config after insert or update or delete on financial_config
  for each row execute function fin_audit_trigger();
