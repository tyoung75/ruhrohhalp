-- Brand outreach feedback table — stores per-deal feedback on drafts and brand fit.
-- Embedded into semantic memory for the brand voice + scouting agents to learn from.

CREATE TABLE IF NOT EXISTS brand_outreach_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  brand_deal_id uuid NOT NULL REFERENCES brand_deals(id) ON DELETE CASCADE,
  email_id uuid REFERENCES brand_outreach_emails(id) ON DELETE SET NULL,
  feedback_type text NOT NULL CHECK (feedback_type IN ('like', 'dislike', 'correction', 'directive', 'voice_note')),
  content text NOT NULL,
  context jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_brand_feedback_deal ON brand_outreach_feedback(brand_deal_id);
CREATE INDEX idx_brand_feedback_user ON brand_outreach_feedback(user_id);

ALTER TABLE brand_outreach_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own brand feedback" ON brand_outreach_feedback
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own brand feedback" ON brand_outreach_feedback
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Service role full access brand_outreach_feedback" ON brand_outreach_feedback
  FOR ALL USING (auth.role() = 'service_role');
