# TylerOS — Daily Operating Playbook

This is your complete guide to running your life and content operation through TylerOS. The system is designed to work autonomously in the background while giving you maximum leverage at every touchpoint.

---

## The 5-Minute Morning Routine (6:00–6:05 AM)

Your daily briefing auto-generates at 6 AM ET. Here's your flow:

**Open Command Center (shortcut: 1)** → Read today's briefing. It covers your highest-leverage tasks, pending decisions, upcoming calendar events, and cross-venture insights. This is your "what matters today" in 30 seconds.

**Switch to Creator tab (shortcut: 5) → Strategy sub-tab** → Check "Today's Focus" at the top. The strategy agent has already picked 3 recommendations tailored to today — the topic, the platform, the format, and why. If any of them resonate, hit "Generate This" to create a targeted post immediately.

**Scan the Queue sub-tab** → See what's already queued and scheduled. Posts auto-publish at their scheduled times throughout the day. If something doesn't feel right, edit or delete it before it goes live. The scoring algorithm has already ranked them, but you have final say.

That's it. 5 minutes and your day is set up.

---

## Content Creation — How to Use the Creator Tab

### Automated Daily Generation (Hands-Off)

The system generates a batch of 5 posts every day at 6 AM via cron. Each batch pulls from 10 different data sources (your Strava training, active goals, recent posts, voice references, feedback history, strategy insights, etc.) to create contextual, on-brand content. Posts are safety-audited by a separate AI model, scored across 8 factors, and queued at optimal times.

You don't need to do anything for this to happen. It runs every day.

### On-Demand Generation (When Inspiration Hits)

Two ways to trigger manual generation:

**Strategy → "Generate This" button**: Click this on any recommendation card. The system generates exactly 1 post pre-seeded with that specific topic, platform, and format. This is the highest-quality generation path because it combines strategy intelligence with the full content agent.

**Queue → "Generate" button**: Triggers a full 5-post batch on demand. Use this when you want a fresh batch outside the daily cron.

### Reviewing & Editing Posts

Queue tab shows every post with its confidence score, brand voice score, and timeliness score. Posts are color-coded: high confidence shows green, lower confidence shows amber. Every post has the agent's reasoning visible — why it wrote what it wrote.

Click any post to expand it, edit the text directly, or change the scheduled time. The system respects your edits and doesn't overwrite them.

### The Feedback Loop (This Is Critical)

Go to the **History sub-tab** after posts have been published. This is where you train the AI:

**Thumbs Up ("More like this")**: Tell the agent this post nailed it. Add an optional note about what specifically you liked — the tone, the topic, the format. The agent weights this at importance 6 and leans into the pattern.

**Thumbs Down ("Less like this")**: Tell the agent this missed the mark. The optional note is important here — "too salesy," "wrong tone," "not my vibe." Importance 8 — the agent actively avoids this pattern going forward.

**"I Deleted This"**: The strongest negative signal. When you delete a post from your actual social account, come here and mark it. A red prompt asks you why. This gets embedded at importance 8 with a [DELETED POST] prefix that the agent treats as a hard constraint.

**Directives (via Strategy tab)**: Use the "Talk to Your Strategy Agent" panel at the bottom of the Strategy tab to submit standing rules. These are importance 9 — the highest weight. Examples: "Never post engagement bait," "Always include a specific data point from my training when talking about running," "No generic motivational quotes." These persist permanently and shape every future generation.

The more feedback you give, the faster the AI converges on your authentic voice. Aim for at least 2–3 feedback actions per day on recent posts.

---

## Weekly Strategy Review (Monday Mornings)

Every Monday at 6 AM, three things happen automatically:

1. The **Strategy Agent** runs trend detection across your analytics, identifies what's working and what isn't, and generates fresh recommendations for the week.

2. The **Weekly CEO Synthesis** generates a comprehensive brief covering all ventures, not just content — project progress, top blockers, content strategy, patterns noticed, and suggested priorities.

3. The **Strategy tab updates** with this week's game plan, pillar coverage gaps, best posting times, and trend radar.

Your Monday flow: Read the weekly briefing (Command Center → Briefing), then review the Strategy tab for content recommendations. Submit any new directives based on what you've learned from last week. The system takes it from there.

---

## Brand Pillar Awareness

The system enforces 5 brand pillars with target percentages. Check the "Brand Pillar Coverage" section on the Strategy tab weekly to make sure you're not over-indexing on one area:

