# TylerOS vNext — Claude Code Build Prompt (OPTIMIZED)
# Open this inside the ruhrohhalp repo (github.com/tyoung75/ruhrohhalp).
# Claude Code owns ALL backend infrastructure. Cowork owns UI + operations + testing.
# This prompt is de-duplicated against the Cowork prompt — no overlapping work.

---

## WHAT YOU ARE DOING

You are implementing the backend infrastructure of ruhrohhalp: database migrations, API route handlers, lib/ modules, GitHub Actions workflows, and the AI provider layer. You write code, run migrations, commit changes, and ship working endpoints.

**You are NOT responsible for:** UI components, frontend changes, running briefings, testing endpoints post-deploy, configuring GitHub Secrets or Vercel env vars, or Meta/TikTok developer portal work. That is Cowork's domain.

---

## CRITICAL: WHAT ALREADY EXISTS

The codebase is NOT greenfield. Read before creating. These exist and must be preserved or extended — not replaced:

| Existing | Location | Notes |
|---|---|---|
| AI config | `lib/ai-config.ts` | Has PRIMARY (Sonnet), FAST (Haiku), AUDIT (Llama 4 Scout), EMBEDDING_MODEL. **Needs Opus entries added.** |
| AI provider | `lib/ai/providers.ts` | `callProvider()` function supports Claude/ChatGPT/Gemini. **Extend with `callAI()` wrapper, don't delete.** |
| content_queue table | migration `20260323100000` | Already has: id, user_id, platform, content_type, body, media_urls, hashtags, scheduled_for, status, post_id, post_url, attempts, max_attempts, last_error, context_snapshot, agent_reasoning, confidence_score. Plus brand_voice_score, timeliness_score from `20260324000000`. **ALTER to add missing PRD columns, don't DROP/CREATE.** |
| post_analytics table | migration `20260323100000` | Already has: id, user_id, content_queue_id, platform, post_id, impressions, likes, replies, reposts, quotes, follows_gained, engagement_rate, fetched_at. **ALTER to add missing columns (views, saves, shares, watch_through_rate, follower_delta, engagement_score, hook, content_category). Rename the table to content_performance OR create a view.** |
| goal_signals table | migration `005_goals_and_pillars.sql` | Full implementation with 8 signal types. **Extend, don't recreate.** |
| leverage_reason column | migration `010` on tasks table | Column exists but is never populated. **Wire up the enrichment logic — no migration needed.** |
| 2 GHA workflows | `.github/workflows/cron-briefing.yml`, `cron-creator-publish.yml` | **Rename and update to use new `/api/internal/` pattern. Don't create conflicting duplicates.** |
| Cron auth | Uses `CRON_SECRET` env var | **Add `RUHROHHALP_SECRET` as alias: `process.env.RUHROHHALP_SECRET \|\| process.env.CRON_SECRET`. Migrate to RUHROHHALP_SECRET only after Cowork confirms env vars are set.** |
| Platform OAuth | All 4 platforms (TikTok, Threads, Instagram, YouTube) | Complete. Don't touch. |
| Rate limiter | `lib/security/rate-limit.ts` | In-memory Map. **Replace with Postgres-backed in Phase 2 if time allows — not blocking.** |
| Creator page | `app/creator/page.tsx` | 4 tabs (Queue, Analytics, History, Strategy). **Cowork handles UI changes.** |

---

## COMPANION CONTEXT

### PRD v2.3.0 — Source of Truth
- **Single-user system.** No Redis, no multi-tenant logic. Postgres handles all reliability.
- **Skill-first architecture.** ruhrohhalp is the data layer. Claude skills read/write via authenticated webhook endpoints. `[RRH:{task_id}]` format is a hard contract.
- **GitHub Actions is the only scheduler.** No Vercel cron. Every scheduled job is a `.yml` calling `/api/internal/`.
- **Q2 goals drive scoring:** Motus (50 subscribers), sub-40min 10k by May 28, 10k followers by June 30, $3k/mo supplemental. Linked tasks get min 0.7 goal_impact.
- **Preserve:** unified `api()` signature (commit 8d3a96d), Groq audit as raw fetch (no OpenAI SDK), Supabase + RLS, 3-panel layout, 10 Life Pillars.

