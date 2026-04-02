-- Brand Outreach Pipeline
-- Tables for managing brand partnership deals and email history

CREATE TABLE brand_deals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  brand_name text NOT NULL,
  contact_email text,
  contact_name text,
  contact_confidence text CHECK (contact_confidence IN ('high', 'medium', 'low')),
  status text NOT NULL DEFAULT 'prospect' CHECK (status IN (
    'prospect', 'draft_ready', 'sent', 'follow_up_1', 'follow_up_2',
    'replied', 'negotiating', 'form_submitted', 'referral_active',
    'closed_won', 'closed_lost', 'archived'
  )),
  priority text CHECK (priority IN ('P0', 'P1', 'P2')),
  relationship_type text CHECK (relationship_type IN ('long_term', 'active_user', 'new', 'regular_buyer', 'competitor')),
  relationship_notes text,
  product_usage text,
  angle text,
  dont_say text[] DEFAULT '{}',
  first_contact_date timestamptz,
  last_contact_date timestamptz,
  last_reply_date timestamptz,
  follow_up_count int NOT NULL DEFAULT 0,
  next_action text,
  next_action_date date,
  estimated_value_low int,
  estimated_value_high int,
  actual_value int,
  deal_type text CHECK (deal_type IN ('one_time', 'monthly', 'affiliate', 'product_seeding', 'ambassador')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  archive_reason text
);

CREATE TABLE brand_outreach_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_deal_id uuid NOT NULL REFERENCES brand_deals(id) ON DELETE CASCADE,
  sent_at timestamptz NOT NULL,
  email_type text NOT NULL CHECK (email_type IN ('initial', 'follow_up_1', 'follow_up_2', 'response', 'negotiation')),
  subject text,
  gmail_thread_id text,
  gmail_message_id text,
  gmail_draft_id text,
  direction text NOT NULL CHECK (direction IN ('outbound', 'inbound')),
  summary text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_brand_deals_user_status ON brand_deals(user_id, status);
CREATE INDEX idx_brand_outreach_emails_deal ON brand_outreach_emails(brand_deal_id);

ALTER TABLE brand_deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE brand_outreach_emails ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own brand deals" ON brand_deals
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own brand deals" ON brand_deals
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own brand deals" ON brand_deals
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own brand deals" ON brand_deals
  FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can view own outreach emails" ON brand_outreach_emails
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM brand_deals WHERE brand_deals.id = brand_outreach_emails.brand_deal_id AND brand_deals.user_id = auth.uid())
  );
CREATE POLICY "Users can insert own outreach emails" ON brand_outreach_emails
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM brand_deals WHERE brand_deals.id = brand_outreach_emails.brand_deal_id AND brand_deals.user_id = auth.uid())
  );

CREATE POLICY "Service role full access brand_deals" ON brand_deals
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access brand_outreach_emails" ON brand_outreach_emails
  FOR ALL USING (auth.role() = 'service_role');

