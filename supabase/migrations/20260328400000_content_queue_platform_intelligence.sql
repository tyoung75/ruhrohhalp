-- Item 8: Platform Intelligence Agent — extend content_queue with additional columns
ALTER TABLE content_queue ADD COLUMN IF NOT EXISTS topic TEXT;
ALTER TABLE content_queue ADD COLUMN IF NOT EXISTS platform_format TEXT;
ALTER TABLE content_queue ADD COLUMN IF NOT EXISTS caption TEXT;
ALTER TABLE content_queue ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE content_queue ADD COLUMN IF NOT EXISTS platform_spec JSONB;
ALTER TABLE content_queue ADD COLUMN IF NOT EXISTS content_idea_id UUID;
ALTER TABLE content_queue ADD COLUMN IF NOT EXISTS external_id TEXT;
ALTER TABLE content_queue ADD COLUMN IF NOT EXISTS ai_audit_passed BOOLEAN;
ALTER TABLE content_queue ADD COLUMN IF NOT EXISTS audit_notes TEXT;
ALTER TABLE content_queue ADD COLUMN IF NOT EXISTS generated_by TEXT DEFAULT 'platform_intelligence_agent';

CREATE INDEX IF NOT EXISTS idx_cq_idea ON content_queue(content_idea_id);
CREATE INDEX IF NOT EXISTS idx_cq_platform_status ON content_queue(platform, status);
