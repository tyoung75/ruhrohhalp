# AI Personal Editor — Implementation Plan

## What This Is

An autonomous media editor that lives inside ruhrohhalp. It watches a Google Drive media folder (with automatic screenshot filtering), understands your weekly posting strategy, selects the right photos/videos for today, edits them (color grade, trim, combine, overlay text), and queues finished drafts in ruhrohhalp's Creator Queue for review. No platform drafts or private uploads — everything stays in ruhrohhalp until you approve it. You review in under 5 minutes: approve (with optional edit prompt) or delete. It learns from both.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    MEDIA INGESTION                          │
│  Google Drive watched folder  ←→  Supabase Storage          │
│  (auto-sync from phone camera roll via Google Photos backup) │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                   DIRECTOR BRAIN                            │
│  Gemini 2.5 Flash (free) — vision + video understanding     │
│  Reads: weekly strategy, content calendar, brand voice,     │
│         today's context (training, calendar, arcs)           │
│  Outputs: Edit Plan (JSON) per post                         │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                  EXECUTION ENGINE                           │
│  FFmpeg (video: trim, combine, transitions, text, LUTs)     │
│  Sharp (photos: crop, color grade, resize, overlay)          │
│  Cloudflare Workers AI (enhance, upscale — free tier)        │
│  [Future: Replicate for style transfer, Runway for effects]  │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│              RUHROHHALP REVIEW QUEUE                        │
│  All drafts land in content_queue with status='editor_draft' │
│  Tyler reviews: media preview + caption + edit reasoning     │
│  Actions: ✅ Approve → publish  |  ✏️ Re-edit (prompt)      │
│           🗑️ Delete  |  💬 Free-text feedback               │
│  Re-edit sends prompt back to Director → Execution → Queue   │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                  FEEDBACK LOOP                              │
│  Approve / Delete / Re-edit signals                          │
│  Free-text notes ("crop was too tight", "wrong vibe")        │
│  Stored in editor_feedback → feeds back into Director        │
└─────────────────────────────────────────────────────────────┘
```

---

## Phase 0: Developer Accounts & API Access (Week 1)

These are prerequisites — nothing else works without them.

### YouTube Developer Account
1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create project: "Tyler Creator OS"
3. Enable **YouTube Data API v3**
4. Create **OAuth 2.0 credentials** (Web application type)
   - Authorized redirect URI: `https://ruhrohhalp.vercel.app/api/auth/callback/google`
   - Scopes needed: `youtube.upload`, `youtube.readonly`, `youtube.force-ssl`
5. Also enable **Google Drive API** in the same project (free, shares the same OAuth consent)
6. Add env vars to `.env.local`:
   ```
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   YOUTUBE_CHANNEL_ID=...
   ```
7. Submit OAuth consent screen for verification (takes 2-4 weeks for sensitive scopes like youtube.upload)

