# TikTok & YouTube Developer Account Setup

Everything in ruhrohhalp is wired up — you just need the API credentials. Follow these steps, paste the env vars into Vercel, and the system goes live.

---

## Part 1: TikTok Developer Account

### Step 1: Register as a Developer
1. Go to [developers.tiktok.com](https://developers.tiktok.com/)
2. Log in with your TikTok account (@tyler_.young)
3. Click **"Manage apps"** → **"Connect an app"**

### Step 2: Create Your App
1. App name: `ruhrohhalp` (or "TylerOS Creator")
2. Category: **Entertainment / Content Creation**
3. Platform: **Web**
4. Description: "Personal creator analytics and content management system"

### Step 3: Configure Products
Add these products to your app:

- **Login Kit** — Required for OAuth
  - Redirect URI: `https://www.ruhrohhalp.com/api/auth/tiktok/callback`

- **Content Posting API** — For future auto-publishing
  - Not needed immediately; add when ready

### Step 4: Request Scopes
Under "Manage scopes", request:
- `user.info.basic` — Display name, avatar
- `user.info.stats` — Follower count, video count, likes
- `video.list` — List your videos
- `video.insights` — Per-video view/like/comment/share counts

### Step 5: Submit for Review
TikTok reviews developer apps before granting API access. This typically takes **2-5 business days**.

In the review submission:
- Use case: "Personal analytics dashboard for my own creator account"
- Attach a screenshot of ruhrohhalp's dashboard
- Note: "Single-user application — only accessing my own account data"

### Step 6: Get Credentials
Once approved, go to your app settings and copy:
- **Client Key** → `TIKTOK_CLIENT_KEY`
- **Client Secret** → `TIKTOK_CLIENT_SECRET`

---

## Part 2: YouTube / Google Developer Account

### Step 1: Google Cloud Console
1. Go to [console.cloud.google.com](https://console.cloud.google.com/)
2. Create a new project (or use your existing BDHE project)
3. Name: `ruhrohhalp` or `BDHE Creator OS`

### Step 2: Enable APIs
Go to **APIs & Services → Library** and enable:
- **YouTube Data API v3** — Video stats, channel info, uploads list
- **YouTube Analytics API** — Audience demographics, watch time, traffic sources, revenue

### Step 3: Create API Key (for public data)
1. Go to **APIs & Services → Credentials**
2. Click **"Create Credentials" → "API Key"**
3. Restrict the key:
   - Application restrictions: **HTTP referrers** → `https://www.ruhrohhalp.com/*`
   - API restrictions: **YouTube Data API v3** only
4. Copy → `YOUTUBE_API_KEY`

### Step 4: Create OAuth 2.0 Client (for private data)
1. **APIs & Services → Credentials → Create Credentials → OAuth client ID**
2. If prompted, configure the **OAuth consent screen** first:
   - User type: **External** (you can switch to Internal later if using Google Workspace)
   - App name: `ruhrohhalp`
   - User support email: tylerjyoung5@gmail.com
   - Authorized domains: `ruhrohhalp.com`
   - Scopes: Add `youtube.readonly` and `yt-analytics.readonly`
   - Test users: Add `tylerjyoung5@gmail.com`
3. Create the OAuth client:
   - Application type: **Web application**
   - Name: `ruhrohhalp Creator OS`
   - Authorized redirect URIs: `https://www.ruhrohhalp.com/api/auth/youtube/callback`
4. Copy:
   - **Client ID** → `YOUTUBE_CLIENT_ID`
   - **Client Secret** → `YOUTUBE_CLIENT_SECRET`

### Step 5: Get Your Channel ID
1. Go to [youtube.com](https://youtube.com) → Your channel
2. The URL will be `youtube.com/channel/UC...` — that's your channel ID
3. Or: YouTube Studio → Settings → Channel → Advanced settings → Channel ID
4. Copy → `YOUTUBE_CHANNEL_ID`

---

## Part 3: Add Environment Variables to Vercel

Go to your [Vercel project settings](https://vercel.com/tyoung75s-projects/ruhrohhalp/settings/environment-variables) and add:

```
# TikTok
TIKTOK_CLIENT_KEY=<from Step 6 above>
TIKTOK_CLIENT_SECRET=<from Step 6 above>

# YouTube
YOUTUBE_API_KEY=<from Step 3 above>
YOUTUBE_CLIENT_ID=<from Step 4 above>
YOUTUBE_CLIENT_SECRET=<from Step 4 above>
YOUTUBE_CHANNEL_ID=<from Step 5 above>
```

Set these for **Production**, **Preview**, and **Development** environments.

Then redeploy: `vercel --prod` or push a commit.

---

## Part 4: Connect Your Accounts

Once env vars are set and deployed:

1. **TikTok**: Visit `https://www.ruhrohhalp.com/api/auth/tiktok` — this redirects to TikTok's OAuth screen. Approve, and your token is saved.
2. **YouTube**: Visit `https://www.ruhrohhalp.com/api/auth/youtube` — this redirects to Google's OAuth screen. Approve, and your token is saved.

Both will redirect back to `/settings/integrations` with a success message.

---

## What Happens After Connection

Once tokens are stored, the existing daily cron job automatically:

1. **Collects analytics** — Pulls views, likes, comments, shares for every video/post from the last 30 days
2. **Syncs external posts** — Imports any videos/posts you uploaded directly through TikTok/YouTube apps
3. **Pulls extended analytics** — Audience demographics, content format trends, traffic sources, revenue (YouTube)
4. **Refreshes tokens** — Auto-refreshes tokens 7 days before expiry
5. **Feeds the strategy agent** — All analytics flow into the AI strategy engine, which generates:
   - Content recommendations optimized by platform performance
   - Format-specific suggestions (Shorts vs long-form based on your actual data)
   - Posting time recommendations based on your audience's peak hours
   - Revenue optimization insights (YouTube)
6. **Generates content** — The content agent uses strategy + analytics to produce ideas and scripts tailored to what actually works on each platform

---

## API Quota Notes

**TikTok:**
- Rate limit: ~100 requests per day per user for video.list
- Token refresh: access_token expires in ~24h, refresh_token in ~365 days

**YouTube:**
- Data API quota: 10,000 units/day (channels.list = 1 unit, videos.list = 1 unit)
- Analytics API: Separate quota, very generous for single-channel use
- Access token expires in 1 hour; refresh token is long-lived (requires `access_type=offline`)
