-- Add 'scouted' status to brand_deals so AI-recommended brands persist
-- Add 'delayed' status for brands Tyler wants to revisit later
ALTER TABLE brand_deals DROP CONSTRAINT IF EXISTS brand_deals_status_check;
ALTER TABLE brand_deals ADD CONSTRAINT brand_deals_status_check CHECK (status IN (
  'scouted', 'prospect', 'draft_ready', 'sent', 'follow_up_1', 'follow_up_2',
  'replied', 'negotiating', 'form_submitted', 'referral_active',
  'closed_won', 'closed_lost', 'archived', 'delayed'
));

-- Add scout_reason column for AI-generated "why this brand" context
ALTER TABLE brand_deals ADD COLUMN IF NOT EXISTS scout_reason text;
