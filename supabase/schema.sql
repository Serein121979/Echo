create extension if not exists pgcrypto;

create table if not exists public.folders (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists folders_name_lower_idx
  on public.folders (lower(name));

create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  color text default '#2563eb',
  created_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists tags_name_lower_idx
  on public.tags (lower(name));

create table if not exists public.auto_tag_rules (
  id uuid primary key default gen_random_uuid(),
  match_type text not null,
  match_value text,
  tag_id uuid not null references public.tags(id) on delete cascade,
  priority integer not null default 100,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint auto_tag_rules_match_type_check check (
    match_type in ('contains', 'regex', 'url', 'phone', 'min_length', 'line_breaks')
  )
);

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  content text not null,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.notes
  add column if not exists folder_id uuid references public.folders(id) on delete set null;

alter table public.notes
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

alter table public.notes
  add column if not exists deleted_at timestamptz;

alter table public.notes
  add column if not exists fts tsvector
  generated always as (to_tsvector('simple', coalesce(content, ''))) stored;

alter table public.notes
  add column if not exists is_starred boolean not null default false;

alter table public.notes
  add column if not exists is_archived boolean not null default false;

alter table public.notes
  add column if not exists file_path text;

alter table public.notes
  add column if not exists file_url text;

alter table public.notes
  add column if not exists file_name text;

alter table public.notes
  add column if not exists file_type text;

alter table public.notes
  add column if not exists file_size bigint;

create index if not exists notes_deleted_at_idx
  on public.notes (deleted_at);

create index if not exists notes_is_starred_idx
  on public.notes (is_starred);

create index if not exists notes_is_archived_idx
  on public.notes (is_archived);

create index if not exists notes_fts_idx
  on public.notes using gin (fts);

create index if not exists auto_tag_rules_tag_id_idx
  on public.auto_tag_rules (tag_id);

create index if not exists auto_tag_rules_priority_idx
  on public.auto_tag_rules (priority desc, created_at asc);

create table if not exists public.note_tags (
  note_id uuid not null references public.notes(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (note_id, tag_id)
);

create table if not exists public.clips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  content text not null,
  kind text not null default 'text',
  content_hash text not null,
  source_device_id text not null,
  source_platform text not null,
  is_pinned boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  deleted_at timestamptz,
  constraint clips_kind_check check (kind in ('text', 'code'))
);

create index if not exists clips_user_created_idx
  on public.clips (user_id, created_at desc);

create index if not exists clips_user_pinned_idx
  on public.clips (user_id, is_pinned, created_at desc);

create index if not exists clips_user_deleted_idx
  on public.clips (user_id, deleted_at);

create index if not exists clips_hash_device_idx
  on public.clips (content_hash, source_device_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists set_notes_updated_at on public.notes;

create trigger set_notes_updated_at
before update on public.notes
for each row
execute function public.set_updated_at();

drop trigger if exists set_auto_tag_rules_updated_at on public.auto_tag_rules;

create trigger set_auto_tag_rules_updated_at
before update on public.auto_tag_rules
for each row
execute function public.set_updated_at();

insert into public.folders (name)
select '收件箱'
where not exists (
  select 1 from public.folders where lower(name) = lower('收件箱')
);

insert into storage.buckets (id, name, public, file_size_limit)
select 'echo-files', 'echo-files', true, 52428800
where not exists (
  select 1 from storage.buckets where id = 'echo-files'
);

insert into public.tags (name, color)
select seed.name, seed.color
from (
  values
    ('待办', '#f97316'),
    ('链接', '#2563eb'),
    ('代码', '#7c3aed'),
    ('清单', '#16a34a'),
    ('长文', '#db2777'),
    ('电话', '#0f766e')
) as seed(name, color)
where not exists (
  select 1 from public.tags where lower(tags.name) = lower(seed.name)
);

insert into public.auto_tag_rules (match_type, match_value, tag_id, priority)
select seed.match_type, seed.match_value, tags.id, seed.priority
from (
  values
    ('链接', 'url', null, 100),
    ('待办', 'contains', 'todo', 100),
    ('待办', 'contains', '待办', 90),
    ('待办', 'contains', '待处理', 80),
    ('待办', 'contains', 'follow up', 70),
    ('待办', 'contains', 'follow-up', 60),
    ('代码', 'regex', '```|function |const |let |var |=>|class |import |export ', 100),
    ('清单', 'regex', '^[-*]\\s', 100),
    ('清单', 'line_breaks', '2', 90),
    ('长文', 'min_length', '120', 100),
    ('电话', 'phone', null, 100)
) as seed(tag_name, match_type, match_value, priority)
join public.tags on lower(tags.name) = lower(seed.tag_name)
where not exists (
  select 1
  from public.auto_tag_rules rules
  where rules.tag_id = tags.id
    and rules.match_type = seed.match_type
    and coalesce(rules.match_value, '') = coalesce(seed.match_value, '')
);

alter table public.notes enable row level security;
alter table public.folders enable row level security;
alter table public.tags enable row level security;
alter table public.note_tags enable row level security;
alter table public.auto_tag_rules enable row level security;
alter table public.clips enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'notes' and policyname = 'Public access to notes'
  ) then
    create policy "Public access to notes"
    on public.notes
    for all
    to anon, authenticated
    using (true)
    with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'folders' and policyname = 'Public access to folders'
  ) then
    create policy "Public access to folders"
    on public.folders
    for all
    to anon, authenticated
    using (true)
    with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'tags' and policyname = 'Public access to tags'
  ) then
    create policy "Public access to tags"
    on public.tags
    for all
    to anon, authenticated
    using (true)
    with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'note_tags' and policyname = 'Public access to note_tags'
  ) then
    create policy "Public access to note_tags"
    on public.note_tags
    for all
    to anon, authenticated
    using (true)
    with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'auto_tag_rules' and policyname = 'Public access to auto_tag_rules'
  ) then
    create policy "Public access to auto_tag_rules"
    on public.auto_tag_rules
    for all
    to anon, authenticated
    using (true)
    with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'Public access to echo-files objects'
  ) then
    create policy "Public access to echo-files objects"
    on storage.objects
    for all
    to anon, authenticated
    using (bucket_id = 'echo-files')
    with check (bucket_id = 'echo-files');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'clips' and policyname = 'Users can view their own clips'
  ) then
    create policy "Users can view their own clips"
    on public.clips
    for select
    to authenticated
    using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'clips' and policyname = 'Users can insert their own clips'
  ) then
    create policy "Users can insert their own clips"
    on public.clips
    for insert
    to authenticated
    with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'clips' and policyname = 'Users can update their own clips'
  ) then
    create policy "Users can update their own clips"
    on public.clips
    for update
    to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'clips' and policyname = 'Users can delete their own clips'
  ) then
    create policy "Users can delete their own clips"
    on public.clips
    for delete
    to authenticated
    using (auth.uid() = user_id);
  end if;
end
$$;

do $$
begin
  if exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) and not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notes'
  ) then
    execute 'alter publication supabase_realtime add table public.notes';
  end if;

  if exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) and not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'folders'
  ) then
    execute 'alter publication supabase_realtime add table public.folders';
  end if;

  if exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) and not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tags'
  ) then
    execute 'alter publication supabase_realtime add table public.tags';
  end if;

  if exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) and not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'note_tags'
  ) then
    execute 'alter publication supabase_realtime add table public.note_tags';
  end if;

  if exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) and not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'auto_tag_rules'
  ) then
    execute 'alter publication supabase_realtime add table public.auto_tag_rules';
  end if;

  if exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) and not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'clips'
  ) then
    execute 'alter publication supabase_realtime add table public.clips';
  end if;
end
$$;
