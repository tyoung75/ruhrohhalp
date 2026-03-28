# TylerOS vNext — E2E Bug Report

**Date:** 2026-03-28
**Tester:** Cowork (automated E2E)
**Environment:** Production (https://www.ruhrohhalp.com)
**Branch:** Working directory (CW-1–CW-8 + integration fixes)

---

## Summary

Tested all pages, API endpoints, UI components, and signal filters across the full ruhrohhalp application. Overall the app is in strong shape — all API endpoints return 200, the three-panel Command Center layout renders correctly, and all vNext features (priority scoring, dismiss with reason, blocked tasks, zombie alerts, dead-letter jobs, content queue, content generation) are functional.

**Total bugs found: 4** (1 critical, 1 medium, 2 low)
**Pre-existing test failures: 2** (not vNext-related)

---

## Bugs

### BUG-1: Missing `creator_settings.stale_after_days` column (Critical)

- **Page:** Global (fires from layout on every page load, originates from Creator page code)
- **Error:** `Failed to fetch settings: Error: Failed to fetch settings: column creator_settings.stale_after_days does not exist`
- **Stack:** `app/layout → app/creator/page → creator_settings table query`
- **Impact:** Console error on every page load. Creator settings fetch fails silently. The Creator page still renders (graceful degradation works), but any feature depending on `stale_after_days` (e.g., content staleness thresholds) won't function.
- **Fix:** Add a Supabase migration to add the `stale_after_days` column to the `creator_settings` table:
  ```sql
  ALTER TABLE creator_settings ADD COLUMN stale_after_days integer DEFAULT 7;
  ```

### BUG-2: Settings page returns 404 (Medium)

- **Page:** `/settings`
- **Steps to reproduce:** Click "Settings" button in the bottom-left sidebar
- **Expected:** Settings page opens (or a settings modal/panel appears)
- **Actual:** Navigates to `/settings` which returns a Next.js 404 page
- **Impact:** Users cannot access application settings. The sidebar "Settings" button is non-functional.
- **Note:** The Ingestion page lives at `/settings/ingestion` (a sub-route), but the parent `/settings` route has no page component.
- **Fix:** Either create `app/settings/page.tsx` as a settings hub, or change the Settings button to open a modal/drawer instead of navigating.

### BUG-3: Excessive `/api/me` calls (Low — Performance)

- **Page:** Global (all page navigations)
- **Observation:** During a single session navigating across 6 pages, `/api/me` was called 20+ times. On the Command Center page alone, it fires at least 6 times per load.
- **Impact:** Unnecessary network overhead. Each call is a round-trip to Supabase auth.
- **Fix:** Cache the `/api/me` response in a React context or SWR/React Query with a reasonable `staleTime` (e.g., 60 seconds), or deduplicate concurrent calls.

### BUG-4: Pillar health badges all show "Critical" (Low — Data/Display)

- **Page:** Command Center left panel (Pillar Health)
- **Observation:** All 9 life pillars display "Critical" health status (Career & Instacart, Ventures & BDHE, Financial, Relationship & Family, Health & Recovery, Content & Brand, Travel & Experiences, Personal Growth, Community & Impact) except Fitness & Athletics which shows "Stable."
- **Impact:** If accurate, this is a data issue (pillar health scoring may not be calibrated). If inaccurate, the health calculation or display logic may have a bug that defaults to "Critical."
- **Likely cause:** The pillar health scoring function may be using placeholder/default values, or the goal progress thresholds are too aggressive.

---

## Pre-Existing Test Failures (Not vNext)

These 2 test failures exist in the current codebase and are unrelated to the vNext changes:

1. **`tests/embedding.test.ts` — chunkText hard-splits**
   - Test expects soft word-boundary splitting; implementation does hard character splits
   - Not a vNext regression

2. **`tests/processors.test.ts` — cleanTranscript capitalization**
   - Test expects `"This is a test"` but gets `"this is a test"` (no auto-capitalization)
   - Not a vNext regression

---

## Pages Tested

| Page | URL | Status | Notes |
|---|---|---|---|
| Command Center | `/` | ✅ Working | Three-panel layout renders correctly. Goal spotlight, priority cards, briefing tab, signals panel all functional. |
| Tasks | `/tasks` | ✅ Working | List view with 58 items, filters (All/Open/Tasks/To-Dos/Notes/Reminders/Done), AI source filters, brain dump input, Kanban toggle present. |
| Brain | `/brain` | ✅ Working | Brain Search with suggested queries, CEO Mode button, "Ask your brain..." input. |
| Knowledge | `/knowledge` | ✅ Working | Knowledge Browser with 33 rows, 7 tabs (Memories/Decisions/Projects/People/Ideas/Meetings/Docs), pagination (2 pages), search. |
| Creator | `/creator` | ✅ Working | Content queue with posts, brand scores, Edit/Publish/Reject buttons. Generate Content button present. |
| Ingestion | `/settings/ingestion` | ✅ Working | Ingestion Pipeline showing 3 active, 4 configured, 0 not set up data sources. |
| Settings | `/settings` | ❌ 404 | See BUG-2 above. |

## API Endpoints Tested

All endpoints returned HTTP 200:

| Endpoint | Method | Status |
|---|---|---|
| `/api/me` | GET | 200 ✅ |
| `/api/tasks?ranked=true&limit=3&state=started,unstarted,backlog` | GET | 200 ✅ |
| `/api/tasks?state=blocked` | GET | 200 ✅ |
| `/api/tasks` | GET | 200 ✅ |
| `/api/briefings` | GET | 200 ✅ |
| `/api/goals?withPillars=true` | GET | 200 ✅ |
| `/api/goals` | GET | 200 ✅ |
| `/api/system-alerts?type=zombie_alert` | GET | 200 ✅ |
| `/api/system-alerts` | GET | 200 ✅ |
| `/api/content-queue?status=draft&ai_audit_passed=false` | GET | 200 ✅ |
| `/api/activity?limit=20` | GET | 200 ✅ |
| `/api/activity?type=agent_dispatched&limit=3` | GET | 200 ✅ |
| `/api/brain/dump` | GET | 200 ✅ |
| `/api/knowledge?table=memories&limit=30&offset=0` | GET | 200 ✅ |

## UI Components Tested

| Component | Status | Notes |
|---|---|---|
| Three-panel layout | ✅ | Left (Pillar Health), Center (Today's Focus / Briefing), Right (Signals & Insights) |
| Today's Focus tab | ✅ | Goal Spotlight with progress bars, High-Leverage Actions with priority scores, Open in Claude / Start / Done / Block buttons |
| Briefing tab | ✅ | Leverage tasks, approve/dismiss buttons, open decisions |
| Signal type filters | ✅ | All / Insights / Proposals / Alerts filters work correctly, content updates on click |
| Brain Dump button | ✅ | Visible and positioned correctly |
| Command bar (Cmd+K) | ✅ | Input present at top |
| Sidebar navigation | ✅ | All nav links work (except Settings — see BUG-2) |
| Task list filters | ✅ | Type filters (All/Open/Tasks/To-Dos/Notes/Reminders/Done) and AI source filters (All AI/Claude/ChatGPT/Gemini) |
| Knowledge tabs | ✅ | All 7 tabs render and are clickable |
| Knowledge pagination | ✅ | Page 1/2 with Prev/Next navigation |

## Vitest Integration Tests

**57 passed, 2 failed** (pre-existing, see above)

The 22 vNext contract tests (`integration-tyleros-vnext.test.ts`) all pass, validating:
- CW-1 ↔ CC-1: Ranked tasks endpoint contract
- CW-2 ↔ CC-10: Dismiss with reason contract
- CW-3 ↔ CC-4: Blocked tasks contract
- CW-4 ↔ CC-4: Zombie alerts contract
- CW-5 ↔ CC-5: Dead-letter alerts contract
- CW-6 ↔ CC-8: Content queue review contract
- CW-7 ↔ CC-8: Content generation contract
- CC-0: GitHub Actions scheduler
- CC-6/7: AI config + callAI wrapper
- CC-2: Skill webhook contract
- Scoring formula validation
- Graceful degradation pattern
