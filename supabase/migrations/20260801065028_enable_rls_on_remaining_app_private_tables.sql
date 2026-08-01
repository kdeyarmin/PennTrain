-- 7 app_private tables were missing RLS entirely (relrowsecurity = false), unlike the other
-- 21 app_private tables which already carry RLS-enabled-with-zero-policies as their standard
-- posture (service_role bypasses RLS via BYPASSRLS, so that posture means "service_role and
-- superuser only"). None of these 7 are referenced from application code or edge functions --
-- confirmed by grep -- so this brings them in line with the rest of the schema rather than
-- changing any actual access path. app_private is not in PostgREST's exposed schema list
-- (no [api] override in supabase/config.toml), so this is defense-in-depth against any future
-- SECURITY DEFINER function or config change that might read through to these tables unscoped.
--
-- clinical_access_log: audit trail of clinical data access -- the log itself must not be
-- readable/writable outside service_role.
-- exclusion_list_entries_dedup_backup_20260712: a dated one-off snapshot taken before a dedup
-- pass on public.exclusion_list_entries (which is the live table). No primary key, no code
-- references found. Locking it down here rather than dropping it -- deleting 97k rows of
-- what may be a retained pre-dedup safety copy is a data-destructive call for the team to make
-- explicitly, not an RLS migration.
-- product_module_resources / product_module_storage_buckets: internal product-module metadata,
-- not tenant data.
-- retained_records_archive_2026 / _2027 / _default: regulatory retention archive partitions.

alter table app_private.clinical_access_log enable row level security;
alter table app_private.exclusion_list_entries_dedup_backup_20260712 enable row level security;
alter table app_private.product_module_resources enable row level security;
alter table app_private.product_module_storage_buckets enable row level security;
alter table app_private.retained_records_archive_2026 enable row level security;
alter table app_private.retained_records_archive_2027 enable row level security;
alter table app_private.retained_records_archive_default enable row level security;
