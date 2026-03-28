# TylerOS vNext — Cowork Build Prompt (OPTIMIZED)
# Run this in Cowork. Claude Code handles all backend infrastructure in parallel.
# Cowork owns: UI components, frontend wiring, external service config, testing, and operations.

---

## WHAT YOU ARE DOING

You are building the frontend layer and handling external configuration for TylerOS vNext. You create/update React components, wire UI to API endpoints that Claude Code is building in parallel, configure GitHub Secrets and Vercel env vars, set up developer portal settings, and run end-to-end tests after each deploy.

**You are NOT responsible for:** database migrations, API route handlers, lib/ backend modules, GitHub Actions workflow YAML files, or the AI provider wrapper. Claude Code handles all of that. You consume the endpoints it creates.

---

## HOW PARALLEL EXECUTION WORKS

Claude Code is building Items 0–10 sequentially (backend). You build UI components and external config in parallel. Some of your work depends on Claude Code's endpoints being deployed first.

**Dependency-free work (start immediately):**
- GitHub repository secrets setup
- Vercel env var verification
- Meta developer portal configuration (Threads + Instagram redirect URIs)
- ai-config.ts Opus model entries (if Claude Code hasn't gotten to Item 6 yet)
- UI component scaffolding (can use mock data until endpoints are live)

**Depends on Claude Code Item 0:** Test all /api/internal/* stubs return 200
**Depends on Claude Code Item 1:** Wire center panel to `?ranked=true` endpoint
**Depends on Claude Code Item 2:** Test skill webhook with curl
**Depends on Claude Code Item 3:** Wire "Why" reasoning UI to leverage_reason field
**Depends on Claude Code Item 4:** Wire right panel blocked tasks + zombie alerts
**Depends on Claude Code Item 5:** Verify job_runs dead-letter alerts in right panel
**Depends on Claude Code Item 8:** Wire Creator page to new content_queue/generate endpoint

**Check `/docs/build-progress.md`** to see which items Claude Code has completed.

---

## CRITICAL: WHAT ALREADY EXISTS

| Existing | Location | Notes |
|---|---|---|
| 3-panel layout | `app/page.tsx` (CommandConsolePage) | Left: PillarHealth, Center: TodaysFocus, Right: SignalsPanel. **Extend, don't rebuild.** |
| Creator page | `app/creator/page.tsx` | 4 tabs: Queue, Analytics, History, Strategy. **Update to use new endpoints.** |
| Brain Dump modal | `components/brain-dump-modal.tsx` | Full implementation. **Preserve.** |
| Command bar | `components/command-bar.tsx` | Intent detection working. **Preserve.** |
| CEO Mode | `components/brain/CeoMode.tsx` | Working. **Preserve.** |
| Integrations page | `app/settings/integrations/page.tsx` | All 4 platforms (TikTok, Threads, Instagram, YouTube). **Done.** |

---

## COMPANION CONTEXT

### PRD v2.3.0 — Source of Truth
- **3-panel command center:** Life Pillars (left), Today's Focus (center), Signals & Insights (right)
- **Center panel:** Exactly 3 high-leverage actions ranked by priority_score. Each card has Why reasoning and one-tap execution.
- **Right panel:** Blocked tasks with unblock hints, zombie task alerts, dead-letter job alerts, content needing review.
- **Creator OS:** Platform Intelligence Agent generates per-platform variants. Content items surface in right panel when they need review.

### Endpoint Contracts (Claude Code builds these — you consume them)

| Your UI Component | Endpoint | What You Get |
|---|---|---|
| Center panel "Do Now" cards | `GET /api/tasks?ranked=true&limit=3&state=not(done)` | Tasks sorted by priority_score, each has ai_metadata.leverage_reason |
| Right panel blocked tasks | `GET /api/tasks?state=blocked` | Blocked tasks with ai_metadata.unblock_hint |
| Right panel zombie alerts | `GET /api/system-alerts?type=zombie_alert` | Stale tasks not updated in 7+ days |
| Right panel dead-letter alerts | `GET /api/system-alerts` | Failed job_runs from last 48h |
| Right panel content review | `GET /api/content-queue?status=draft&ai_audit_passed=false` | Content that failed brand voice audit |
| Weekly goal pulse | `GET /api/goals` | Active Q2 goals with progress + recent signals |
| Dismiss action | `POST /api/tasks/[id]/dismiss` | `{ reason: 'not_relevant'\|'already_done'\|'wrong_timing'\|'no_reason' }` |
| Content generation | `POST /api/content-queue/generate` | Accepts ContentIdea, returns platform variants |

---

## BUILD ITEMS — YOUR SCOPE ONLY

### CW-0 — External Configuration (START IMMEDIATELY — no dependencies)

**GitHub Repository Secrets:**
Go to github.com/TylerJYoung/ruhrohhalp → Settings → Secrets and variables → Actions. Add:
- `RUHROHHALP_SECRET` — generate a strong secret or use the existing `CRON_SECRET` value from Vercel
- `RUHROHHALP_URL` — `https://www.ruhrohhalp.com`

**Vercel Environment Variables:**
Verify these exist in Vercel dashboard (Settings → Environment Variables):
- `RUHROHHALP_SECRET` — same value as the GitHub secret above
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `ANTHROPIC_API_KEY`, `GROQ_API_KEY`, `HF_API_TOKEN`, `OPENAI_API_KEY`
- `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`
- `THREADS_APP_ID`, `THREADS_APP_SECRET`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- `YOUTUBE_API_KEY`

**Meta Developer Portal:**
- Add `https://www.ruhrohhalp.com/api/auth/threads/callback` as a valid OAuth redirect URI
- Add `https://www.ruhrohhalp.com/api/auth/instagram/callback` as a valid OAuth redirect URI
- Verify Instagram permissions are requested: `instagram_basic`, `instagram_content_publish`, `instagram_manage_insights`, `pages_show_list`, `pages_read_engagement`
- Submit for Meta App Review if not already done

**TikTok Developer Portal:**
- Submit app for review if not already done (App ID: 7622010109873309703)
- Submission reason: "Initial submission. ruhrohhalp uses Login Kit for TikTok OAuth login and displays user profile info and video analytics in a creator dashboard."

---

### CW-1 — Center Panel: Priority-Ranked Action Cards

**Depends on:** Claude Code Item 1 (score-tasks endpoint deployed)

Update the center panel's "Today's Focus" section in `app/page.tsx` (or the TodaysFocus component):

1. Fetch tasks from `GET /api/tasks?ranked=true&limit=3` instead of the current fetch
2. Each action card shows:
   - Task title
   - Priority score badge (e.g., "0.87")
   - Linked goal + pillar name
   - Expandable "Why high-leverage?" section showing `ai_metadata.leverage_reason`
   - If leverage_reason is null, show "Analyzing..." and poll once after 3 seconds
3. One-tap execution options: "Start" (set state=started), "Done" (set state=done), "Block" (set state=blocked)

---

### CW-2 — Center Panel: Dismiss with Reason

**Depends on:** Claude Code Item 10 (dismiss endpoint deployed)

Add dismiss functionality to each action card:

1. "×" dismiss button on each card
2. On click, show inline reason picker: "Not relevant / Already done / Wrong timing / Just close"
3. Single tap selects reason and calls `POST /api/tasks/[id]/dismiss` with the reason
4. Card fades out on dismiss, next-highest-scored task takes its place

---

### CW-3 — Right Panel: Blocked Tasks + Unblock Hints

**Depends on:** Claude Code Item 4 (blocker detection deployed)

Add a "Blocked" section to the right panel (SignalsPanel):

1. Fetch from `GET /api/tasks?state=blocked`
2. Render each blocked task with amber indicator
3. Show `ai_metadata.unblock_hint` inline below the task title
4. "Mark Unblocked" button → PATCH to set state back to unstarted
5. Max 3 items shown, "View all" link

---

### CW-4 — Right Panel: Zombie Task Alerts

**Depends on:** Claude Code Item 4 (zombie-scan endpoint deployed)

Add a "Stale Tasks" section to the right panel:

1. Fetch from `GET /api/system-alerts?type=zombie_alert`
2. Each zombie shows: task title, "No update in X days"
3. Three action buttons: "Snooze 7 days" / "Mark Done" / "Remove"
4. Max 3 items shown

---

### CW-5 — Right Panel: Dead-Letter Job Alerts

**Depends on:** Claude Code Item 5 (job_runs table deployed)

Add a "System Alerts" section to the right panel:

1. Fetch from `GET /api/system-alerts` (includes dead_letter job_runs)
2. Render as red alert cards: job name, error snippet, timestamp
3. "Retry" button that calls the original internal endpoint with a new idempotency key

---

### CW-6 — Right Panel: Content Needing Review

**Depends on:** Claude Code Item 8 (Platform Intelligence Agent deployed)

Add a "Content Review" section to the right panel:

1. Fetch from `GET /api/content-queue?status=draft&ai_audit_passed=false`
2. Items that failed audit: show platform icon, topic, audit_notes inline
3. Items that passed audit: show as "Ready to approve" with one-tap approve button
4. Approve → PATCH `/api/content-queue/[id]` with `{ status: "queued" }`

---

### CW-7 — Creator Page: Update to New Endpoints

**Depends on:** Claude Code Item 8 (content_queue schema updated)

Update `app/creator/page.tsx`:

1. Queue tab: fetch from updated content_queue with platform_spec, platform_format, topic fields
2. Add "Generate Content" button that opens a modal:
   - Topic input
   - Context input (recent win, event, etc.)
   - Goal alignment dropdown (from active Q2 goals)
   - Platform checkboxes (TikTok, Instagram Reels, YouTube Shorts, Threads)
   - "Generate" button → POST to `/api/content-queue/generate`
3. Show generated variants grouped by content_idea_id
4. Each variant shows: platform icon, content preview, audit status, approve/edit/reject actions

---

### CW-8 — End-to-End Testing

After Claude Code finishes each item and deploys:

1. **Item 0:** Manually trigger all GitHub Actions workflows. Verify HTTP 200 responses. Screenshot run logs.
2. **Item 1:** Run `POST /api/internal/score-tasks`. Verify tasks have priority_score values. Check `GET /api/tasks?ranked=true` returns sorted results.
3. **Item 2:** Test all 3 webhook actions:
   ```
   POST /api/webhook/skill { action: "create_task", title: "Test task", source: "test" }
   POST /api/webhook/skill { action: "update_task_state", task_id: "[RRH:{id}]", state: "done" }
   POST /api/webhook/skill { action: "add_goal_signal", goal_id: "{id}", signal_type: "task_completed", value: "test" }
   ```
4. **Item 5:** Trigger a job, verify job_runs row created. Trigger same job again, verify idempotent skip. Check dead-letter surfacing.
5. **Item 8:** Generate content for a test topic. Verify 4 platform variants created with different structures.

---

## PHASE 4: OPERATIONS MODE (after all build items complete)

### Pre-Flight Migration
1. Open Cowork settings → Scheduled tasks
2. Disable any scheduled task that overlaps with the new GitHub Actions workflows (briefings, content handoffs, analytics)
3. Keep all interactive/on-demand skills enabled

### Operational Rhythm
Once the build is complete, Cowork shifts from builder to operator:
- **Morning brief (auto):** GitHub Actions triggers at 6 AM → briefing saved to DB → life-os-command-center skill polls and creates Gmail draft
- **Task scoring (auto):** GitHub Actions triggers at 7 AM → all tasks re-scored → center panel updates
- **Content generation (on-demand):** Tyler says "draft content" → content-autodraft skill calls `/api/content-queue/generate` → Platform Intelligence Agent generates variants → Tyler reviews in Creator page or right panel
- **Content handoff (auto):** GitHub Actions every 6h → queued content published to platforms
- **Sunday metrics (auto):** GitHub Actions pulls engagement data → pattern extraction runs → agent gets smarter next week
- **Zombie scan (auto):** Sunday 8 PM → stale tasks surfaced in right panel

### Skills That Now Talk to the Build

| Skill | What It Does Post-Build |
|---|---|
| `life-os-command-center` | Reads briefings with `gmail_draft_pending: true`, creates Gmail draft via MCP |
| `daily-scheduler` | Reads `GET /api/tasks?ranked=true`, creates [RRH:{id}]-tagged calendar blocks |
| `content-autodraft` | Calls `POST /api/content-queue/generate` with ContentIdea from calendar/goals |
| `brand-outreach-cowork` | Creates tasks via `POST /api/webhook/skill` with goal linkage |

---

## GROUND RULES

1. Don't create or modify backend files (routes, lib/, migrations). That's Claude Code's domain.
2. UI components use the endpoint contracts listed above.
3. If an endpoint isn't deployed yet, scaffold the UI with mock data and add a TODO.
4. Test every endpoint after Claude Code reports it's deployed.
5. Check `/docs/build-progress.md` before starting dependency-blocked items.
6. After completing each CW item, update the progress file so Claude Code knows.
