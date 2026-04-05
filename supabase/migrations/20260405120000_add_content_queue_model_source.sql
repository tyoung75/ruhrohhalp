-- Track which model generated each Creator OS post for analytics and auditability
ALTER TABLE content_queue
  ADD COLUMN IF NOT EXISTS model_source TEXT;

CREATE INDEX IF NOT EXISTS idx_content_queue_model_source
  ON content_queue(user_id, model_source);
