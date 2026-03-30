-- Weekly Dev Log pipeline tables

CREATE TABLE IF NOT EXISTS public.blog_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  week_start DATE NOT NULL,
  week_end DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending_review', 'published', 'expired')),
  title TEXT NOT NULL,
  slug TEXT,
  markdown TEXT NOT NULL,
  teaser TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_activity JSONB NOT NULL DEFAULT '{}'::jsonb,
  github_pr_url TEXT,
  github_pr_number INTEGER,
  gmail_draft_id TEXT,
  gmail_message_id TEXT,
  published_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_blog_drafts_status ON public.blog_drafts(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_blog_drafts_week ON public.blog_drafts(week_start DESC);

CREATE TABLE IF NOT EXISTS public.blog_edit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id UUID NOT NULL REFERENCES public.blog_drafts(id) ON DELETE CASCADE,
  original_markdown TEXT NOT NULL,
  edited_markdown TEXT NOT NULL,
  diff_summary TEXT,
  extracted_patterns JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_blog_edit_log_draft ON public.blog_edit_log(draft_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.blog_style_memory (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE,
  patterns JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_from_draft_id UUID REFERENCES public.blog_drafts(id)
);

CREATE TABLE IF NOT EXISTS public.blog_performance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id UUID NOT NULL REFERENCES public.blog_drafts(id) ON DELETE CASCADE,
  metric_date DATE NOT NULL,
  views INTEGER,
  avg_time_seconds NUMERIC,
  ctr NUMERIC,
  social_shares INTEGER,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (draft_id, metric_date)
);

CREATE INDEX IF NOT EXISTS idx_blog_performance_draft_date ON public.blog_performance(draft_id, metric_date DESC);

ALTER TABLE public.blog_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blog_edit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blog_style_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blog_performance ENABLE ROW LEVEL SECURITY;
