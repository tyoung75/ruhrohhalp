-- TYOS-277: TylerOS knowledge layer tables
-- pgvector is already enabled on this Supabase instance

-------------------------------------------------------------------------------
-- memories: Semantic memory store with vector embeddings
-------------------------------------------------------------------------------
create table if not exists public.memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  content text not null,
  summary text not null default '',
  category text not null default 'general'
    check (category in ('general','personal','work','technical','financial','health')),
  source text not null default 'manual'
    check (source in ('manual','conversation','meeting','document','task')),
  source_id uuid,
  tags text[] not null default '{}',
  embedding vector(1536),
  importance integer not null default 5 check (importance between 1 and 10),
  last_accessed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_memories_user_created on public.memories(user_id, created_at desc);
create index if not exists idx_memories_user_category on public.memories(user_id, category);
create index if not exists idx_memories_embedding on public.memories using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-------------------------------------------------------------------------------
-- decisions: Decision log with context and outcomes
-------------------------------------------------------------------------------
create table if not exists public.decisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text not null default '',
  context text not null default '',
  reasoning text not null default '',
  outcome text not null default '',
  alternatives text[] not null default '{}',
  status text not null default 'pending'
    check (status in ('pending','made','revisiting','reversed')),
  category text not null default 'general'
    check (category in ('general','career','technical','financial','personal','business')),
  decided_at timestamptz,
  review_at timestamptz,
  project_id uuid,
  tags text[] not null default '{}',
  embedding vector(1536),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_decisions_user_created on public.decisions(user_id, created_at desc);
create index if not exists idx_decisions_user_status on public.decisions(user_id, status);
create index if not exists idx_decisions_embedding on public.decisions using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-------------------------------------------------------------------------------
-- projects: Project tracking
-------------------------------------------------------------------------------
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  slug text not null default '',
  description text not null default '',
  status text not null default 'active'
    check (status in ('active','paused','completed','archived')),
  priority text not null default 'medium'
    check (priority in ('high','medium','low')),
  goals text[] not null default '{}',
  due_date timestamptz,
  completed_at timestamptz,
  tags text[] not null default '{}',
  embedding vector(1536),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_projects_user_status on public.projects(user_id, status);
