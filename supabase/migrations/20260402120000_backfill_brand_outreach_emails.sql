-- Backfill brand_outreach_emails with historical email records
-- derived from the seed deal statuses, dates, and relationship notes.

-- WHOOP: initial outreach 3/23, follow-up #1 on 4/2
INSERT INTO brand_outreach_emails (brand_deal_id, sent_at, email_type, direction, subject, summary)
SELECT id, '2026-03-23T10:00:00Z', 'initial', 'outbound',
  'Partnership Inquiry — Tyler Young (Fitness Creator)',
  'Initial outreach to partnerships@whoop.com. Highlighted long-term WHOOP membership since 2019, daily recovery/HRV usage, and Berlin Marathon training build.'
FROM brand_deals WHERE brand_name = 'WHOOP' LIMIT 1;

INSERT INTO brand_outreach_emails (brand_deal_id, sent_at, email_type, direction, subject, summary)
SELECT id, '2026-04-02T09:30:00Z', 'follow_up_1', 'outbound',
  'Re: Partnership Inquiry — Tyler Young',
  'Follow-up #1 to partnerships@whoop.com. Referenced continued HRV trend data from Berlin build and upcoming race content calendar.'
FROM brand_deals WHERE brand_name = 'WHOOP' LIMIT 1;

-- HYROX/Puma: initial outreach 3/31, auto-decline reply
INSERT INTO brand_outreach_emails (brand_deal_id, sent_at, email_type, direction, subject, summary)
SELECT id, '2026-03-31T11:00:00Z', 'initial', 'outbound',
  'HYROX Content Creator Partnership — Tyler Young',
  'Initial outreach to pna-sponsorships.usa@puma.com. Pitched HYROX competition content, Hyrox Wednesday series, and doubles partnership with brother.'
FROM brand_deals WHERE brand_name = 'HYROX/Puma' LIMIT 1;

INSERT INTO brand_outreach_emails (brand_deal_id, sent_at, email_type, direction, subject, summary)
SELECT id, '2026-03-31T11:05:00Z', 'response', 'inbound',
  'Auto: Thank you for your inquiry',
  'Generic auto-decline from pna-sponsorships.usa@puma.com. Not a real review — need to find alternate contact for HYROX/Puma partnerships.'
FROM brand_deals WHERE brand_name = 'HYROX/Puma' LIMIT 1;

-- Function Health: form submission 3/23
INSERT INTO brand_outreach_emails (brand_deal_id, sent_at, email_type, direction, subject, summary)
SELECT id, '2026-03-23T14:00:00Z', 'initial', 'outbound',
  'Creator Application Submitted',
  'Submitted Function Health creator application form on 3/23. Active member — monitoring only, do not re-pitch.'
FROM brand_deals WHERE brand_name = 'Function Health' LIMIT 1;

-- Janji: initial to cam@ (bounced), then mike@ on 3/24
INSERT INTO brand_outreach_emails (brand_deal_id, sent_at, email_type, direction, subject, summary)
SELECT id, '2026-03-24T09:00:00Z', 'initial', 'outbound',
  'Partnership Inquiry — Tyler Young (Running Creator)',
  'Initial outreach to cam@janji.com. Email bounced — address invalid.'
FROM brand_deals WHERE brand_name = 'Janji' LIMIT 1;

INSERT INTO brand_outreach_emails (brand_deal_id, sent_at, email_type, direction, subject, summary)
SELECT id, '2026-03-24T10:30:00Z', 'initial', 'outbound',
  'Partnership Inquiry — Tyler Young (Running Creator)',
  'Re-sent initial outreach to mike@janji.com after cam@ bounced. Pitched Berlin Marathon training content and travel-inspired running gear angle.'
FROM brand_deals WHERE brand_name = 'Janji' LIMIT 1;

-- ASRV: initial sent 4/1, CS auto-reply
INSERT INTO brand_outreach_emails (brand_deal_id, sent_at, email_type, direction, subject, summary)
SELECT id, '2026-04-01T10:00:00Z', 'initial', 'outbound',
  'Partnership Inquiry — Tyler Young (Fitness Creator)',
  'Initial outreach to support@asrv.com. Highlighted authentic ownership and regular wear of ASRV training gear in content.'
FROM brand_deals WHERE brand_name = 'ASRV' LIMIT 1;

INSERT INTO brand_outreach_emails (brand_deal_id, sent_at, email_type, direction, subject, summary)
SELECT id, '2026-04-01T10:02:00Z', 'response', 'inbound',
  'Re: Partnership Inquiry — Support Ticket Created',
  'Customer service auto-reply from support@asrv.com. Wrong department — need to find partnerships/marketing contact.'
FROM brand_deals WHERE brand_name = 'ASRV' LIMIT 1;

-- DexaFit: initial sent 4/2
INSERT INTO brand_outreach_emails (brand_deal_id, sent_at, email_type, direction, subject, summary)
SELECT id, '2026-04-02T08:00:00Z', 'initial', 'outbound',
  'Content Partnership — Tyler Young x DexaFit',
  'Initial outreach to hamza@dexafit.com. Pitched documenting Berlin Marathon build with DexaScan body composition and RMR testing series.'
FROM brand_deals WHERE brand_name = 'DexaFit' LIMIT 1;

-- LMNT: referral program started 3/25, product shipped 3/31
INSERT INTO brand_outreach_emails (brand_deal_id, sent_at, email_type, direction, subject, summary)
SELECT id, '2026-03-25T12:00:00Z', 'initial', 'outbound',
  'Referral Program Signup',
  'Signed up for LMNT referral/creator program. Active user for pre-run and long-run hydration.'
FROM brand_deals WHERE brand_name = 'LMNT' LIMIT 1;

INSERT INTO brand_outreach_emails (brand_deal_id, sent_at, email_type, direction, subject, summary)
SELECT id, '2026-03-31T15:00:00Z', 'response', 'inbound',
  'Your LMNT Product Shipment',
  'Product seeding shipment confirmed shipped 3/31. Referral program active — monitor performance before pitching formal partnership.'
FROM brand_deals WHERE brand_name = 'LMNT' LIMIT 1;
