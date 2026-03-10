# Deployment Checklist

## Pre-deploy
- Apply latest Supabase migrations from `supabase/migrations`.
- Configure Vercel project env vars from `.env.example`.
- Set Stripe webhook endpoint to `/api/billing/webhook`.
- Verify `NEXT_PUBLIC_APP_URL` points to production domain.

## Smoke Test
- Sign in with Google and magic link.
- Create planner tasks and confirm they persist after refresh.
- Open agent terminal and send one message.
- Change task model and verify tier enforcement.
- Start a checkout session and confirm redirect.

## Rollback
- Re-deploy previous Vercel deployment.
- Disable incoming Stripe webhooks temporarily if billing errors occur.
- Revert migration only if schema change caused outage (avoid destructive rollback without backup).

## Feature Flags
- `NEXT_PUBLIC_ENABLE_BILLING` (default true)
- `NEXT_PUBLIC_ENABLE_BYOK` (default true)
- `NEXT_PUBLIC_ENABLE_AGENT_CHAT` (default true)
