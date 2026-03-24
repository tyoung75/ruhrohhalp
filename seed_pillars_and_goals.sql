-- Seed Tyler's Life Pillars and Goals
-- Run this AFTER 005_goals_and_pillars.sql migration
-- Replace USER_ID with Tyler's actual auth.users UUID

-- To find your user ID:
--   select id from auth.users where email = 'tylerjyoung5@gmail.com';

-- ============================================================================
-- STEP 1: Insert Pillars
-- ============================================================================

do $$
declare
  uid uuid;
  p_fitness uuid;
  p_career uuid;
  p_ventures uuid;
  p_financial uuid;
  p_relationship uuid;
  p_health uuid;
  p_content uuid;
  p_travel uuid;
  p_growth uuid;
  p_community uuid;
begin
  -- Get Tyler's user ID
  select id into uid from auth.users where email = 'tylerjyoung5@gmail.com';
  if uid is null then
    raise exception 'User not found. Update the email address above.';
  end if;

  -- -------------------------------------------------------------------------
  -- PILLARS
  -- -------------------------------------------------------------------------

  insert into public.pillars (id, user_id, name, emoji, description, sort_order) values
    (gen_random_uuid(), uid, 'Fitness & Athletics', '🏃', 'Hybrid athlete identity — marathon running, strength training, HYROX, and the TYBRID program. The physical foundation everything else is built on.', 1)
    returning id into p_fitness;

  insert into public.pillars (id, user_id, name, emoji, description, sort_order) values
    (gen_random_uuid(), uid, 'Career & Instacart', '💼', 'Director-level leadership at Instacart F&I. Strategic influence, executive presence, and career trajectory toward VP/C-suite.', 2)
    returning id into p_career;

  insert into public.pillars (id, user_id, name, emoji, description, sort_order) values
    (gen_random_uuid(), uid, 'Ventures & BDHE', '🚀', 'BearDuckHornEmpire LLC portfolio: Motus, Iron Passport, ruhrohhalp, thestayed, bearduckhornempire.com. Building in public.', 3)
    returning id into p_ventures;

  insert into public.pillars (id, user_id, name, emoji, description, sort_order) values
    (gen_random_uuid(), uid, 'Financial', '📊', 'Investment portfolio management, BDHE revenue growth, tax optimization, and long-term wealth accumulation strategy.', 4)
    returning id into p_financial;

  insert into public.pillars (id, user_id, name, emoji, description, sort_order) values
    (gen_random_uuid(), uid, 'Relationship & Family', '❤️', 'Marriage with Clarissa, Wesley, brother partnership (HYROX doubles), and maintaining deep connections while operating at high output.', 5)
    returning id into p_relationship;

  insert into public.pillars (id, user_id, name, emoji, description, sort_order) values
    (gen_random_uuid(), uid, 'Health & Recovery', '🧠', 'Sleep optimization, stress management, nutrition, Whoop/Garmin data-driven recovery, and mental health maintenance.', 6)
    returning id into p_health;

  insert into public.pillars (id, user_id, name, emoji, description, sort_order) values
    (gen_random_uuid(), uid, 'Content & Brand', '📱', 'Personal brand across TikTok, Instagram, Threads, BDHE blog. Brand partnerships pipeline. Voice consistency and audience growth.', 7)
    returning id into p_content;

  insert into public.pillars (id, user_id, name, emoji, description, sort_order) values
    (gen_random_uuid(), uid, 'Travel & Experiences', '✈️', 'Train-first travel philosophy. Iron Passport pillar. Upcoming: Hyderabad, Copenhagen, Berlin, Sicily. Gym hunting globally.', 8)
    returning id into p_travel;

  insert into public.pillars (id, user_id, name, emoji, description, sort_order) values
    (gen_random_uuid(), uid, 'Personal Growth', '📚', 'Learning, reading, skill acquisition, and identity evolution. The meta-layer — becoming the person who accomplishes the other pillars.', 9)
    returning id into p_growth;

  insert into public.pillars (id, user_id, name, emoji, description, sort_order) values
    (gen_random_uuid(), uid, 'Community & Impact', '🤝', 'Giving back through content, mentorship, open-source contributions, and building tools others can use.', 10)
    returning id into p_community;

  -- -------------------------------------------------------------------------
  -- GOALS: Fitness & Athletics
  -- -------------------------------------------------------------------------

  insert into public.goals (user_id, pillar_id, title, description, target_date, priority, progress_metric, progress_current, progress_target, methods, tags) values
    (uid, p_fitness, 'Berlin Marathon sub-3:10', 'Qualify for and race Berlin Marathon in September 2026 with a sub-3:10 finish. 13 minutes off current PR. Requires block periodization: base → threshold → race-specific → taper.', '2026-09-27', 'critical', 'marathon_time', '3:23:02', '3:09:59', ARRAY['Block periodization (base/threshold/race-specific/taper)', 'Lactate threshold training at MP+10-20s/km', 'Peak volume 55-60 mi/week in block 3', 'Daniels'' VDOT-based pace zones'], ARRAY['running', 'marathon', 'berlin']),

    (uid, p_fitness, 'Maintain 450+ deadlift during marathon block', 'Preserve max strength while running 40-55 mi/week. Research shows concurrent training interference is manageable with session separation and RE sequencing.', '2026-09-27', 'high', 'deadlift_1rm', '455 lbs', '450+ lbs', ARRAY['Session separation: 6+ hours between strength and endurance', 'Resistance before endurance on same-day sessions', '2x/week full-body, compound-focused, low volume', 'Deload strength during peak running volume blocks'], ARRAY['strength', 'concurrent_training']),

    (uid, p_fitness, 'HYROX Doubles PR with brother', 'Compete in next HYROX Doubles event and PR. Combines running economy with functional fitness stations. Train Wednesdays.', null, 'medium', 'hyrox_time', null, null, ARRAY['Wednesday HYROX-specific training sessions', 'Station-specific conditioning (sled, wall balls, burpees)', 'Partner pacing strategy and transition drills'], ARRAY['hyrox', 'competition']),

    (uid, p_fitness, 'VO2 max to 58+', 'Improve aerobic ceiling from 53.8 to 58+ through structured Zone 2 base and VO2max interval work. Critical for marathon pace sustainability.', '2026-09-01', 'high', 'vo2_max', '53.8', '58.0', ARRAY['80/20 polarized training (80% Zone 2, 20% high intensity)', '4-6 min VO2max intervals at 95-100% HRmax', 'Zone 2 long runs with nasal breathing emphasis', 'Whoop HRV tracking for readiness-based intensity'], ARRAY['aerobic', 'vo2max']);

  -- -------------------------------------------------------------------------
  -- GOALS: Career & Instacart
  -- -------------------------------------------------------------------------

  insert into public.goals (user_id, pillar_id, title, description, target_date, priority, progress_metric, progress_current, progress_target, methods, tags) values
    (uid, p_career, 'Establish executive presence at Director level', 'Build gravitas and strategic influence at Instacart F&I. Lead with strategic questions, not directives. Make the VP''s job easier.', null, 'high', 'qualitative', 'Director', 'Strong Director → VP trajectory', ARRAY['INSEAD Executive Presence Framework: clear communication of complex ideas', 'Strategic questioning: lead with "why or why not?" vs. directives', 'Make boss''s job easier: sounding board + take overflow proactively', 'Weekly 1-on-1 agenda: one strategic insight, one ask, one offer'], ARRAY['career', 'leadership', 'instacart']),

    (uid, p_career, 'Hyderabad trip: maximize training impact', 'May 17-22 India trip for Instacart training. Establish strong cross-geo relationships and position as the go-to leader for F&I initiatives.', '2026-05-22', 'medium', 'qualitative', 'Planned', 'Completed with clear follow-ups', ARRAY['Pre-trip: identify 3 key stakeholders to build relationships with', 'Prepare one deliverable/framework that demonstrates strategic thinking', 'Post-trip: follow up within 48 hours with personalized notes'], ARRAY['career', 'travel', 'instacart']);

  -- -------------------------------------------------------------------------
  -- GOALS: Ventures & BDHE
  -- -------------------------------------------------------------------------

  insert into public.goals (user_id, pillar_id, title, description, target_date, priority, progress_metric, progress_current, progress_target, methods, tags) values
    (uid, p_ventures, 'Motus: 400 paying subscribers', 'Launch Motus on App Store and grow to 400 paying users ($24.99/mo = ~$10K MRR). Use personal brand as distribution. Content-led growth, not paid ads.', '2026-12-31', 'critical', 'mrr_dollars', '$0', '$10,000', ARRAY['Price-as-filter: $24.99 from day one, no free tier', 'Content funnel: TikTok/IG training content → Motus CTA', 'Referral program: 1 month free for each referral', 'Weekly iteration cycles: ship features users ask for'], ARRAY['motus', 'saas', 'revenue']),

    (uid, p_ventures, 'Iron Passport MVP launch', 'Ship Iron Passport as a Next.js web app. Gym finder for travelers. SEO-first strategy to capture "gym near me in [city]" searches.', '2026-06-30', 'high', 'qualitative', 'In development', 'Live with 50+ gyms indexed', ARRAY['SEO-first: city-specific landing pages with gym reviews', 'Community contributions: let gym-goers submit ratings', 'Travel content cross-pollination: every trip = content + gym reviews'], ARRAY['iron_passport', 'launch']),

    (uid, p_ventures, 'ruhrohhalp: full Life OS functionality', 'Transform ruhrohhalp from task board into adaptive life operating system. Goal tracking, signal ingestion, briefings against goals, and continuous learning.', '2026-06-30', 'critical', 'qualitative', 'Phase 4 shipped', 'Phase 7 (adaptive signals)', ARRAY['Phase 5: Goals and pillars architecture', 'Phase 6: Goals UI and briefing restructuring', 'Phase 7: Signal ingestion (Gmail, Calendar, social, purchases)', 'Weekly self-evaluation: is this briefing actually changing my behavior?'], ARRAY['ruhrohhalp', 'life_os']),

    (uid, p_ventures, 'thestayed: define and validate concept', 'Clarify what thestayed (fka RNTLX) is, validate the idea with potential users, and decide tech stack.', null, 'low', 'qualitative', 'Concept only', 'Validated with 10 user conversations', ARRAY['Lean Startup validation: 10 problem interviews before building', 'Landing page test: measure email signup conversion', 'Decision deadline: commit or park by end of Q3 2026'], ARRAY['thestayed', 'validation']);

  -- -------------------------------------------------------------------------
  -- GOALS: Financial
  -- -------------------------------------------------------------------------

  insert into public.goals (user_id, pillar_id, title, description, target_date, priority, progress_metric, progress_current, progress_target, methods, tags) values
    (uid, p_financial, 'Portfolio to $500K', 'Grow combined investment portfolio from ~$392K to $500K through contributions + returns. Maintain tech/growth tilt but reduce concentration risk.', '2026-12-31', 'high', 'portfolio_value', '$392,000', '$500,000', ARRAY['Factor investing: tilt toward quality + momentum factors', 'Reduce single-stock concentration (CART >30% of portfolio)', 'Max Roth IRA contributions ($7,000/year)', 'Tax-loss harvesting in taxable accounts quarterly'], ARRAY['investing', 'portfolio']),

    (uid, p_financial, 'BDHE revenue $10K/month', 'Combined revenue from Motus MRR + brand deals + affiliate income to reach $10K/month.', '2026-12-31', 'critical', 'monthly_revenue', '$0', '$10,000', ARRAY['Motus subscriptions as primary revenue engine', 'Brand partnership pipeline: 2 new outreach emails/week', 'Affiliate strategy: Whoop, Function Health referral programs', 'Revenue tracking in ruhrohhalp command center'], ARRAY['revenue', 'bdhe']);

  -- -------------------------------------------------------------------------
  -- GOALS: Relationship & Family
  -- -------------------------------------------------------------------------

  insert into public.goals (user_id, pillar_id, title, description, target_date, priority, progress_metric, progress_current, progress_target, methods, tags) values
    (uid, p_relationship, 'Protected quality time with Clarissa', 'Maintain a strong marriage while running 6+ ventures and training. Block non-negotiable time. Hit Gottman''s 5:1 positive interaction ratio.', null, 'critical', 'qualitative', 'Active', 'Weekly date night + daily check-in ritual', ARRAY['Gottman 5:1 ratio: 5 positive interactions per negative one', 'Non-negotiable weekly date night (calendar-blocked, no devices)', 'Daily 10-minute check-in: not logistics, but how are you', 'Sound Relationship House: trust, manage conflict, create shared meaning'], ARRAY['marriage', 'clarissa']),

    (uid, p_relationship, 'Brother partnership: races + ventures', 'Deepen partnership with brother through HYROX Doubles training and potential BDHE collaboration.', null, 'medium', 'qualitative', 'Active', 'One race together per quarter', ARRAY['Shared training schedule for HYROX events', 'Monthly call to discuss venture ideas and life', 'At least one race together per quarter'], ARRAY['family', 'brother']);

  -- -------------------------------------------------------------------------
  -- GOALS: Health & Recovery
  -- -------------------------------------------------------------------------

  insert into public.goals (user_id, pillar_id, title, description, target_date, priority, progress_metric, progress_current, progress_target, methods, tags) values
    (uid, p_health, 'Sleep 7.5+ hours consistently', 'Optimize sleep as the single highest-leverage recovery tool. Target 7.5-8 hours nightly with Whoop sleep score > 85%.', null, 'critical', 'avg_sleep_hours', null, '7.5+', ARRAY['Matthew Walker protocol: fixed wake time even on weekends', 'No screens 60 min before bed; dim lighting after 9pm', 'Room temp 65-68°F; blackout curtains', 'Whoop sleep coach alerts for consistency tracking'], ARRAY['sleep', 'recovery']),

    (uid, p_health, 'Nutrition supporting concurrent training', 'Fuel both marathon training and strength maintenance. ~3,000-3,500 cal/day with periodized carb intake around key sessions.', null, 'high', 'qualitative', 'Active', 'Dialed macro plan with race-week protocol', ARRAY['Periodized carb intake: high on long run / heavy lift days', 'Protein target: 1g per lb bodyweight daily', 'Pre-race carb loading protocol: 700g carbs/day for 3 days (proven at Austin)', 'Hydration: 5,000mg sodium on race day (proven at Austin)'], ARRAY['nutrition', 'fuel']),

    (uid, p_health, 'Stress management and mental health', 'Prevent burnout while operating across career + ventures + training + content. Proactive, not reactive.', null, 'high', 'qualitative', 'Active', 'Whoop strain < 18 on recovery days', ARRAY['Whoop strain monitoring: respect red recovery days', 'BJ Fogg Tiny Habits: 2-minute morning mindfulness after coffee', 'Weekly review ritual: what drained me vs. what energized me', 'Permission to park ventures (thestayed) when bandwidth is low'], ARRAY['mental_health', 'burnout']);

  -- -------------------------------------------------------------------------
  -- GOALS: Content & Brand
  -- -------------------------------------------------------------------------

  insert into public.goals (user_id, pillar_id, title, description, target_date, priority, progress_metric, progress_current, progress_target, methods, tags) values
    (uid, p_content, 'Consistent posting cadence across platforms', 'TikTok 3x/week, Instagram 2x/week, Threads daily, BDHE blog weekly. Content batching on Sundays.', null, 'high', 'posts_per_week', null, '8+', ARRAY['Content batching: Sunday 2-hour session for the week', 'Content pillars as guardrails: Hybrid Athlete, Builder, NYC, Travel', 'Repurpose: one long-form → TikTok clip + IG carousel + Thread', 'content-autodraft skill for AI-assisted draft generation'], ARRAY['content', 'consistency']),

    (uid, p_content, 'Close 3 brand partnerships by Q4', 'Convert brand outreach pipeline into paying partnerships. Target: BPN, WHOOP, Janji, Tracksmith, Function Health.', '2026-10-31', 'high', 'deals_closed', '0', '3', ARRAY['Alignment-first outreach: only pitch brands Tyler actually uses', '2 new outreach emails per week via brand-outreach-cowork skill', 'Multi-year deal negotiation when possible for compounding value', 'Use specific data (455lb DL, 3:23 marathon, VO2 53.8) as proof points'], ARRAY['brand_deals', 'partnerships']),

    (uid, p_content, 'Berlin Marathon as content narrative arc', 'Use the 6-month Berlin training block as a serialized content narrative. Document the journey, not just the result.', '2026-09-27', 'medium', 'qualitative', 'Pre-training', 'Race day content published', ARRAY['Weekly training update posts with real numbers', 'Behind-the-scenes: nutrition, gear, concurrent training balance', 'Race week buildup content (carb loading, travel, nerves)', 'Race recap as cornerstone content piece'], ARRAY['berlin', 'narrative', 'running']);

  -- -------------------------------------------------------------------------
  -- GOALS: Travel & Experiences
  -- -------------------------------------------------------------------------

  insert into public.goals (user_id, pillar_id, title, description, target_date, priority, progress_metric, progress_current, progress_target, methods, tags) values
    (uid, p_travel, 'Copenhagen → Berlin → Sicily arc', 'September-October travel block combining Berlin Marathon, Copenhagen culture, and Sicily wind-down. Train on every leg.', '2026-10-15', 'medium', 'qualitative', 'Planning', 'Completed with content from each stop', ARRAY['Iron Passport gym research for each city pre-trip', 'Content calendar aligned to travel dates', 'Train logistics booked (trains > flights where possible)', 'Local restaurant research: one standout meal per city'], ARRAY['europe', 'travel_arc']),

    (uid, p_travel, 'Iron Passport gym reviews from every trip', 'Every trip Tyler takes should produce at least one gym review for Iron Passport. Turns travel into product content.', null, 'medium', 'gym_reviews', '0', '10+ by year end', ARRAY['Photograph and rate every gym visited while traveling', 'Template: location, equipment, vibe, day pass price, train access', 'Cross-post review to IG Stories + Iron Passport database'], ARRAY['iron_passport', 'content']);

  -- -------------------------------------------------------------------------
  -- GOALS: Personal Growth
  -- -------------------------------------------------------------------------

  insert into public.goals (user_id, pillar_id, title, description, target_date, priority, progress_metric, progress_current, progress_target, methods, tags) values
    (uid, p_growth, 'Build durable daily systems', 'Create a morning and evening operating rhythm that compounds. Not motivation-dependent — environment and system-dependent.', null, 'high', 'qualitative', 'Partial systems', 'Full AM/PM ritual with >90% adherence', ARRAY['BJ Fogg Tiny Habits: anchor new habits to existing ones', 'James Clear identity-based habits: "I am someone who..."', 'Implementation intentions: "After [X], I will [Y]"', 'Morning: wake → coffee → 2-min journal → review ruhrohhalp brief → train', 'Evening: review day → update brain doc → prep tomorrow → wind down'], ARRAY['habits', 'systems']),

    (uid, p_growth, 'Continuous learning loop', 'Both ruhrohhalp and Claude should learn from Tyler''s daily signals and adapt recommendations. The system should get smarter, not just louder.', null, 'high', 'qualitative', 'Manual', 'Automated signal ingestion', ARRAY['Signal mapping: email/calendar/social → goal progress', 'Weekly pattern synthesis: what moved, what stalled, what changed', 'Brain document updated by both Tyler and AI regularly', 'Quarterly pillar review: reprioritize based on life changes'], ARRAY['learning', 'adaptive']);

  -- -------------------------------------------------------------------------
  -- GOALS: Community & Impact
  -- -------------------------------------------------------------------------

  insert into public.goals (user_id, pillar_id, title, description, target_date, priority, progress_metric, progress_current, progress_target, methods, tags) values
    (uid, p_community, 'Open-source TYBRID methodology', 'Document and share the TYBRID training program so other hybrid athletes can use it. Positions Tyler as a thought leader.', null, 'low', 'qualitative', 'Internal only', 'Published methodology with community', ARRAY['Write TYBRID methodology doc (double progression + Zone 2)', 'Publish as BDHE blog series or Motus free resource', 'Gather community feedback to refine the program'], ARRAY['tybrid', 'open_source']),

    (uid, p_community, 'Help 5 people ship their first app', 'Use the "builder in public" platform to mentor aspiring builders. One of the most meaningful things Tyler can do with the audience.', null, 'low', 'people_helped', '0', '5', ARRAY['DM engagement: respond to builders who reach out', 'Monthly "office hours" thread on Threads or IG Live', 'Share real technical decisions (not just wins) in content'], ARRAY['mentorship', 'community']);

end $$;
