# TylerOS vNext — Build Progress

## Backend (Claude Code)

| Item | Description | Status | Commit |
|------|-------------|--------|--------|
| 0 | GitHub Actions scaffold + internal API auth | done | — |
| 1 | task_priority_score + scoring engine | pending | — |
| 2 | Skill webhook contract endpoints | pending | — |
| 3 | Leverage reason enrichment | pending | — |
| 4 | Blocker detection + zombie scan | pending | — |
| 5 | job_runs state machine | pending | — |
| 6 | Unified AI provider wrapper | pending | — |
| 7 | Goal progress signals | pending | — |
| 8 | Platform Intelligence Agent | pending | — |
| 8b | Content handoff endpoint | pending | — |
| 8c | Content Performance Brain | pending | — |
| 9 | Outcome telemetry | pending | — |
| 10 | Dismissal feedback loop | pending | — |

## Cowork Ready

- [x] `/api/internal/briefing` — stub (POST `{type: "morning"|"evening"|"weekly"}`)
- [x] `/api/internal/score-tasks` — stub
- [x] `/api/internal/embed-chunks` — stub
- [x] `/api/internal/content-handoff` — stub
- [x] `/api/internal/zombie-scan` — stub
- [x] `/api/internal/snapshot-metrics` — stub
- [x] Auth: `Authorization: Bearer {RUHROHHALP_SECRET}` on all internal routes
- [x] 8 GitHub Actions workflows with `workflow_dispatch` support
- [x] Vercel cron removed from `vercel.json`
