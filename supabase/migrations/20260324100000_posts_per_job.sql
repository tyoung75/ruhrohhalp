-- Rename daily_publish_limit to posts_per_job and add max_backfill
-- This migration handles the case where the column may or may not exist
do $$
begin
  -- Rename daily_publish_limit to posts_per_job if it exists
  if exists (select 1 from information_schema.columns where table_name = 'creator_settings' and column_name = 'daily_publish_limit') then
    alter table creator_settings rename column daily_publish_limit to posts_per_job;
  end if;
  -- Add posts_per_job if it doesn't exist (fresh installs)
  if not exists (select 1 from information_schema.columns where table_name = 'creator_settings' and column_name = 'posts_per_job') then
    alter table creator_settings add column posts_per_job int not null default 2;
  end if;
  -- Add max_backfill column
  if not exists (select 1 from information_schema.columns where table_name = 'creator_settings' and column_name = 'max_backfill') then
    alter table creator_settings add column max_backfill int not null default 6;
  end if;
end $$;
