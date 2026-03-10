# ruhrohhalp MVP (Next.js + Supabase)

Production-oriented MVP app for multi-AI productivity orchestration.

## Stack
- Next.js App Router (TypeScript)
- Supabase (Auth + Postgres + RLS)
- Stripe (subscription checkout + webhook)
- Anthropic / OpenAI / Gemini server-side orchestration

## Local Setup
1. Copy `.env.example` to `.env.local` and fill values.
2. Install dependencies:
   - `npm install`
3. Apply Supabase migration in `supabase/migrations/001_init.sql`.
4. Run:
   - `npm run dev`

## Core APIs
- `POST /api/planner/process`
- `POST /api/agent/chat`
- `GET /api/tasks`
- `PATCH /api/tasks/:id`
- `DELETE /api/tasks/:id`
- `POST /api/billing/checkout`
- `POST /api/billing/webhook`

## Notes
- AI keys are always used server-side.
- BYOK keys are encrypted before persistence.
- Tier/model restrictions and usage limits are enforced in API routes.

## Testing
- Unit: `npm run test`
- E2E: `npm run test:e2e`
- Type check: `npm run typecheck`
