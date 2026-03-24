-- Add source column to content_queue to distinguish Creator OS posts from external/manual posts
-- 'creator_os' = generated and published through ruhrohhalp
-- 'external'   = posted manually in-app, discovered via platform sync

alter table content_queue add column if not exists source text not null default 'creator_os';

-- Index for filtering by source
create index if not exists idx_content_queue_source on content_queue(user_id, source);
