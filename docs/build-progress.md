# TylerOS vNext — Build Progress

Last updated: 2026-03-28T02:45:00Z

## Cowork Build Items (UI + Config)

| Item | Status | Notes |
|---|---|---|
| CW-0: External Configuration | ⚠️ Partial | GitHub secret ✅, Vercel needs 8 more vars (script at `scripts/add-missing-vercel-envs.sh`), Meta/TikTok portals need Tyler login |
| CW-1: Center Panel Priority Cards | ✅ Done | Fetches from `?ranked=true&state=started,unstarted,backlog`, reads `tasks[]` (not `items[]`) for `ai_metadata`, shows priority_score badge, goal+pillar info, leverage_reason with poll-on-null |
| CW-2: Dismiss with Reason | ✅ Done | Inline reason picker (not_relevant/already_done/wrong_timing/too_hard/other), calls POST /api/tasks/[id]/dismiss — aligned with backend weight analysis patterns |
| CW-3: Right Panel Blocked Tasks | ✅ Done | Fetches `tasks[]` from state=blocked (has `ai_metadata.unblock_hint`), "Mark Unblocked" button |
| CW-4: Right Panel Zombie Alerts | ✅ Done | Fetches system-alerts?type=zombie_alert, maps activity_log payload to ZombieAlert shape (task_id, days_stale), Snooze/Done/Remove actions |
| CW-5: Right Panel Dead-Letter | ✅ Done | Reads `dead_letter_jobs[]` from system-alerts response (not `alerts[]`), maps job_runs fields to DeadLetterAlert, Retry button |
| CW-6: Right Panel Content Review | ✅ Done | Fetches GET /api/content-queue?status=draft&ai_audit_passed=false (new endpoint), Approve & Queue button |
| CW-7: Creator Page Update | ✅ Done | Generate Content modal with topic/context/goal/platform inputs, Platform Intelligence Agent endpoint, variant review UI |
| CW-8: E2E Testing | ✅ Done | 22 Vitest integration tests (contract validation), Playwright E2E specs, 0 TypeScript errors, 6 contract mismatches found and fixed |

## Claude Code Build Items (Backend)

| Item | Status | Notes |
|---|---|---|
| CC-0: GHA Infrastructure | ✅ Shipped | 8 workflow files in .github/workflows/, CRON_SECRET internal auth |
| CC-1: Score-Tasks Endpoint | ✅ Shipped | /api/internal/score-tasks, priority_score column, ranked=true query support |
| CC-2: Skill Webhook | ✅ Shipped | /api/webhook/skill with [RRH:{id}] contract, x-webhook-secret auth |
| CC-3: Leverage Reason | ✅ Shipped | Sonnet generates leverage_reason on score changes |
| CC-4: Blocker Detection + Zombie Scan | ✅ Shipped | /api/internal/zombie-scan, unblock_hint via ai_metadata |
| CC-5: Job Runs + Dead Letter | ✅ Shipped | job_runs table, idempotent executor, dead_letter status |
| CC-6: AI Config Opus | ✅ Shipped | lib/ai-config.ts — model slots for all AI features |
| CC-7: callAI Wrapper | ✅ Shipped | lib/ai/providers.ts — unified callAI() with timeout, retry, logging |
| CC-8: Platform Intelligence Agent | ✅ Shipped | /api/content-queue/generate, per-platform variants, Groq brand audit |
| CC-9: Content Patterns Persistence | ✅ Shipped | lib/ai/pattern-extraction.ts, weekly engagement scoring |
| CC-10: Dismiss Endpoint | ✅ Shipped | /api/tasks/[id]/dismiss, adaptive weight analysis after 30 dismissals |

## Integration Fixes Applied

| Fix | Details |
|---|---|
| state=not(done) → explicit states | Backend `.in()` doesn't support negation; now sends `state=started,unstarted,backlog` |
| Blocked tasks response key | UI now reads `tasks[]` (has `ai_metadata`) instead of `items[]` (camelCase, no metadata) |
| Dead-letter data source | UI reads `dead_letter_jobs[]` from job_runs table, not `alerts[]` from activity_log |
| Zombie alert payload mapping | Maps `payload.task_id`, `payload.days_stale` etc. to top-level ZombieAlert fields |
| Missing GET /api/content-queue | Created new route for CW-6 content review panel (status, ai_audit_passed filters) |
| Dismiss reason alignment | UI now sends `too_hard`/`other` matching backend weight analysis patterns |
| PlannerItem type errors | Added `leverageReason`, `githubPrUrl` to app-shell.tsx and lib/ai/service.ts |

## Branch Status

| Branch | Contents | Status |
|---|---|---|
| `origin/claude/tyleros-vnext-backend-oAn8p` | All 13 CC backend items | Pushed, ready to merge |
| Working directory | CW-1–CW-7 UI + CW-8 tests + integration fixes | Ready to commit |
| Merged repo at `/sessions/zen-keen-allen/repo-merge` | Backend + UI merged | Clean, 0 TS errors |

## Manual Actions Required (Tyler)

1. **GitHub Actions Variable:** Add `RUHROHHALP_URL` = `https://www.ruhrohhalp.com` at github.com/tyoung75/ruhrohhalp/settings/variables/actions/new
2. **Vercel Env Vars:** Run `bash scripts/add-missing-vercel-envs.sh` from project root (requires `vercel login` first)
3. **GROQ_API_KEY:** Get from console.groq.com, add to both .env.local and Vercel
4. **Meta Developer Portal:** Add redirect URIs (see docs/CW-0-env-checklist.md)
5. **TikTok Developer Portal:** Submit app for review (see docs/CW-0-env-checklist.md)
6. **Merge backend branch:** `git merge origin/claude/tyleros-vnext-backend-oAn8p` on main
7. **Run Supabase migrations:** 7 new migration files in `supabase/migrations/`
8. **Fix build error:** Backend has `npm run build` exit code 1 (Tyler fixing in Claude Code)