### TikTok Developer Account
1. Go to [TikTok Developer Portal](https://developers.tiktok.com)
2. Register app: "Tyler Creator OS"
3. Request scopes: `user.info.stats`, `video.publish`, `video.upload`
4. **Critical**: Unverified apps limited to 5 creators/day, all posts are private
5. Submit for **audit approval** (2-4 week wait)
6. Add env vars:
   ```
   TIKTOK_CLIENT_KEY=...
   TIKTOK_CLIENT_SECRET=...
   ```

### Google Drive API (for media ingestion)
- Already covered by the Google Cloud project above
- Scopes needed: `drive.readonly` (just reading from a watched folder)
- No additional app — shares OAuth with YouTube

**Estimated time**: 1-2 hours of setup, then 2-4 weeks waiting for approvals.

---

## Phase 1: Media Ingestion Pipeline (Week 1-2)

### Why Google Drive (not Google Photos or Apple Photos)

| Option | Status | Why/Why Not |
|--------|--------|-------------|
| Google Photos API | Dead | Restricted March 2025 — can only access photos YOUR app created, not your library |
| Apple Photos / iCloud API | No web API | Only accessible via native macOS/iOS frameworks. No server-side access. |
| Google Drive API | Works | Full read access to any folder. Google Photos auto-backs up to Drive (or you set up a shared folder). |
| Manual upload to Supabase | Works but friction | You already have this. Good as fallback. |

### Setup: Phone → Google Drive → ruhrohhalp

**On your phone (one-time setup):**
1. Install Google Drive app (if not already)
2. Create a folder: `Creator Media/Inbox`
3. Set your phone's camera to auto-upload to Google Drive (Settings → Backup → Back up to Google Drive)
   - OR: just dump photos/videos into the `Creator Media/Inbox` folder when you want them considered

**Why this is better than iCloud:**
- Google Drive API is mature, well-documented, works server-side
- iCloud has no public API — you'd need a daemon running on your Mac watching a local folder, then uploading to Supabase. More fragile, only works when your Mac is on.
- Google Drive works regardless of what device you're on

**In ruhrohhalp:**

New file: `lib/creator/media-ingest.ts`

```typescript
// Pseudocode — actual implementation in Phase 1
interface MediaAsset {
  id: string;
  drive_file_id: string;
  filename: string;
  mime_type: string;          // image/jpeg, video/mp4, etc.
  thumbnail_url: string;
  full_url: string;           // Supabase Storage URL after download
  created_at: string;         // EXIF or Drive metadata
  location?: { lat: number; lng: number; name?: string };
  duration_seconds?: number;  // for video
  width: number;
  height: number;
  vision_analysis?: {         // populated by Director Brain
    scene: string;            // "gym selfie", "city run", "restaurant meal"
    people_count: number;
    mood: string;             // "energetic", "contemplative", "social"
    quality_score: number;    // 0-1, blur/exposure/composition
    suggested_platforms: string[];
    suggested_pillar: string; // maps to brand pillar
  };
  status: 'new' | 'analyzed' | 'selected' | 'edited' | 'posted' | 'rejected';
  feedback?: string;
}
```

**Sync triggers (no extra Vercel cron needed — Hobby plan only allows 1):**
- **6:00 AM ET** — daily Vercel cron (`/api/cron`) runs the full pipeline
- **12:00 PM, 6:00 PM, 9:30 PM ET** — Cowork scheduled tasks (`/api/creator/publish-cowork`) piggyback the editor pipeline alongside publishing
- **Manual** — "Run Editor" button in Creator tab calls `POST /api/creator/editor-run` (one-click, runs full pipeline or individual steps)

This gives you **4 automatic runs/day** plus on-demand. No Vercel Pro needed.

**Each run:**
1. List new files in `Creator Media/Inbox` since last sync
2. For each file: detect screenshot (auto-filter) → download → upload to Supabase Storage
3. Extract EXIF metadata (date, location, dimensions, camera info)
4. Insert row into `media_assets` table with status='new' (or 'screenshot' if filtered)

### Database: `media_assets` table

```sql
CREATE TABLE media_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  drive_file_id TEXT UNIQUE,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  storage_path TEXT NOT NULL,        -- Supabase Storage path
  thumbnail_path TEXT,
  created_at TIMESTAMPTZ NOT NULL,   -- when photo/video was taken
  ingested_at TIMESTAMPTZ DEFAULT NOW(),
  location JSONB,
  duration_seconds FLOAT,
  width INT,
  height INT,
  vision_analysis JSONB,
  status TEXT DEFAULT 'new',
  feedback TEXT,
  used_in_post_id UUID REFERENCES content_queue(id),
  embedding VECTOR(1024)            -- for semantic search of visual content
);
```

---

## Phase 2: Director Brain — The AI That Decides What To Edit (Week 2-3)

This is the most important piece. The Director looks at your unprocessed media, understands today's strategy, and produces an **Edit Plan** — a structured JSON that tells the Execution Engine exactly what to do.

### Model Choice: Gemini 2.5 Flash (free tier)

**Why Gemini Flash:**
- **Free**: 250 requests/day, 15 req/min — more than enough for 2-5 edit plans/day
- **Native video understanding**: Can watch a 30-second clip and understand what's happening
- **Native image understanding**: Can evaluate composition, content, mood
- **1M token context window**: Can ingest your entire weekly strategy + multiple images in one call
- **Cost if you exceed free tier**: $0.075/1M input tokens (pennies)

**Fallback chain**: Gemini Flash → Groq Llama 4 Scout (free) → Claude (paid, last resort)

### How the Director Works

New file: `lib/creator/director.ts`

**Input context (assembled before each run):**
1. Weekly strategy (from Strategy Agent — already exists)
2. Today's content calendar / recommended posts
3. Active content arcs (Berlin build, Motus launch, etc.)
4. Recent posts (avoid repetition — already exists)
5. Unanalyzed media assets (images/videos from Supabase)
6. Brand voice rules (already codified)
7. Creator feedback history (directives, likes, dislikes — already exists)
8. Current training data from Strava (already connected)

**Step 1: Vision Analysis** (batch — runs on all new media)
```
For each new media asset, send to Gemini Flash:
"Analyze this [image/video]. Return JSON:
 - scene description (specific, not generic)
 - people count
 - mood/energy
 - quality score (0-1) based on blur, exposure, composition
 - suggested platforms (TikTok, IG, Threads, YouTube)
 - suggested brand pillar (running, building, NYC, fitness, travel)
 - any text visible in the image
 - for video: key moments with timestamps"
```
Cost: 0 (free tier, ~1 request per asset)

**Step 2: Post Planning** (runs daily at 5:30 AM, before content generation at 6 AM)
```
Given:
- Analyzed media assets (last 7 days, unused)
- Today's strategy recommendations
- Active arcs
- Recent posts (avoid repetition)
- Brand voice rules

Produce 2-3 Edit Plans, each containing:
- Which media asset(s) to use
- Target platform
- Edit instructions (see Edit Plan schema below)
- Caption draft (following brand voice)
- Why this post, why today (reasoning)
```

### Edit Plan Schema

```typescript
interface EditPlan {
  id: string;
  post_type: 'photo' | 'video' | 'carousel' | 'reel' | 'short';
  target_platform: 'instagram' | 'tiktok' | 'youtube' | 'threads';
  media_assets: string[];     // IDs of assets to use

  // Photo edits
  photo_edits?: {
    crop?: { aspect_ratio: '1:1' | '4:5' | '9:16' | '16:9'; focus_point?: { x: number; y: number } };
    color_grade?: {
      preset: 'warm' | 'cool' | 'moody' | 'bright' | 'film' | 'none';
      brightness?: number;    // -100 to 100
      contrast?: number;
      saturation?: number;
      temperature?: number;
    };
    text_overlay?: {
      text: string;
      position: 'top' | 'center' | 'bottom';
      style: 'minimal' | 'bold' | 'subtitle';
    };
    enhance?: boolean;        // AI upscale/sharpen
  };

  // Video edits
  video_edits?: {
    trim?: { start_seconds: number; end_seconds: number };
    segments?: { asset_id: string; start: number; end: number; order: number }[];
    transition?: 'cut' | 'crossfade' | 'fade_black';
    speed?: { factor: number; segments?: { start: number; end: number; factor: number }[] };
    color_grade?: { preset: string };
    text_overlays?: { text: string; start: number; end: number; position: string }[];
    audio?: {
      keep_original: boolean;
      background_music?: string;  // genre/mood for Mubert
      music_volume?: number;      // 0-1
    };
    output_format: {
      aspect_ratio: '9:16' | '16:9' | '1:1';
      max_duration_seconds: number;
    };
  };

  // Carousel (Instagram)
  carousel_order?: {
    asset_ids: string[];
    reasoning: string;        // Hook → Context → Texture → Closer
  };

  caption: string;
  hashtags?: string[];
  scheduled_time?: string;    // HH:MM ET
  reasoning: string;          // why this edit, why today
  confidence: number;         // 0-1
}
```

---

## Phase 3: Execution Engine — The Hands That Edit (Week 3-4)

### Photo Editing: Sharp (Node.js, already in ecosystem)

```bash
npm install sharp
```

Sharp handles: resize, crop, color manipulation, overlay text, composite images, format conversion. It's fast, runs in Node.js (no Python subprocess needed), and handles everything the Director would ask for in "light" edits.

**Implementation**: `lib/creator/editor/photo-editor.ts`

```typescript
// Pseudocode
async function executePhotoEdit(plan: EditPlan, asset: MediaAsset): Promise<Buffer> {
  let image = sharp(await downloadFromStorage(asset.storage_path));

  if (plan.photo_edits?.crop) {
    image = applyCrop(image, plan.photo_edits.crop, asset.width, asset.height);
  }
  if (plan.photo_edits?.color_grade) {
    image = applyColorGrade(image, plan.photo_edits.color_grade);
  }
  if (plan.photo_edits?.text_overlay) {
    image = applyTextOverlay(image, plan.photo_edits.text_overlay);
  }
  if (plan.photo_edits?.enhance) {
    // Call Cloudflare Workers AI for upscale/enhance
    image = await aiEnhance(image);
  }

  return image.toBuffer();
}
```

### Video Editing: FFmpeg (via fluent-ffmpeg)

```bash
# FFmpeg is available on Vercel via ffmpeg-static
npm install fluent-ffmpeg ffmpeg-static
```

FFmpeg capabilities for your use case:

| Edit Type | FFmpeg Command | Difficulty |
|-----------|---------------|------------|
| Trim clip | `-ss 5 -to 15` | Trivial |
| Combine clips | `concat` demuxer | Easy |
| Crossfade transition | `xfade` filter | Medium |
| Text overlay | `drawtext` filter | Easy |
| Color grade (LUT) | `lut3d` filter | Easy (pre-built LUT files) |
| Speed ramp | `setpts` filter | Medium |
| Aspect ratio crop | `crop` filter | Easy |
| Add background music | `amix` filter | Easy |
| Ken Burns (photo → video) | `zoompan` filter | Medium |

**Implementation**: `lib/creator/editor/video-editor.ts`

```typescript
async function executeVideoEdit(plan: EditPlan, assets: MediaAsset[]): Promise<string> {
  // Download assets from Supabase Storage to tmp
  // Build FFmpeg command chain from plan.video_edits
  // Execute FFmpeg
  // Upload result to Supabase Storage
  // Return storage path
}
```

**LUT Presets** (pre-built color grading files):
- `warm.cube` — golden hour feel (good for running/outdoor content)
- `cool.cube` — clean blue tones (good for gym/tech content)
- `moody.cube` — desaturated with lifted blacks (good for NYC/street)
- `film.cube` — analog film emulation (good for travel/food)
- `bright.cube` — lifted shadows, vivid (good for lifestyle)

These are ~10KB files. Store in `public/luts/` or Supabase Storage.

### Serverless Constraints

Vercel serverless functions have a **10-second timeout** on Hobby and **60-second** on Pro. Video editing will exceed this.

**Solutions (pick one):**
1. **Vercel Pro** ($20/mo) — 60s functions, enough for clips under 60 seconds
2. **Supabase Edge Functions** — 60s timeout, can call FFmpeg via Wasm
3. **Background job via Inngest/Trigger.dev** (free tier) — offload to a long-running worker
4. **Self-hosted worker on Railway/Fly.io** ($5/mo) — a tiny container that just runs FFmpeg jobs from a queue

**Recommendation**: Use **Trigger.dev** (free for 10K runs/mo). It integrates with Next.js, gives you durable execution, and you're already on Vercel. The flow:

```
Cron (5:30 AM) → Director produces Edit Plans →
  Insert into edit_queue table →
  Trigger.dev job picks up each plan →
  Downloads media, runs FFmpeg/Sharp, uploads result →
  Updates content_queue with edited media attached
```

---

## Phase 4: ruhrohhalp Review Queue (Week 4-5)

### Design Decision: No Platform Drafts

All edited content stays in ruhrohhalp's content_queue with status `editor_draft` until Tyler explicitly approves. No private uploads, no platform drafts. Benefits:
- Zero API calls wasted on content Tyler might delete
- Full control — nothing touches a platform until Tyler says so
- Simpler architecture — reuses existing publish flow after approval

### Review Flow

```
Director produces Edit Plan
  → Execution Engine edits media
  → Insert into content_queue:
      status: 'editor_draft'
      media_urls: [edited media Supabase URLs]
      body: caption
      context_snapshot: { edit_plan_id, original_assets, edits_applied }
  → Tyler reviews in Creator Queue UI
```

### Review Actions

```
┌─────────────────────────────────────────────┐
│ 📷 Instagram Draft — Mar 27, 7:30 AM        │
│                                              │
│ [Edited Photo/Video Preview]                 │
│                                              │
│ Caption: "5am. 455 off the floor.            │
│ instacart standup at 11."                    │
│                                              │
│ Edits applied: warm color grade, 4:5 crop    │
│ Director reasoning: "Deadlift PR matches     │
│ Berlin build arc. Morning gym + work day      │
│ contrast is on-brand."                       │
│                                              │
│ Confidence: 0.87  |  Voice: 0.92            │
│                                              │
│ [✅ Approve]  [🗑️ Delete]                    │
│                                              │
│ Re-edit prompt:                              │
│ [make the color warmer, crop tighter_] [Go]  │
│                                              │
│ Feedback: [________________________] [Send]  │
└─────────────────────────────────────────────┘
```

**Approve** → status changes to `queued`, existing publish pipeline picks it up at next scheduled window
**Delete** → status changes to `rejected`, logged as importance-8 negative signal
**Re-edit** → sends prompt back to Director with original assets + feedback → re-runs Execution Engine → new `editor_draft` replaces old one
**Feedback** → free-text stored in editor_feedback, embedded in semantic memory
```

---

## Phase 5: Feedback Loop (Week 5)

### Signals (extends existing system)

| Signal | Weight | What It Teaches |
|--------|--------|-----------------|
| ✅ Posted | importance 4 | "This edit style works" |
| 🗑️ Deleted | importance 8 | "Don't do this again" — strongest signal |
| ✏️ Caption edited before posting | importance 6 | "Edits were good, voice was off" |
| Free-text feedback | importance 7 | Specific correction: "too much saturation", "crop cut off my face" |
| Edit directive | importance 9 | Standing rule: "Never use cool color grade on food photos" |

### How Feedback Flows Back

```typescript
// New table: editor_feedback
interface EditorFeedback {
  id: string;
  edit_plan_id: string;
  action: 'posted' | 'deleted' | 'edited_caption' | 'note';
  note?: string;               // free text
  created_at: string;
}

// Director Brain prompt includes last 30 days of feedback:
// "Posts you edited that Tyler DELETED (learn what NOT to do):
//   - [deleted] warm grade on gym mirror selfie. Tyler said: 'too orange, gym lighting is already warm'
//   - [deleted] combined two running clips with crossfade. Tyler said: 'just use the single best clip'
//
// Posts Tyler POSTED (learn what works):
//   - [posted] moody grade on NYC street run. No feedback (implicit approval).
//   - [posted] 4:5 crop on restaurant meal, bright grade. Tyler said: 'perfect, always do food like this'"
```

---

## Phase 6: Scaling from Light → Heavy Edits (Future)

The architecture is designed so the Director Brain outputs the same Edit Plan JSON regardless of whether the execution is simple or complex. To scale up:

### Level 1 (Launch — $0/mo)
- Sharp for photos
- FFmpeg for video (trim, combine, basic transitions, text, LUTs)
- Gemini Flash free tier for Director

### Level 2 (Month 2 — ~$10/mo)
- Add Replicate for AI photo enhancement (better upscaling, face retouching)
- Add pre-built LUT library (20+ color grades)
- Add beat detection via librosa for music-synced cuts

### Level 3 (Month 3+ — ~$30/mo)
- Add Runway/Pika for AI-generated transitions and effects
- Add motion graphics templates (lower thirds, animated text)
- Add Mubert for auto-generated royalty-free background music
- Speed ramps synced to music beats

The Director just needs to learn new options in the Edit Plan schema. The execution engine adds new handlers. No architectural changes needed.

---

## Implementation Order & Time Estimates

| Phase | What | Time | Blockers |
|-------|------|------|----------|
| **0** | Developer accounts (YouTube, TikTok) | 2 hours setup + 2-4 weeks approval wait | None — do this first |
| **1** | Google Drive media ingestion | 3-4 days | Google OAuth (shared with YouTube) |
| **2** | Director Brain (Gemini Flash) | 3-4 days | Phase 1 (needs media to analyze) |
| **3** | Photo editor (Sharp) + Video editor (FFmpeg) | 4-5 days | Phase 2 (needs edit plans) |
| **4** | Draft delivery to platforms | 2-3 days | Phase 3 + platform API approvals |
| **5** | Feedback loop + learning | 2 days | Phase 4 |
| **6** | Scale to heavier edits | Ongoing | Phases 1-5 complete |

**Total to MVP**: ~3 weeks of active development (can overlap with the 2-4 week API approval wait).

---

## New Files to Create

```
lib/creator/
├── media-ingest.ts          # Google Drive sync → Supabase Storage
├── director.ts              # Gemini Flash vision analysis + edit planning
├── editor/
│   ├── photo-editor.ts      # Sharp-based photo editing
│   ├── video-editor.ts      # FFmpeg-based video editing
│   ├── luts/                # Color grading LUT files
│   │   ├── warm.cube
│   │   ├── cool.cube
│   │   ├── moody.cube
│   │   ├── film.cube
│   │   └── bright.cube
│   └── templates/           # Text overlay templates, fonts
├── draft-delivery.ts        # Platform-specific draft creation
└── editor-feedback.ts       # Feedback collection + Director prompt assembly

app/api/creator/
├── media-sync/route.ts      # Cron: sync from Google Drive
├── director/route.ts        # Cron: run Director Brain
├── edit/route.ts            # Trigger.dev: execute edit plans
└── draft/route.ts           # Create/publish/delete drafts
```

---

## New Database Tables

```sql
-- Media library
CREATE TABLE media_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  drive_file_id TEXT UNIQUE,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  thumbnail_path TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  ingested_at TIMESTAMPTZ DEFAULT NOW(),
  location JSONB,
  duration_seconds FLOAT,
  width INT,
  height INT,
  vision_analysis JSONB,
  status TEXT DEFAULT 'new',
  used_in_post_id UUID,
  embedding VECTOR(1024)
);

