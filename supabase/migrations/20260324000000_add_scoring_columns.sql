-- Add brand_voice_score and timeliness_score to content_queue
-- These are rated 0-1 by the generation agent and used in publish selection scoring.
-- brand_voice_score: how well the post matches Tyler's voice (lowercase, direct, specific, no clichés)
-- timeliness_score: how relevant the post is to current events / trending topics (decays fast)

alter table content_queue add column if not exists brand_voice_score decimal;
alter table content_queue add column if not exists timeliness_score decimal;
