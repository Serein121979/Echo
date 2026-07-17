-- Echo private single-user schema.
-- This is intentionally destructive: the product decision is to start fresh.
-- Create the owner in Supabase Auth first, then run this file once in SQL Editor.

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

drop table if exists public.clips cascade;
drop table if exists public.ai_messages cascade;
drop table if exists public.ai_threads cascade;
drop table if exists public.ai_suggestions cascade;
drop table if exists public.note_tags cascade;
drop table if exists public.attachments cascade;
drop table if exists public.auto_tag_rules cascade;
drop table if exists public.notes cascade;
drop table if exists public.tags cascade;
drop table if exists public.folders cascade;
drop table if exists public.devices cascade;

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null,
  name text not null,
  platform text not null,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, client_id),
  unique (user_id, id)
);

create table public.folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (user_id, id)
);
create unique index folders_user_name_idx on public.folders (user_id, lower(name));

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  color text not null default '#1967d2',
  created_at timestamptz not null default now(),
  unique (user_id, id)
);
create unique index tags_user_name_idx on public.tags (user_id, lower(name));

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  content text not null default '',
  summary text,
  ai_status text not null default 'pending' check (ai_status in ('pending', 'processing', 'ready', 'failed')),
  folder_id uuid,
  source_device_id uuid,
  source_platform text not null default 'web',
  is_starred boolean not null default false,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  search_document tsvector generated always as (
    to_tsvector('simple', coalesce(content, '') || ' ' || coalesce(summary, ''))
  ) stored,
  unique (user_id, id),
  foreign key (user_id, folder_id) references public.folders(user_id, id) on delete restrict,
  foreign key (user_id, source_device_id) references public.devices(user_id, id) on delete restrict
);
create index notes_user_created_idx on public.notes (user_id, created_at desc);
create index notes_user_state_idx on public.notes (user_id, is_archived, is_starred, deleted_at);
create index notes_search_idx on public.notes using gin (search_document);
create index notes_content_trgm_idx on public.notes using gin (content gin_trgm_ops);

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  note_id uuid not null,
  storage_path text not null unique,
  file_name text not null,
  file_type text not null default 'application/octet-stream',
  file_size bigint not null check (file_size between 0 and 524288000),
  upload_status text not null default 'ready' check (upload_status in ('uploading', 'ready', 'failed')),
  extraction_status text not null default 'pending' check (extraction_status in ('pending', 'processing', 'ready', 'unsupported', 'failed')),
  extracted_text text,
  extraction_error text,
  created_at timestamptz not null default now(),
  foreign key (user_id, note_id) references public.notes(user_id, id) on delete cascade
);
create index attachments_note_idx on public.attachments (note_id, created_at);
create index attachments_user_name_idx on public.attachments (user_id, file_name);
create index attachments_text_trgm_idx on public.attachments using gin (extracted_text gin_trgm_ops);

create table public.note_tags (
  user_id uuid not null references auth.users(id) on delete cascade,
  note_id uuid not null,
  tag_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (note_id, tag_id),
  foreign key (user_id, note_id) references public.notes(user_id, id) on delete cascade,
  foreign key (user_id, tag_id) references public.tags(user_id, id) on delete cascade
);

create table public.ai_suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  note_id uuid not null,
  summary text not null,
  suggested_tags text[] not null default '{}',
  suggested_folder text,
  confidence numeric(4,3) not null default 0 check (confidence between 0 and 1),
  reason text,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  foreign key (user_id, note_id) references public.notes(user_id, id) on delete cascade
);
create index ai_suggestions_user_status_idx on public.ai_suggestions (user_id, status, created_at desc);
create unique index ai_suggestions_one_pending_idx on public.ai_suggestions (note_id) where status = 'pending';

create table public.ai_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '新对话',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id)
);

create table public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  thread_id uuid not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  citation_note_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  foreign key (user_id, thread_id) references public.ai_threads(user_id, id) on delete cascade
);
create index ai_messages_thread_idx on public.ai_messages (thread_id, created_at);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger notes_set_updated_at before update on public.notes
for each row execute function public.set_updated_at();
create trigger ai_threads_set_updated_at before update on public.ai_threads
for each row execute function public.set_updated_at();

create or replace function public.bootstrap_echo_user()
returns void language plpgsql security invoker as $$
declare current_user_id uuid := auth.uid();
begin
  if current_user_id is null then raise exception 'authentication required'; end if;
  insert into public.folders (user_id, name) values (current_user_id, '收件箱')
    on conflict do nothing;
  insert into public.tags (user_id, name, color) values
    (current_user_id, '待办', '#f97316'),
    (current_user_id, '链接', '#2563eb'),
    (current_user_id, '代码', '#7c3aed'),
    (current_user_id, '清单', '#16a34a'),
    (current_user_id, '长文', '#db2777')
    on conflict do nothing;
end;
$$;