create index if not exists idx_projects_embedding on public.projects using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-------------------------------------------------------------------------------
-- people: Contact / relationship management
-------------------------------------------------------------------------------
create table if not exists public.people (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  email text,
  phone text,
  company text,
  role text not null default '',
  relationship text not null default 'other'
    check (relationship in ('colleague','client','friend','family','mentor','mentee','other')),
  notes text not null default '',
  commitments text[] not null default '{}',
  last_contact_at timestamptz,
  tags text[] not null default '{}',
  embedding vector(1536),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_people_user_name on public.people(user_id, name);
create index if not exists idx_people_embedding on public.people using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-------------------------------------------------------------------------------
-- ideas: Idea capture and incubation
-------------------------------------------------------------------------------
create table if not exists public.ideas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text not null default '',
  source_type text not null default 'typed'
    check (source_type in ('typed','voice_memo','note','import')),
  status text not null default 'captured'
    check (status in ('captured','exploring','validated','parked','discarded','promoted')),
  category text not null default 'general'
    check (category in ('general','product','business','creative','technical','personal')),
  project_id uuid,
  tags text[] not null default '{}',
  embedding vector(1536),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_ideas_user_status on public.ideas(user_id, status);
create index if not exists idx_ideas_embedding on public.ideas using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-------------------------------------------------------------------------------
-- meetings: Meeting notes with attendees and action items
-------------------------------------------------------------------------------
create table if not exists public.meetings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text not null default '',
  summary text not null default '',
  notes text not null default '',
  action_items text[] not null default '{}',
  extracted_task_ids uuid[] not null default '{}',
  attendee_ids uuid[] not null default '{}',
  project_id uuid,
  calendar_event_id text,
  meeting_at timestamptz not null default now(),
  duration_minutes integer,
  location text not null default '',
  tags text[] not null default '{}',
  embedding vector(1536),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_meetings_user_date on public.meetings(user_id, meeting_at desc);
create index if not exists idx_meetings_embedding on public.meetings using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-------------------------------------------------------------------------------
-- documents: Document metadata and content store
-------------------------------------------------------------------------------
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  content text not null default '',
  doc_type text not null default 'note'
    check (doc_type in ('note','article','template','reference','spec','journal')),
  status text not null default 'draft'
    check (status in ('draft','published','archived')),
  drive_file_id text,
  chunk_index integer not null default 0,
  parent_doc_id uuid,
  project_id uuid,
  tags text[] not null default '{}',
  embedding vector(1536),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_documents_user_type on public.documents(user_id, doc_type);
create index if not exists idx_documents_embedding on public.documents using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-------------------------------------------------------------------------------
-- Add project_id FK to existing tasks table
-------------------------------------------------------------------------------
alter table public.tasks add column if not exists project_id uuid;
alter table public.tasks add column if not exists delegated_to text;
alter table public.tasks add column if not exists is_open_loop boolean not null default false;
alter table public.tasks add column if not exists thread_ref text;

-------------------------------------------------------------------------------
-- Foreign keys for project_id references (deferred so tables exist first)
-------------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'fk_tasks_project') then
    alter table public.tasks add constraint fk_tasks_project foreign key (project_id) references public.projects(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fk_decisions_project') then
    alter table public.decisions add constraint fk_decisions_project foreign key (project_id) references public.projects(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fk_ideas_project') then
    alter table public.ideas add constraint fk_ideas_project foreign key (project_id) references public.projects(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fk_meetings_project') then
    alter table public.meetings add constraint fk_meetings_project foreign key (project_id) references public.projects(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fk_documents_project') then
    alter table public.documents add constraint fk_documents_project foreign key (project_id) references public.projects(id) on delete set null;
  end if;
end $$;

-------------------------------------------------------------------------------
-- updated_at triggers
-------------------------------------------------------------------------------
drop trigger if exists trg_memories_updated_at on public.memories;
create trigger trg_memories_updated_at before update on public.memories for each row execute function public.set_updated_at();
drop trigger if exists trg_decisions_updated_at on public.decisions;
create trigger trg_decisions_updated_at before update on public.decisions for each row execute function public.set_updated_at();
drop trigger if exists trg_projects_updated_at on public.projects;
create trigger trg_projects_updated_at before update on public.projects for each row execute function public.set_updated_at();
drop trigger if exists trg_people_updated_at on public.people;
create trigger trg_people_updated_at before update on public.people for each row execute function public.set_updated_at();
drop trigger if exists trg_ideas_updated_at on public.ideas;
create trigger trg_ideas_updated_at before update on public.ideas for each row execute function public.set_updated_at();
drop trigger if exists trg_meetings_updated_at on public.meetings;
create trigger trg_meetings_updated_at before update on public.meetings for each row execute function public.set_updated_at();
drop trigger if exists trg_documents_updated_at on public.documents;
create trigger trg_documents_updated_at before update on public.documents for each row execute function public.set_updated_at();

-------------------------------------------------------------------------------
-- Row Level Security
-------------------------------------------------------------------------------
alter table public.memories enable row level security;
alter table public.decisions enable row level security;
alter table public.projects enable row level security;
alter table public.people enable row level security;
alter table public.ideas enable row level security;
alter table public.meetings enable row level security;
alter table public.documents enable row level security;

-- memories
drop policy if exists "memories_select_own" on public.memories;
create policy "memories_select_own" on public.memories for select using (auth.uid() = user_id);
drop policy if exists "memories_insert_own" on public.memories;
create policy "memories_insert_own" on public.memories for insert with check (auth.uid() = user_id);
drop policy if exists "memories_update_own" on public.memories;
create policy "memories_update_own" on public.memories for update using (auth.uid() = user_id);
drop policy if exists "memories_delete_own" on public.memories;
create policy "memories_delete_own" on public.memories for delete using (auth.uid() = user_id);

-- decisions
drop policy if exists "decisions_select_own" on public.decisions;
create policy "decisions_select_own" on public.decisions for select using (auth.uid() = user_id);
drop policy if exists "decisions_insert_own" on public.decisions;
create policy "decisions_insert_own" on public.decisions for insert with check (auth.uid() = user_id);
drop policy if exists "decisions_update_own" on public.decisions;
create policy "decisions_update_own" on public.decisions for update using (auth.uid() = user_id);
drop policy if exists "decisions_delete_own" on public.decisions;
create policy "decisions_delete_own" on public.decisions for delete using (auth.uid() = user_id);

-- projects
drop policy if exists "projects_select_own" on public.projects;
create policy "projects_select_own" on public.projects for select using (auth.uid() = user_id);
drop policy if exists "projects_insert_own" on public.projects;
create policy "projects_insert_own" on public.projects for insert with check (auth.uid() = user_id);
drop policy if exists "projects_update_own" on public.projects;
create policy "projects_update_own" on public.projects for update using (auth.uid() = user_id);
drop policy if exists "projects_delete_own" on public.projects;
create policy "projects_delete_own" on public.projects for delete using (auth.uid() = user_id);

-- people
drop policy if exists "people_select_own" on public.people;
create policy "people_select_own" on public.people for select using (auth.uid() = user_id);
drop policy if exists "people_insert_own" on public.people;
create policy "people_insert_own" on public.people for insert with check (auth.uid() = user_id);
drop policy if exists "people_update_own" on public.people;
create policy "people_update_own" on public.people for update using (auth.uid() = user_id);
drop policy if exists "people_delete_own" on public.people;
create policy "people_delete_own" on public.people for delete using (auth.uid() = user_id);

-- ideas
drop policy if exists "ideas_select_own" on public.ideas;
create policy "ideas_select_own" on public.ideas for select using (auth.uid() = user_id);
drop policy if exists "ideas_insert_own" on public.ideas;
create policy "ideas_insert_own" on public.ideas for insert with check (auth.uid() = user_id);
drop policy if exists "ideas_update_own" on public.ideas;
create policy "ideas_update_own" on public.ideas for update using (auth.uid() = user_id);
drop policy if exists "ideas_delete_own" on public.ideas;
create policy "ideas_delete_own" on public.ideas for delete using (auth.uid() = user_id);

-- meetings
drop policy if exists "meetings_select_own" on public.meetings;
create policy "meetings_select_own" on public.meetings for select using (auth.uid() = user_id);
drop policy if exists "meetings_insert_own" on public.meetings;
create policy "meetings_insert_own" on public.meetings for insert with check (auth.uid() = user_id);
drop policy if exists "meetings_update_own" on public.meetings;
create policy "meetings_update_own" on public.meetings for update using (auth.uid() = user_id);
drop policy if exists "meetings_delete_own" on public.meetings;
create policy "meetings_delete_own" on public.meetings for delete using (auth.uid() = user_id);

-- documents
drop policy if exists "documents_select_own" on public.documents;
create policy "documents_select_own" on public.documents for select using (auth.uid() = user_id);
drop policy if exists "documents_insert_own" on public.documents;
create policy "documents_insert_own" on public.documents for insert with check (auth.uid() = user_id);
drop policy if exists "documents_update_own" on public.documents;
create policy "documents_update_own" on public.documents for update using (auth.uid() = user_id);
drop policy if exists "documents_delete_own" on public.documents;
create policy "documents_delete_own" on public.documents for delete using (auth.uid() = user_id);

-------------------------------------------------------------------------------
-- Semantic search function (cosine similarity)
-------------------------------------------------------------------------------
create or replace function public.search_by_embedding(
  p_user_id uuid,
  p_table_name text,
  p_embedding vector(1536),
  p_match_count integer default 10,
  p_match_threshold float default 0.7
)
returns table (id uuid, similarity float)
language plpgsql
security definer
as $$
begin
  if p_table_name = 'memories' then
    return query
      select m.id, 1 - (m.embedding <=> p_embedding) as similarity
      from public.memories m
      where m.user_id = p_user_id
        and m.embedding is not null
        and 1 - (m.embedding <=> p_embedding) > p_match_threshold
      order by m.embedding <=> p_embedding
      limit p_match_count;
  elsif p_table_name = 'decisions' then
    return query
      select d.id, 1 - (d.embedding <=> p_embedding) as similarity
      from public.decisions d
      where d.user_id = p_user_id
        and d.embedding is not null
        and 1 - (d.embedding <=> p_embedding) > p_match_threshold
      order by d.embedding <=> p_embedding
      limit p_match_count;
  elsif p_table_name = 'projects' then
    return query
      select p.id, 1 - (p.embedding <=> p_embedding) as similarity
      from public.projects p
      where p.user_id = p_user_id
        and p.embedding is not null
        and 1 - (p.embedding <=> p_embedding) > p_match_threshold
      order by p.embedding <=> p_embedding
      limit p_match_count;
  elsif p_table_name = 'people' then
    return query
      select pe.id, 1 - (pe.embedding <=> p_embedding) as similarity
      from public.people pe
      where pe.user_id = p_user_id
        and pe.embedding is not null
        and 1 - (pe.embedding <=> p_embedding) > p_match_threshold
      order by pe.embedding <=> p_embedding
      limit p_match_count;
  elsif p_table_name = 'ideas' then
    return query
      select i.id, 1 - (i.embedding <=> p_embedding) as similarity
      from public.ideas i
      where i.user_id = p_user_id
        and i.embedding is not null
        and 1 - (i.embedding <=> p_embedding) > p_match_threshold
      order by i.embedding <=> p_embedding
      limit p_match_count;
  elsif p_table_name = 'meetings' then
    return query
      select mt.id, 1 - (mt.embedding <=> p_embedding) as similarity
      from public.meetings mt
      where mt.user_id = p_user_id
        and mt.embedding is not null
        and 1 - (mt.embedding <=> p_embedding) > p_match_threshold
      order by mt.embedding <=> p_embedding
      limit p_match_count;
  elsif p_table_name = 'documents' then
    return query
      select doc.id, 1 - (doc.embedding <=> p_embedding) as similarity
      from public.documents doc
      where doc.user_id = p_user_id
        and doc.embedding is not null
        and 1 - (doc.embedding <=> p_embedding) > p_match_threshold
      order by doc.embedding <=> p_embedding
      limit p_match_count;
  else
    raise exception 'Unknown table: %', p_table_name;
  end if;
end;
$$;
