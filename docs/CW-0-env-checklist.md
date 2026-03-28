# CW-0: Environment Configuration Checklist

## GitHub Repository Secrets (github.com/tyoung75/ruhrohhalp → Settings → Secrets)
- [x] `RUHROHHALP_SECRET` — ✅ Added (same value as CRON_SECRET)
- [x] `CRON_SECRET` — ✅ Pre-existing

## GitHub Actions Variables (Settings → Variables → Actions)
- [ ] `RUHROHHALP_URL` — Value: `https://www.ruhrohhalp.com`
  - **NOTE:** Browser automation couldn't add this due to CSRF. Tyler needs to add manually.
  - **NOTE:** Claude Code workflow YAML files should use `${{ vars.RUHROHHALP_URL }}` (not `secrets.`).
  - Alternative: Claude Code can hardcode the URL in workflows since it's not sensitive.

## Vercel Environment Variables — MISSING (need manual add)
All values exist in `.env.local`. Add these in Vercel dashboard → Settings → Environment Variables:

| Variable | Status | Notes |
|---|---|---|
| `TIKTOK_CLIENT_KEY` | ✅ Exists | |
| `TIKTOK_CLIENT_SECRET` | ✅ Exists | |
| `GOOGLE_DRIVE_MEDIA_FOLDER_ID` | ✅ Exists | |
| `GEMINI_API_KEY` | ✅ Exists | |
| `GOOGLE_CLIENT_ID` | ✅ Exists | |
| `YOUTUBE_CHANNEL_ID` | ✅ Exists | |
| `YOUTUBE_API_KEY` | ✅ Exists | |
| `YOUTUBE_CLIENT_SECRET` | ✅ Exists | |
| `YOUTUBE_CLIENT_ID` | ✅ Exists | |
| `STRAVA_REFRESH_TOKEN` | ✅ Exists | |
| `RUHROHHALP_SECRET` | ❌ MISSING | Same value as `CRON_SECRET` in .env.local |
| `NEXT_PUBLIC_SUPABASE_URL` | ❌ MISSING | Copy from .env.local |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ❌ MISSING | Copy from .env.local |
| `SUPABASE_SERVICE_ROLE_KEY` | ❌ MISSING | Copy from .env.local |
| `ANTHROPIC_API_KEY` | ❌ MISSING | Copy from .env.local |
| `OPENAI_API_KEY` | ❌ MISSING | Copy from .env.local |
| `HF_API_TOKEN` | ❌ MISSING | Copy from .env.local |
| `THREADS_APP_ID` | ❌ MISSING | Copy from .env.local |
| `THREADS_APP_SECRET` | ❌ MISSING | Copy from .env.local |
| `GOOGLE_CLIENT_SECRET` | ❌ MISSING | Copy from .env.local |
| `GROQ_API_KEY` | ❌ MISSING | Not in .env.local either — needed for Llama 4 Scout brand voice audit |
| `CRON_SECRET` | ❌ MISSING | Copy from .env.local — needed for GHA webhook auth |

**Quick add method:** In Vercel dashboard, use "Import .env File" if available, or add each manually.

## Meta Developer Portal
- [ ] Add OAuth redirect URI: `https://www.ruhrohhalp.com/api/auth/threads/callback`
- [ ] Add OAuth redirect URI: `https://www.ruhrohhalp.com/api/auth/instagram/callback`
- [ ] Verify Instagram permissions: `instagram_basic`, `instagram_content_publish`, `instagram_manage_insights`, `pages_show_list`, `pages_read_engagement`
- [ ] Submit for Meta App Review if not already done

## TikTok Developer Portal
- [ ] Submit app for review (App ID: 7622010109873309703)
- [ ] Submission reason: "Initial submission. ruhrohhalp uses Login Kit for TikTok OAuth login and displays user profile info and video analytics in a creator dashboard."