- **Running & Endurance** (35–40%): This is your core. Ultra training, race recaps, gear reviews, running philosophy.
- **Building in Public** (20–25%): Motus development, BDHE updates, startup lessons, creator journey.
- **NYC Lifestyle** (10–15%): City runs, restaurants, the NYC grind aesthetic.
- **Fitness & Strength** (10–15%): Gym work, recovery, the complete athlete angle.
- **Travel & Adventure** (5–10%): Race trips, exploration, new places.

If you notice a pillar lagging, submit a directive: "Increase Building in Public content this week — I shipped a big Motus feature."

---

## Voice Learning — Make the AI Sound Like You

The system learns your voice from two sources:

**Your manual posts**: Every time you post directly on TikTok, Instagram, or Threads (not through the system), the external sync job picks it up, stores it, and embeds it into semantic memory tagged as a voice reference. The content agent uses these as "ground truth" — your manual posts outrank the system's own voice rules.

**Your feedback**: Likes and dislikes on History tab shape voice direction. Directives like "write more casually" or "use shorter sentences" directly modify the prompt context.

Pro tip: The more you post manually, the better the AI gets. Even 2–3 manual posts per week gives the system strong signal to calibrate against.

---

## Platform-Specific Notes

**Threads**: Full automation — generates, queues, publishes, collects analytics. This is the most mature pipeline.

**Instagram**: Full publish support (single posts, carousels, reels). Follower tracking active. Strategy agent includes it in recommendations.

**TikTok**: Follower tracking active. Publishing is stubbed pending TikTok developer app approval. For now, the system recommends TikTok content but you post manually. The system then syncs your manual post for voice learning.

**YouTube**: Follower + video tracking active via API key. Strategy agent includes YouTube Shorts and long-form recommendations. Publishing requires OAuth (not yet set up). The agent recommends YouTube as a growth priority — repurpose TikTok content as Shorts.

---

## Brain & Knowledge — Your Second Memory

The Brain (shortcut: 3) is your semantic search across everything — every email processed, every meeting note, every voice memo, every decision logged. Use it when you need to recall something specific or connect dots across ventures.

The Knowledge tab (shortcut: 4) is the structured version — 7 tables you can browse, search, and edit. This is where the system stores organized facts about your projects, people, decisions, and ideas.

Both surfaces are fed by the ingestion layer (Gmail, Calendar, Linear, Voice, Strava, Manual Capture). Everything writes directly to Supabase — the embedding pipeline handles categorization automatically.

---

## Goal Tracking

Goals live under Pillars on the Command Center. Each goal has progress tracking, check-ins, and automatic signals from integrations (Strava workouts create fitness signals, Linear issues create project signals).

Check in on goals weekly. The system surfaces goal-related insights in your briefings, but the progress updates for percentage milestones are manual check-ins you should do when you hit meaningful marks.

---

## Keyboard Shortcuts

- **1**: Command Center
- **2**: Tasks
- **3**: Brain
- **4**: Knowledge
- **5**: Creator
- **6**: Settings

Navigate between them quickly. The system is designed to be operated in under 10 minutes per day with these quick jumps.

---

## The Daily Time Investment

Here's the honest breakdown of what TylerOS needs from you to run at peak efficiency:

- **Morning briefing scan**: 2 minutes
- **Review queued content + quick edits**: 3 minutes
- **Feedback on yesterday's posts (History tab)**: 2 minutes
- **Strategy check + optional "Generate This"**: 2 minutes
- **Weekly strategy review (Monday only)**: 5 minutes

**Total: ~10 minutes daily, ~15 on Mondays.**

Everything else — generation, publishing, analytics collection, token refresh, follower snapshots, external sync, strategy analysis — happens automatically in the background.

---

## Quick Reference: What Happens When

| Time | What Runs | What It Does |
|------|-----------|-------------|
| 6:00 AM ET | Daily Briefing | Generates today's CEO brief |
| 6:00 AM ET | Content Generation | Creates 5 posts from daily context |
| 6:00 AM ET (Mon) | Strategy Refresh | Trend detection → new recommendations |
| 6:00 AM ET (Mon) | Weekly CEO Brief | Full weekly synthesis |
| Every 5 min | Auto-Publish | Posts queued content at scheduled times |
| Daily | Analytics Cron | Collects engagement for all posted content |
| Daily | Token Refresh | Refreshes OAuth tokens expiring within 7 days |
| Daily | Strava Sync | Pulls latest training activities |
| Daily | Follower Snapshots | Records follower counts across all platforms |
| Daily | External Post Sync | Picks up your manual posts for voice learning |
