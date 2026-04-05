-- Track which LLM generated each queued post so we can attribute performance by model.
ALTER TABLE content_queue
ADD COLUMN IF NOT EXISTS model_source TEXT;

-- Helpful for analytics rollups by model.
CREATE INDEX IF NOT EXISTS idx_content_queue_model_source
  ON content_queue(user_id, model_source);
