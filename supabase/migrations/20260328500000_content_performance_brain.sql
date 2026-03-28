-- Item 8c: Content Performance Brain
-- Add missing columns to post_analytics for performance tracking
ALTER TABLE post_analytics ADD COLUMN IF NOT EXISTS views INTEGER DEFAULT 0;
ALTER TABLE post_analytics ADD COLUMN IF NOT EXISTS saves INTEGER DEFAULT 0;
ALTER TABLE post_analytics ADD COLUMN IF NOT EXISTS shares INTEGER DEFAULT 0;
ALTER TABLE post_analytics ADD COLUMN IF NOT EXISTS watch_through_rate DECIMAL;
ALTER TABLE post_analytics ADD COLUMN IF NOT EXISTS follower_delta INTEGER DEFAULT 0;
ALTER TABLE post_analytics ADD COLUMN IF NOT EXISTS engagement_score FLOAT;
ALTER TABLE post_analytics ADD COLUMN IF NOT EXISTS hook TEXT;
ALTER TABLE post_analytics ADD COLUMN IF NOT EXISTS content_category TEXT;
ALTER TABLE post_analytics ADD COLUMN IF NOT EXISTS was_pattern_informed BOOLEAN DEFAULT false;

-- Create a view for convenience (content_performance alias)
CREATE OR REPLACE VIEW content_performance AS
  SELECT
    pa.*,
    cq.body,
    cq.topic,
    cq.platform_format,
    cq.content_type,
    cq.generated_by
  FROM post_analytics pa
  LEFT JOIN content_queue cq ON pa.content_queue_id = cq.id;