-- Edit plans produced by Director
CREATE TABLE edit_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan JSONB NOT NULL,          -- full EditPlan JSON
  status TEXT DEFAULT 'pending', -- pending, processing, completed, failed
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  output_storage_path TEXT,     -- edited media result
  content_queue_id UUID,        -- linked to content_queue entry
  director_reasoning TEXT,
  confidence FLOAT
);

-- Editor-specific feedback (extends existing creator_feedback)
CREATE TABLE editor_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  edit_plan_id UUID REFERENCES edit_plans(id),
  action TEXT NOT NULL,          -- posted, deleted, edited_caption, note
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Cost Summary

| Component | Monthly Cost |
|-----------|-------------|
| Gemini 2.5 Flash (Director Brain) | $0 (free tier: 250 req/day) |
| Groq Llama 4 Scout (safety audit — existing) | $0 |
| FFmpeg + Sharp (editing) | $0 (open source) |
| Cloudflare Workers AI (image enhance) | $0 (10K neurons/day free) |
| Trigger.dev (background jobs) | $0 (10K runs/mo free) |
| Google Drive API | $0 |
| YouTube Data API | $0 (10K units/day free) |
| TikTok API | $0 |
| Supabase Storage (media) | $0 (1GB free, ~$0.021/GB after) |
| **Total at launch** | **$0/mo** |
| *Optional: Vercel Pro for 60s functions* | *$20/mo* |
| *Optional: Replicate for AI enhance* | *~$5/mo* |

---

## What Already Exists vs. What's New

| Component | Status |
|-----------|--------|
| Content generation (text) | ✅ Exists — Claude-powered, 5 posts/day |
| Safety audit | ✅ Exists — Groq Llama Scout |
| 8-factor scoring + queue | ✅ Exists |
| Publishing to Threads | ✅ Exists |
| Publishing to Instagram | ✅ Exists |
| Strava / Calendar context | ✅ Exists |
| Brand voice rules | ✅ Exists |
| Feedback loop (👍👎🗑️) | ✅ Exists |
| Strategy Agent | ✅ Exists |
| **Google Drive media sync** | 🆕 New |
| **Director Brain (vision)** | 🆕 New |
| **Photo editor (Sharp)** | 🆕 New |
| **Video editor (FFmpeg)** | 🆕 New |
| **Edit Plan schema** | 🆕 New |
| **Draft delivery (YT, TikTok)** | 🆕 New |
| **Editor-specific feedback** | 🆕 New |
| **YouTube OAuth + publishing** | 🆕 New |
| **TikTok publishing** | 🆕 New |
