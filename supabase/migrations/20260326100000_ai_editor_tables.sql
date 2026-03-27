-- AI Editor tables: media_assets, edit_plans, editor_feedback
-- Migration: 20260326100000_ai_editor_tables.sql

-- ---------------------------------------------------------------------------
-- Media asset library — ingested from Google Drive
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS media_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  drive_file_id TEXT,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  thumbnail_path TEXT,
  file_size_bytes BIGINT,
  created_at TIMESTAMPTZ NOT NULL,          -- when photo/video was taken (EXIF or Drive metadata)
  ingested_at TIMESTAMPTZ DEFAULT NOW(),
  location JSONB,                           -- { lat, lng, name? }
  duration_seconds FLOAT,                   -- video only
  width INT,
  height INT,
  is_screenshot BOOLEAN DEFAULT FALSE,      -- detected by screenshot filter
  vision_analysis JSONB,                    -- populated by Director Brain
  status TEXT NOT NULL DEFAULT 'new'        -- new → analyzed → selected → edited → posted → rejected
    CHECK (status IN ('new', 'analyzed', 'selected', 'edited', 'posted', 'rejected', 'screenshot')),
  feedback TEXT,
  used_in_post_id UUID,                     -- FK to content_queue (set when media is used in a post)
  embedding VECTOR(1024)                    -- for semantic search of visual content
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_media_assets_user_status ON media_assets(user_id, status);
CREATE INDEX IF NOT EXISTS idx_media_assets_drive_file ON media_assets(drive_file_id) WHERE drive_file_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_media_assets_created ON media_assets(user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Edit plans — produced by the Director Brain
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS edit_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan JSONB NOT NULL,                      -- full EditPlan JSON
  status TEXT NOT NULL DEFAULT 'pending'    -- pending → processing → completed → failed
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 're_edit')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  output_storage_path TEXT,                 -- edited media result in Supabase Storage
  output_thumbnail_path TEXT,
  content_queue_id UUID,                    -- linked to content_queue entry once draft is created
  director_reasoning TEXT,
  confidence FLOAT,
  brand_voice_score FLOAT,
  re_edit_prompt TEXT,                      -- if Tyler requested a re-edit, the prompt goes here
  parent_plan_id UUID REFERENCES edit_plans(id), -- links to original plan if this is a re-edit
  media_asset_ids UUID[] NOT NULL DEFAULT '{}'   -- which media_assets are used
);

CREATE INDEX IF NOT EXISTS idx_edit_plans_user_status ON edit_plans(user_id, status);

-- ---------------------------------------------------------------------------
-- Editor-specific feedback — extends existing content_feedback
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS editor_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  edit_plan_id UUID REFERENCES edit_plans(id) ON DELETE SET NULL,
  content_queue_id UUID,                    -- FK to content_queue
  action TEXT NOT NULL                      -- approved, deleted, re_edit, note
    CHECK (action IN ('approved', 'deleted', 're_edit', 'note')),
  note TEXT,                                -- free-text feedback
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_editor_feedback_user ON editor_feedback(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_editor_feedback_plan ON editor_feedback(edit_plan_id) WHERE edit_plan_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Media sync state — tracks last sync time per source
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS media_sync_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'google_drive', -- google_drive, manual_upload, etc.
  last_sync_at TIMESTAMPTZ,
  last_page_token TEXT,                     -- Google Drive pagination token
  folder_id TEXT,                           -- Google Drive folder ID being watched
  UNIQUE(user_id, source)
);