### What Cowork Expects From Your Endpoints

| Cowork Operation | Your Endpoint | Contract |
|---|---|---|
| Morning/evening briefing | `POST /api/internal/briefing` | `{ type: "morning"\|"evening"\|"weekly" }` |
| Daily task scoring | `POST /api/internal/score-tasks` | Empty body |
| Sunday metric snapshot | `POST /api/internal/snapshot-metrics` | Empty body |
| Content handoff (every 6h) | `POST /api/internal/content-handoff` | Empty body |
| Zombie scan (Sunday PM) | `POST /api/internal/zombie-scan` | Empty body |
| Create task from skill | `POST /api/webhook/skill` | `{ action: "create_task", title, priority, goal_id, source }` |
| Update task state | `POST /api/webhook/skill` | `{ action: "update_task_state", task_id: "[RRH:uuid]", state }` |
| Log goal signal | `POST /api/webhook/skill` | `{ action: "add_goal_signal", goal_id, signal_type, value }` |
| Generate platform content | `POST /api/content-queue/generate` | ContentIdea (handler loads system_context internally) |
| Approve for publishing | `PATCH /api/content-queue/[id]` | `{ status: "queued" }` |
| Read scored tasks | `GET /api/tasks?ranked=true` | Returns tasks ordered by priority_score |
| Read goal state | `GET /api/goals` | Returns active Q2 goals with progress |
| Read brain dump + patterns | `GET /api/user-settings` | Returns brain_dump_week, content_patterns |

**Auth contract:** Every `/api/internal/` and `/api/webhook/` route uses `Authorization: Bearer {RUHROHHALP_SECRET}`. One pattern. Use `process.env.RUHROHHALP_SECRET || process.env.CRON_SECRET` during migration period.

**Response contract:** Every task create response includes `task_id: "[RRH:{uuid}]"`.

**Gmail contract:** `/api/internal/briefing` saves to `briefings` table with `gmail_draft_pending: true`. Cowork polls and creates Gmail draft via MCP.

**Content generation contract:** `/api/content-queue/generate` runs the Platform Intelligence Agent internally — calls `loadSystemContext()` and `loadPerformanceContext()` before generating.

---

## STACK & MODEL CONFIG

- **Framework:** Next.js 15 App Router (TypeScript)
- **Database:** Supabase (PostgreSQL + pgvector + RLS on all tables)

**Update `lib/ai-config.ts`** — add Opus entries and standardize:
```typescript
export const AI_MODELS = {
  PLATFORM_INTELLIGENCE: 'claude-opus-4-6',
  PATTERN_EXTRACTION:    'claude-opus-4-6',
  CEO_MODE:              'claude-opus-4-6',
  BRIEFING:              'claude-sonnet-4-6',
  TASK_SCORING:          'claude-sonnet-4-6',
  LEVERAGE_REASON:       'claude-sonnet-4-6',
  UNBLOCK_HINT:          'claude-sonnet-4-6',
  WEIGHT_ANALYSIS:       'claude-sonnet-4-6',
  COMMAND_BAR:           'claude-haiku-4-5',
} as const;
// Audit: Llama 4 Scout via Groq (raw fetch — not through callAI())
// Embeddings: BGE-M3 via Hugging Face
// Voice: Whisper-1 via OpenAI
```

---

## HOW TO WORK

1. **Read before editing.** Use `view` on relevant files before any `str_replace`. Never edit blind.
2. **One item, one commit.** Working item → commit → confirm → next.
3. **Check existing schema before migrating.** Run `\d table_name` equivalent to see what columns already exist. Use ALTER, not CREATE, for existing tables.
4. **Test every internal endpoint.** Include a working `curl` in the commit message. Run it, show the output.
5. **`str_replace` for targeted edits.** Minimal change that ships the feature.
6. **Add `// TODO: wrap in runJob() after Item 5` to Items 1–4 endpoints.** Go back and wrap after Item 5 ships.
7. **Signal Cowork** after each item ships: update the shared checklist in `/docs/build-progress.md`.