INSERT INTO brand_deals (user_id, brand_name, contact_email, contact_name, contact_confidence, status, priority, relationship_type, relationship_notes, product_usage, angle, dont_say, first_contact_date, last_contact_date, follow_up_count, next_action, next_action_date, estimated_value_low, estimated_value_high, deal_type)
VALUES
  ('e3657b64-9c95-4d9a-ad12-304cf8e2f21e', 'WHOOP', 'partnerships@whoop.com', NULL, 'medium', 'follow_up_1', 'P0', 'long_term',
   'Long-term member since 2019. Uses for recovery score + HRV trend tracking.',
   'Daily recovery score checks, HRV trend analysis, strain tracking for training decisions',
   'Real data-driven training decisions, Berlin Marathon build',
   ARRAY['WHOOP is the first thing I check every morning before deciding whether to push or pull back'],
   '2026-03-23', '2026-04-02', 1,
   'Wait for reply to follow-up #1', '2026-04-12',
   600, 2000, 'ambassador'),
  ('e3657b64-9c95-4d9a-ad12-304cf8e2f21e', 'Tracksmith', 'community@tracksmith.com', NULL, 'medium', 'draft_ready', 'P1', 'new',
   'Friend recommended. Bought gear at Austin Marathon expo. Likes feel/fit, lightweight, durable. Merino wool incredible for winter.',
   'Running gear from Austin expo purchase, merino wool base layers for winter training',
   'New but genuinely impressed, Berlin training, New England summer',
   ARRAY['The only running gear I''d wear to Foreigner Coffee'],
   NULL, NULL, 0,
   'Review and send initial outreach draft', '2026-04-03',
   400, 1200, 'ambassador'),
  ('e3657b64-9c95-4d9a-ad12-304cf8e2f21e', 'LMNT', 'hello@drinklmnt.com', NULL, 'medium', 'referral_active', 'P2', 'active_user',
   'Active user. Uses for hydration before/during long runs. Currently in referral program (not formal partnership). Product shipped 3/31.',
   'Pre-run and during-run hydration, long run electrolytes',
   'Referral program active, potential upgrade to formal partnership later',
   '{}',
   '2026-03-25', '2026-03-31', 0,
   'Monitor referral performance, pitch formal partnership at 5K followers', NULL,
   200, 600, 'affiliate'),
  ('e3657b64-9c95-4d9a-ad12-304cf8e2f21e', 'HYROX/Puma', 'pna-sponsorships.usa@puma.com', NULL, 'low', 'sent', 'P1', 'competitor',
   'Active HYROX competitor. HYROX Doubles with brother. Hyrox Wednesday is recurring content.',
   'Regular HYROX competitor, weekly Hyrox Wednesday training content',
   'HYROX competition content, brother doubles partnership, weekly training series',
   ARRAY['Do not imply deeper Puma product relationship'],
   '2026-03-31', '2026-03-31', 0,
   'Find alternate contact — pna-sponsorships auto-declined (generic)', '2026-04-05',
   500, 2000, 'ambassador'),
  ('e3657b64-9c95-4d9a-ad12-304cf8e2f21e', 'David Protein', 'contact@davidprotein.com', NULL, 'low', 'prospect', 'P2', 'regular_buyer',
   'Regular buyer, on email list, actual customer. Genuine use.',
   'Regular protein bar/product purchases, genuine daily use',
   'Authentic customer who became a creator, not a creator pitching a product',
   '{}',
   NULL, NULL, 0,
   'Draft initial outreach', '2026-04-05',
   300, 800, 'ambassador'),
  ('e3657b64-9c95-4d9a-ad12-304cf8e2f21e', 'Function Health', 'partnerships@functionhealth.com', NULL, 'medium', 'form_submitted', 'P1', 'active_user',
   'Member. Submitted creator form 3/23/2026. MONITOR ONLY — do not re-pitch.',
   'Active Function Health member, uses for comprehensive blood work and health monitoring',
   'Creator form submitted — wait for their response',
   '{}',
   '2026-03-23', '2026-03-23', 0,
   'Monitor only — do not re-pitch', NULL,
   500, 1500, 'ambassador'),
  ('e3657b64-9c95-4d9a-ad12-304cf8e2f21e', 'Janji', 'mike@janji.com', 'Cam / Mike', 'medium', 'sent', 'P2', 'new',
   'Sent to cam@janji.com (bounced) and mike@janji.com. No authentic connection yet — may need to re-evaluate.',
   'Running gear brand, limited personal usage so far',
   'Travel-inspired running gear, Berlin Marathon training',
   '{}',
   '2026-03-24', '2026-03-24', 0,
   'Follow-up due 4/3', '2026-04-03',
   300, 800, 'product_seeding'),
  ('e3657b64-9c95-4d9a-ad12-304cf8e2f21e', 'ASRV', 'support@asrv.com', NULL, 'low', 'sent', 'P1', 'active_user',
   'Tyler owns and wears ASRV. Sent to support@asrv.com which is wrong (customer service auto-reply).',
   'Owns and regularly wears ASRV training gear',
   'Authentic user and wearer, training content featuring ASRV gear',
   '{}',
   '2026-04-01', '2026-04-01', 0,
   'Find partnerships email — support@ is wrong (CS auto-reply)', '2026-04-05',
   400, 1200, 'ambassador'),
  ('e3657b64-9c95-4d9a-ad12-304cf8e2f21e', 'DexaFit', 'hamza@dexafit.com', 'Hamza', 'high', 'sent', 'P1', 'active_user',
   'Booked client. Documenting Berlin Marathon build via DexaScan + RMR.',
   'DexaScan body composition and RMR testing for Berlin Marathon training documentation',
   'Documenting Berlin Marathon build with objective body composition data',
   '{}',
   '2026-04-02', '2026-04-02', 0,
   'Wait for reply', '2026-04-12',
   200, 600, 'product_seeding'),
  ('e3657b64-9c95-4d9a-ad12-304cf8e2f21e', 'BPN', NULL, NULL, NULL, 'archived', NULL, NULL,
   'Contacted months ago, not interested.', NULL, NULL, '{}',
   NULL, NULL, 0, NULL, NULL, NULL, NULL, NULL),
  ('e3657b64-9c95-4d9a-ad12-304cf8e2f21e', 'Notion', NULL, NULL, NULL, 'archived', NULL, NULL,
   'Tyler doesn''t use the product enough for an authentic pitch.', NULL, NULL, '{}',
   NULL, NULL, 0, NULL, NULL, NULL, NULL, NULL);

UPDATE brand_deals SET archived_at = now(), archive_reason = relationship_notes WHERE status = 'archived';
