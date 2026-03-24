# ruhrohhalp Phase 5: Life Pillars + Phase 1 Fixes

## What's in this delivery

### 1. Database Migration: `005_goals_and_pillars.sql`
New tables: `pillars`, `goals`, `goal_signals`, `goal_checkins`
- Copy to `ruhrohhalp/supabase/migrations/005_goals_and_pillars.sql`
- Run: `npx supabase db push`

### 2. Seed Data: `seed_pillars_and_goals.sql`
10 life pillars and 24 goals with science-backed methods.
- Run AFTER the migration succeeds
- Execute via Supabase SQL Editor or `psql`
- Uses Tyler's email to find user ID automatically

### 3. Phase 1 Code Fixes (in `phase1-fixes/`)

**Copy each file to its destination:**

| File | Destination | What it fixes |
|------|-------------|---------------|
| `command-bar.tsx` | `components/command-bar.tsx` | Sends `{ input }` instead of `{ command }` — commands actually work now |
| `NavSidebar.tsx` | `components/NavSidebar.tsx` | Removes Free tier button, removes pricing/tier props |
| `LayoutShell.tsx` | `components/LayoutShell.tsx` | Stops passing tier/onOpenPricing to NavSidebar |
| `ceo-route.ts` | `app/api/brain/ceo/route.ts` | Filters out done/cancelled tasks, adds goal context to CEO briefing |

### Deployment order

```bash
# 1. Copy migration
cp 005_goals_and_pillars.sql ruhrohhalp/supabase/migrations/

# 2. Push migration
cd ruhrohhalp && npx supabase db push

# 3. Seed pillars and goals (via Supabase SQL Editor or psql)

# 4. Copy fixed files
cp phase1-fixes/command-bar.tsx ruhrohhalp/components/
cp phase1-fixes/NavSidebar.tsx ruhrohhalp/components/
cp phase1-fixes/LayoutShell.tsx ruhrohhalp/components/
cp phase1-fixes/ceo-route.ts ruhrohhalp/app/api/brain/ceo/route.ts

# 5. Build and deploy
cd ruhrohhalp && npm run build && git add -A && git commit -m "Phase 5: life pillars + goals + Phase 1 UX fixes" && git push && vercel --prod
```

## The 10 Life Pillars

1. **Fitness & Athletics** — Marathon, strength, HYROX, VO2max
2. **Career & Instacart** — Director-level leadership, executive presence
3. **Ventures & BDHE** — Motus, Iron Passport, ruhrohhalp, thestayed
4. **Financial** — Portfolio growth, BDHE revenue, tax optimization
5. **Relationship & Family** — Clarissa, Wesley, brother partnership
6. **Health & Recovery** — Sleep, nutrition, stress management
7. **Content & Brand** — Social posting, brand deals, narrative arcs
8. **Travel & Experiences** — Train travel, Iron Passport reviews, Europe arc
9. **Personal Growth** — Habit systems, continuous learning loop
10. **Community & Impact** — Open-source TYBRID, mentorship

## What the CEO Mode now does differently

Before: Queried brain memories with no task filtering → showed completed items, no goal awareness
After: Fetches active tasks + active goals from DB → injects real context into the LLM prompt → frames recommendations against your actual goals and pillars

## Next phases

- **Phase 6**: Goals UI page in sidebar + briefing restructured to report against goals
- **Phase 7**: Signal ingestion (Gmail, Calendar, social, purchases → goal_signals table)
- **Phase 8**: Weekly synthesis showing goal velocity and pillar balance