---

## BUILD ITEMS — YOUR SCOPE ONLY

### Item 0 — GitHub Actions scaffold + internal API auth

**Step 1:** Check if `vercel.json` has a `crons` key. If yes, remove all cron entries.

**Step 2:** Create `lib/internal-auth.ts`:
```typescript
export function validateInternalRequest(request: Request): boolean {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) return false;
  const token = authHeader.replace('Bearer ', '');
  return token === (process.env.RUHROHHALP_SECRET || process.env.CRON_SECRET);
}
```

**Step 3:** Rename existing `.github/workflows/cron-briefing.yml` → `briefing-morning.yml`. Update it to POST to `/api/internal/briefing` with `Authorization: Bearer` header. Create the additional workflow files:
- `briefing-evening.yml` (8 PM ET → cron `0 0 * * *` UTC)
- `briefing-weekly.yml` (Sunday 8 AM ET → cron `0 12 * * 0`)
- `score-tasks.yml` (7 AM ET daily → cron `0 11 * * *`)
- `embed-chunks.yml` (2 AM ET daily → cron `0 6 * * *`)
- `content-handoff.yml` (every 6h → cron `0 */6 * * *`)
- `zombie-scan.yml` (Sunday 8 PM ET → cron `0 0 * * 0`)
- `snapshot-metrics.yml` (Sunday 6 AM ET → cron `0 10 * * 0`)

All workflows: `workflow_dispatch:` included for manual triggers. All use the same curl pattern with `${{ secrets.RUHROHHALP_URL }}` and `${{ secrets.RUHROHHALP_SECRET }}`.

**Step 4:** Create stub `/api/internal/` route handlers for: `briefing`, `score-tasks`, `embed-chunks`, `content-handoff`, `zombie-scan`, `snapshot-metrics`. Each validates auth and returns `{ ok: true, job: "name", message: "stub" }`.

**Commit:** `feat: GitHub Actions scheduler — 8 workflows + /api/internal/* stubs + internal auth`

---

### Item 1 — task_priority_score column + scoring implementation

**Migration:** (tasks table already has `priority_num` INT and `ai_metadata` JSONB — check first)
```sql
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS priority_score FLOAT DEFAULT 0;
-- ai_metadata may already exist — check before adding
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS ai_metadata JSONB DEFAULT '{}';
CREATE INDEX IF NOT EXISTS idx_tasks_priority_score ON tasks(priority_score DESC) WHERE state NOT IN ('done');
```

**Create `lib/ai/scoring.ts`** with `computePriorityScore()`, `computeUrgency()`, `computeEnergyFit()` functions. Formula: `(goal_impact × 0.4) + (urgency × 0.3) + (energy_fit × 0.2)`, halved if blocked. Read weights from `user_settings.scoring_weights` if available.

**Replace score-tasks stub** with real implementation that iterates open tasks, computes scores, updates `priority_score` column.

**Update `GET /api/tasks`:** Add `?ranked=true` query param that sorts by `priority_score DESC`.

**Commit:** `feat: priority scoring engine — task_priority_score + score-tasks endpoint`

---

### Item 2 — Skill webhook contract endpoints

**Create `app/api/webhook/skill/route.ts`:**
- Auth: `Authorization: Bearer {RUHROHHALP_SECRET}` (same pattern as internal routes)
- Actions: `create_task`, `update_task_state`, `add_goal_signal`
- All responses include `[RRH:{uuid}]` format for task IDs
- After creating a task, immediately score it and return the score
- Add `GET /api/tasks?source={skill_name}` filter

**Commit:** `feat: skill webhook contract — [RRH:id] task create/update/signal`

---

### Item 3 — Leverage reason enrichment (backend only)

The `leverage_reason` column already exists in the tasks table. Wire up the enrichment:

