# TylerOS vNext — Build Progress

## Backend (Claude Code)

| Item | Description | Status | Commit |
|------|-------------|--------|--------|
| 0 | GitHub Actions scaffold + internal API auth | done | 19aa6b6 |
| 1 | task_priority_score + scoring engine | done | ffa6eaf |
| 2 | Skill webhook contract endpoints | done | d877313 |
| 3 | Leverage reason enrichment | done | 7c324ed |
| 4 | Blocker detection + zombie scan | done | 8a4e5e8 |
| 5 | job_runs state machine | done | c6ff7e7 |
| 6 | Unified AI provider wrapper | done | 4dfcbb1 |
| 7 | Goal progress signals | done | 8d6c94e |
| 8 | Platform Intelligence Agent | done | f55b991 |
| 8b | Content handoff endpoint | done | cb09070 |
| 8c | Content Performance Brain | done | 3e0e011 |
| 9 | Outcome telemetry | done | 51136b9 |
| 10 | Dismissal feedback loop | done | 2778cdd |

## Cowork Ready — Endpoints

### Internal Routes (GHA → POST with Bearer auth)
- [x] `POST /api/internal/briefing` — `{type: "morning"|"evening"|"weekly"}` → saves to briefings table with `gmail_draft_pending: true`
- [x] `POST /api/internal/score-tasks` — scores all open tasks, enriches leverage_reason via Sonnet
- [x] `POST /api/internal/embed-chunks` — stub (ready for embedding pipeline)
- [x] `POST /api/internal/content-handoff` — reads queued content, routes to platform posting stubs
- [x] `POST /api/internal/zombie-scan` — finds stale tasks (7+ days), inserts zombie_alert
- [x] `POST /api/internal/snapshot-metrics` — computes engagement scores, runs pattern extraction on Sundays

### Skill Webhook
- [x] `POST /api/webhook/skill` — `{action: "create_task"|"update_task_state"|"add_goal_signal"}`
- Returns `task_id: "[RRH:{uuid}]"` on create
- Immediately scores new tasks
- Auto-inserts goal_signal + outcome_signal on task completion

### Content Pipeline
- [x] `POST /api/content-queue/generate` — accepts ContentIdea, runs Platform Intelligence Agent (Opus), audits via Llama 4 Scout (Groq)
- [x] `PATCH /api/content-queue/[id]` — approve for publishing `{status: "queued"}`

### Task Endpoints (updated)
- [x] `GET /api/tasks?ranked=true` — sort by priority_score DESC
- [x] `GET /api/tasks?source={skill_name}` — filter by source
- [x] `GET /api/tasks?state=blocked` — blocked tasks with unblock_hint in ai_metadata
- [x] `PATCH /api/tasks/[id]` — supports `state` field, auto-generates unblock_hint on blocked
- [x] `POST /api/tasks/[id]/dismiss` — logs dismissal, triggers adaptive weight analysis after 30

### System
- [x] `GET /api/system-alerts?type=zombie_alert` — zombie alerts + dead-letter job_runs
- [x] `GET /api/goals` — active goals with progress (existing, unchanged)
- [x] `GET /api/user-settings` — TODO: create this endpoint for Cowork to read brain_dump + patterns

### Auth
- All `/api/internal/*` and `/api/webhook/*` routes: `Authorization: Bearer {RUHROHHALP_SECRET}`
- `RUHROHHALP_SECRET || CRON_SECRET` during migration period

## New Database Tables
- `user_settings` — scoring_weights, brain_dump_week, content_patterns
- `job_runs` — idempotent job execution with retry + dead-letter
- `outcome_signals` — cross-system telemetry (pillar/goal/signal_type/value)

## Schema Changes
- `tasks` — added `priority_score FLOAT`, `ai_metadata JSONB`
- `content_queue` — added `topic`, `platform_format`, `caption`, `title`, `platform_spec`, `content_idea_id`, `external_id`, `ai_audit_passed`, `audit_notes`, `generated_by`
- `post_analytics` — added `views`, `saves`, `shares`, `watch_through_rate`, `follower_delta`, `engagement_score`, `hook`, `content_category`, `was_pattern_informed`
- `briefings` — added `gmail_draft_pending`, extended period to include 'weekly'
- `activity_log` — extended type constraint for zombie_alert, goal_signal, ai_call, task_dismissed

## GitHub Actions Workflows (8)
- briefing-morning.yml (7 AM ET daily)
- briefing-evening.yml (8 PM ET daily)
- briefing-weekly.yml (Sunday 8 AM ET)
- score-tasks.yml (7 AM ET daily)
- embed-chunks.yml (2 AM ET daily)
- content-handoff.yml (every 6h)
- zombie-scan.yml (Sunday 8 PM ET)
- snapshot-metrics.yml (Sunday 6 AM ET)

## New Lib Modules
- `lib/internal-auth.ts` — validateInternalRequest()
- `lib/ai/scoring.ts` — computePriorityScore(), computeUrgency(), computeEnergyFit()
- `lib/ai/leverage-reason.ts` — generateLeverageReason() via Sonnet
- `lib/ai/unblock-hint.ts` — generateUnblockHint() via Sonnet
- `lib/ai/platform-intelligence.ts` — loadSystemContext(), loadPerformanceContext(), generatePlatformVariants(), auditVariant()
- `lib/ai/pattern-extraction.ts` — extractPatterns() via Opus, computeEngagementScore()
- `lib/ai/briefing-context.ts` — loadBriefingContext() cross-system snapshot
- `lib/ai/providers.ts` — added callAI() with timeout, retry, fallback, logging
- `lib/jobs/executor.ts` — runJob() idempotent executor
- `lib/integrations/post-to-platform.ts` — platform posting stubs

## Cowork TODO
- [ ] Configure GitHub Secrets: `RUHROHHALP_URL`, `RUHROHHALP_SECRET`
- [ ] Create `GET /api/user-settings` UI endpoint
- [ ] Build dismiss button + reason picker on action cards
- [ ] Build "Why" expandable section on action cards (reads leverage_reason)
- [ ] Test all endpoints post-deploy
- [ ] Connect platform posting functions to existing lib/creator/* implementations
