import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

const SETUP_SQL = `
CREATE TABLE IF NOT EXISTS brand_deals (
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

CREATE TABLE IF NOT EXISTS brand_outreach_emails (
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

CREATE INDEX IF NOT EXISTS idx_brand_deals_user_status ON brand_deals(user_id, status);
CREATE INDEX IF NOT EXISTS idx_brand_outreach_emails_deal ON brand_outreach_emails(brand_deal_id);

ALTER TABLE brand_deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE brand_outreach_emails ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'brand_deals' AND policyname = 'Users can view own brand deals') THEN
    CREATE POLICY "Users can view own brand deals" ON brand_deals FOR SELECT USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'brand_deals' AND policyname = 'Users can insert own brand deals') THEN
    CREATE POLICY "Users can insert own brand deals" ON brand_deals FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'brand_deals' AND policyname = 'Users can update own brand deals') THEN
    CREATE POLICY "Users can update own brand deals" ON brand_deals FOR UPDATE USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'brand_deals' AND policyname = 'Users can delete own brand deals') THEN
    CREATE POLICY "Users can delete own brand deals" ON brand_deals FOR DELETE USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'brand_outreach_emails' AND policyname = 'Users can view own outreach emails') THEN
    CREATE POLICY "Users can view own outreach emails" ON brand_outreach_emails FOR SELECT USING (EXISTS (SELECT 1 FROM brand_deals WHERE brand_deals.id = brand_outreach_emails.brand_deal_id AND brand_deals.user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'brand_outreach_emails' AND policyname = 'Users can insert own outreach emails') THEN
    CREATE POLICY "Users can insert own outreach emails" ON brand_outreach_emails FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM brand_deals WHERE brand_deals.id = brand_outreach_emails.brand_deal_id AND brand_deals.user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'brand_deals' AND policyname = 'Service role full access brand_deals') THEN
    CREATE POLICY "Service role full access brand_deals" ON brand_deals FOR ALL USING (auth.role() = 'service_role');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'brand_outreach_emails' AND policyname = 'Service role full access brand_outreach_emails') THEN
    CREATE POLICY "Service role full access brand_outreach_emails" ON brand_outreach_emails FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;
`;

export async function POST() {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const supabase = createAdminClient();
  const { error } = await supabase.rpc("exec_sql", { sql: SETUP_SQL });

  if (error) {
    // If rpc doesn't exist, try direct table check
    const { error: checkError } = await supabase.from("brand_deals").select("id").limit(1);
    if (checkError?.message?.includes("not find the table")) {
      return NextResponse.json(
        {
          error: "Migration required",
          message: "The brand_deals table does not exist. Run the migration in supabase/migrations/20260402000000_brand_outreach_pipeline.sql via the Supabase SQL Editor or `supabase db push`.",
          migration_file: "supabase/migrations/20260402000000_brand_outreach_pipeline.sql",
        },
        { status: 503 },
      );
    }
    // Table exists — rpc just failed
    return NextResponse.json({ ok: true, message: "Tables already exist" });
  }

  return NextResponse.json({ ok: true, message: "Brand pipeline tables created successfully" });
}
