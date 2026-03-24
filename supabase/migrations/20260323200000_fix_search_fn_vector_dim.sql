-- Update search_by_embedding to accept vector(1024) for BGE-M3
-- Must match the column dimensions set by 20260322_bge_m3_vector_resize.sql

-- Ensure pgvector is resolvable
SET search_path TO public, extensions;

create or replace function public.search_by_embedding(
  p_user_id uuid,
  p_table_name text,
  p_embedding vector(1024),
  p_match_count integer default 10,
  p_match_threshold float default 0.7
)
returns table (id uuid, similarity float)
language plpgsql
security definer
set search_path = public, extensions
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
  elsif p_table_name = 'goals' then
    return query
      select g.id, 1 - (g.embedding <=> p_embedding) as similarity
      from public.goals g
      where g.user_id = p_user_id
        and g.embedding is not null
        and 1 - (g.embedding <=> p_embedding) > p_match_threshold
      order by g.embedding <=> p_embedding
      limit p_match_count;
  else
    raise exception 'Unknown table: %', p_table_name;
  end if;
end;
$$;
