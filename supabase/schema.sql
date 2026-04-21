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

create index if not exists notes_deleted_at_idx
  on public.notes (deleted_at);

create index if not exists notes_fts_idx
  on public.notes using gin (fts);

create table if not exists public.note_tags (
  note_id uuid not null references public.notes(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (note_id, tag_id)
);

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

insert into public.folders (name)
select '收件箱'
where not exists (
  select 1 from public.folders where lower(name) = lower('收件箱')
);

alter table public.notes enable row level security;
alter table public.folders enable row level security;
alter table public.tags enable row level security;
alter table public.note_tags enable row level security;

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
end
$$;