- In the score-tasks cron handler, after scoring a task, if score changed >0.1 or leverage_reason is null, call Sonnet (AI_MODELS.LEVERAGE_REASON) to generate a one-sentence reason
- Store in `ai_metadata.leverage_reason`
- Also enrich on task creation via webhook (fire and forget, don't block response)

**Cowork handles the UI** (expandable "Why" section on action cards).

**Commit:** `feat: leverage_reason enrichment — Sonnet generates Why reasoning on score changes`

---

### Item 4 — Blocker detection + zombie scan (backend only)

**Blocked tasks:** When task state → 'blocked' (in PATCH /api/tasks/[id] and webhook), fire-and-forget call to generate `ai_metadata.unblock_hint` via Sonnet.

**Replace zombie-scan stub:** Find tasks not updated in 7+ days, state not in (done, blocked), insert system alerts into activity_log with `action: 'zombie_alert'`.

**Expose endpoints for Cowork UI:**
- `GET /api/tasks?state=blocked` returns blocked tasks with unblock_hint
- `GET /api/system-alerts?type=zombie_alert` returns recent zombie alerts

**Commit:** `feat: blocker detection + zombie scan — unblock hints + zombie endpoint`

---

### Item 5 — job_runs state machine

**Migration:**
```sql
CREATE TABLE IF NOT EXISTS job_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  idempotency_key TEXT UNIQUE,
  payload JSONB DEFAULT '{}',
  result JSONB,
  error TEXT,
  retries INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX ON job_runs(job_type, status);
CREATE INDEX ON job_runs(created_at DESC);
```

**Create `lib/jobs/executor.ts`** with `runJob()` — idempotent execution, retry up to 3x with exponential backoff, dead-letter on failure.

**Wrap all `/api/internal/*` routes** in `runJob()`.

**Create `GET /api/system-alerts`** that includes dead-letter job_runs from last 48h (for Cowork to render in right panel).

**Commit:** `feat: job_runs state machine — idempotent executor, dead-letter alerts, wrap all internal routes`

---

### Item 6 — Unified AI provider wrapper

**Extend existing `lib/ai/providers.ts`** — add `callAI()` function alongside existing `callProvider()`:
- Timeout + retry + fallback model
- Log every call to activity_log: `{route, model, latency_ms, tokens_used, error}`
- All new code uses `callAI()` + `AI_MODELS` constants

**Update `lib/ai-config.ts`** with full Opus/Sonnet/Haiku model map.

**Do NOT change:** Groq raw fetch, Whisper raw fetch, existing callProvider() callers (migrate them incrementally).

**Commit:** `feat: unified AI provider wrapper + centralized model config — callAI() with timeout, retry, logging`

---

### Item 7 — Goal progress signals from task completions

The goal_signals table already exists. Wire up auto-signal on task completion:

- In `PATCH /api/tasks/[id]`, when state → 'done' and goal_id is set, insert goal_signal with type 'task_completed'
- Create `increment_goal_progress` Postgres function
- Also insert into `outcome_signals` (created in Item 9)

**Commit:** `feat: goal progress signals — auto-signal on task completion`

---

### Item 8 — Platform Intelligence Agent

**ALTER existing content_queue table** (don't DROP/CREATE):
```sql
ALTER TABLE content_queue ADD COLUMN IF NOT EXISTS topic TEXT;
ALTER TABLE content_queue ADD COLUMN IF NOT EXISTS platform_format TEXT;
ALTER TABLE content_queue ADD COLUMN IF NOT EXISTS caption TEXT;
ALTER TABLE content_queue ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE content_queue ADD COLUMN IF NOT EXISTS platform_spec JSONB;
ALTER TABLE content_queue ADD COLUMN IF NOT EXISTS content_idea_id UUID;
ALTER TABLE content_queue ADD COLUMN IF NOT EXISTS external_id TEXT;
ALTER TABLE content_queue ADD COLUMN IF NOT EXISTS ai_audit_passed BOOLEAN;
ALTER TABLE content_queue ADD COLUMN IF NOT EXISTS audit_notes TEXT;
ALTER TABLE content_queue ADD COLUMN IF NOT EXISTS generated_by TEXT DEFAULT 'platform_intelligence_agent';
CREATE INDEX IF NOT EXISTS idx_cq_idea ON content_queue(content_idea_id);
CREATE INDEX IF NOT EXISTS idx_cq_platform_status ON content_queue(platform, status);
```

**Create `lib/ai/platform-intelligence.ts`:**
- `loadSystemContext()` — active goals, top 5 scored tasks, brain_dump_week, top_of_mind, already-queued topics
- `loadPerformanceContext()` — last 20 posts per platform from content_performance + user_settings.content_patterns
- `generatePlatformVariants()` — Opus generates per-platform variants with platform-specific format rules
- Audit step: Llama 4 Scout via Groq validates brand voice per variant

**Create `POST /api/content-queue/generate`** — accepts ContentIdea, loads contexts, runs agent, saves variants.

**Commit:** `feat: platform intelligence agent — per-platform content variants with system context + audit`

---

### Item 8b — Content handoff endpoint

**Replace content-handoff stub** with real implementation:
- Read content_queue WHERE status='queued'
- Route each item to platform-specific posting function (TikTok, Instagram, YouTube, Threads)
- Create stub posting functions in `lib/integrations/` that throw with clear credential requirements
- Update status to 'handed_off' + store external_id on success

**Commit:** `feat: content handoff — per-platform API routing stubs`

---

### Item 8c — Content Performance Brain + Pattern Extraction

**ALTER existing post_analytics table** (or create content_performance as a new table if cleaner):
```sql
-- Add missing columns to post_analytics OR create content_performance
-- Include: views, saves, shares, watch_through_rate, follower_delta, engagement_score, hook, content_category, was_pattern_informed
```

**Add to user_settings:**
```sql
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS content_patterns JSONB DEFAULT '{}';
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS content_patterns_updated_at TIMESTAMPTZ;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS content_patterns_manual_override JSONB DEFAULT '{}';
```

**Create `lib/ai/pattern-extraction.ts`** — Opus analyzes 90 days of content_performance per platform, writes patterns to user_settings.content_patterns. Respects manual overrides (30-day protection).

**Replace snapshot-metrics stub** — fetches platform metrics, computes engagement_score, runs pattern extraction on Sundays.

**Commit:** `feat: content performance brain — engagement scoring + weekly pattern extraction`

---

### Item 9 — Outcome telemetry

**Migration:**
```sql
CREATE TABLE IF NOT EXISTS outcome_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pillar_id UUID REFERENCES pillars(id),
  goal_id UUID REFERENCES goals(id),
  signal_type TEXT NOT NULL,
  value NUMERIC,
  value_text TEXT,
  recorded_at TIMESTAMPTZ DEFAULT NOW(),
  source TEXT
);
CREATE INDEX ON outcome_signals(goal_id, recorded_at DESC);
```

**Update `/api/internal/briefing` weekly handler** to call `loadBriefingContext()` — cross-system snapshot including outcome_signals, content queue, content performance, patterns.

**Commit:** `feat: outcome telemetry + cross-system briefing context`

---

### Item 10 — Recommendation dismissal feedback (backend only)

**Create `POST /api/tasks/[id]/dismiss`** — logs dismissal to activity_log with reason. After 30 accumulated dismissals, triggers Sonnet analysis that updates scoring_weights in user_settings.

**Cowork handles the UI** (dismiss button + reason picker on action cards).

**Commit:** `feat: dismissal feedback loop — adaptive scoring weights`

---

## GROUND RULES

1. GitHub Actions is the only scheduler. No Vercel cron.
2. All internal routes use `validateInternalRequest()`.
3. Retry logic in API handlers, not workflow YAML.
4. All internal routes wrapped in `runJob()` after Item 5.
5. Don't break the unified `api()` function pattern (commit 8d3a96d).
6. Postgres only. No Redis.
7. Groq stays as raw fetch.
8. `[RRH:{id}]` format is a contract.
9. `workflow_dispatch:` on every workflow.
10. After each item ships, update `/docs/build-progress.md` so Cowork knows what's ready.
