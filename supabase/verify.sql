select json_build_object(
  'product_tables', (
    select count(*) from information_schema.tables
    where table_schema = 'public'
      and table_name = any(array['devices','folders','tags','notes','attachments','note_tags','ai_suggestions','ai_threads','ai_messages'])
  ),
  'rls_enabled', (
    select count(*) from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = any(array['devices','folders','tags','notes','attachments','note_tags','ai_suggestions','ai_threads','ai_messages'])
      and c.relrowsecurity
  ),
  'owner_policies', (
    select count(*) from pg_policies
    where schemaname = 'public' and policyname like 'owner_only_%'
  ),
  'bucket_private', (
    select not public from storage.buckets where id = 'echo-files'
  ),
  'bucket_limit', (
    select file_size_limit from storage.buckets where id = 'echo-files'
  ),
  'storage_policies', (
    select count(*) from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname like 'echo_private_%'
  ),
  'auth_users', (select count(*) from auth.users)
) as verification;