create or replace function public.search_echo_notes(
  search_query text,
  result_limit integer default 30,
  search_start timestamptz default null,
  search_end timestamptz default null,
  search_tags text[] default null,
  search_file_types text[] default null,
  search_platforms text[] default null
)
returns table (
  id uuid,
  content text,
  summary text,
  created_at timestamptz,
  source_platform text,
  attachment_names text[],
  rank real
)
language sql security invoker stable as $$
  select
    n.id,
    n.content,
    n.summary,
    n.created_at,
    n.source_platform,
    coalesce(array_agg(distinct a.file_name) filter (where a.id is not null), '{}'),
    greatest(
      ts_rank(n.search_document, plainto_tsquery('simple', search_query)),
      similarity(n.content, search_query),
      coalesce(max(similarity(a.file_name, search_query)), 0),
      coalesce(max(similarity(coalesce(a.extracted_text, ''), search_query)), 0),
      coalesce((
        select max(similarity(t.name, search_query))
        from public.note_tags nt
        join public.tags t on t.id = nt.tag_id and t.user_id = auth.uid()
        where nt.note_id = n.id and nt.user_id = auth.uid()
      ), 0)
    )::real as rank
  from public.notes n
  left join public.attachments a on a.note_id = n.id and a.user_id = auth.uid()
  where n.user_id = auth.uid()
    and n.deleted_at is null
    and (search_start is null or n.created_at >= search_start)
    and (search_end is null or n.created_at < search_end)
    and (
      search_platforms is null
      or cardinality(search_platforms) = 0
      or lower(n.source_platform) = any(select lower(value) from unnest(search_platforms) as value)
    )
    and (
      search_tags is null
      or cardinality(search_tags) = 0
      or exists (
        select 1
        from public.note_tags nt
        join public.tags t on t.id = nt.tag_id and t.user_id = auth.uid()
        where nt.note_id = n.id
          and nt.user_id = auth.uid()
          and lower(t.name) = any(select lower(value) from unnest(search_tags) as value)
      )
    )
    and (
      search_file_types is null
      or cardinality(search_file_types) = 0
      or exists (
        select 1
        from public.attachments type_attachment
        where type_attachment.note_id = n.id
          and type_attachment.user_id = auth.uid()
          and exists (
            select 1 from unnest(search_file_types) as requested_type
            where lower(type_attachment.file_type) = lower(requested_type)
              or lower(type_attachment.file_type) like lower(requested_type) || '/%'
              or lower(type_attachment.file_name) like '%.' || lower(requested_type)
          )
      )
    )
    and (
      search_query = ''
      or n.search_document @@ plainto_tsquery('simple', search_query)
      or n.content ilike '%' || search_query || '%'
      or coalesce(n.summary, '') ilike '%' || search_query || '%'
      or a.file_name ilike '%' || search_query || '%'
      or coalesce(a.extracted_text, '') ilike '%' || search_query || '%'
      or similarity(n.content, search_query) > 0.08
      or exists (
        select 1
        from public.note_tags nt
        join public.tags t on t.id = nt.tag_id and t.user_id = auth.uid()
        where nt.note_id = n.id
          and nt.user_id = auth.uid()
          and t.name ilike '%' || search_query || '%'
      )
    )
  group by n.id
  order by rank desc, n.created_at desc
  limit least(greatest(result_limit, 1), 100)
$$;

alter table public.devices enable row level security;
alter table public.folders enable row level security;
alter table public.tags enable row level security;
alter table public.notes enable row level security;
alter table public.attachments enable row level security;
alter table public.note_tags enable row level security;
alter table public.ai_suggestions enable row level security;
alter table public.ai_threads enable row level security;
alter table public.ai_messages enable row level security;

do $$
declare table_name text;
begin
  foreach table_name in array array['devices','folders','tags','notes','attachments','note_tags','ai_suggestions','ai_threads','ai_messages']
  loop
    execute format('create policy %I on public.%I for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id)', 'owner_only_' || table_name, table_name);
  end loop;
end $$;

insert into storage.buckets (id, name, public, file_size_limit)
values ('echo-files', 'echo-files', false, 524288000)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

drop policy if exists "Public access to echo-files objects" on storage.objects;
drop policy if exists "echo_private_select" on storage.objects;
drop policy if exists "echo_private_insert" on storage.objects;
drop policy if exists "echo_private_update" on storage.objects;
drop policy if exists "echo_private_delete" on storage.objects;
create policy "echo_private_select" on storage.objects for select to authenticated
  using (bucket_id = 'echo-files' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "echo_private_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'echo-files' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "echo_private_update" on storage.objects for update to authenticated
  using (bucket_id = 'echo-files' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'echo-files' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "echo_private_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'echo-files' and (storage.foldername(name))[1] = auth.uid()::text);

do $$
declare table_name text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach table_name in array array['notes','attachments','note_tags','ai_suggestions']
    loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = table_name
      ) then
        execute format('alter publication supabase_realtime add table public.%I', table_name);
      end if;
    end loop;
  end if;
end $$;
