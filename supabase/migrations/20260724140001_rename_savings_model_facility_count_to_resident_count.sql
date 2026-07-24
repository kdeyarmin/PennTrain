-- The /savings marketing calculator moved from facility-count-based pricing to
-- CareBase's real billing metric (active residents, 25 included then $4/month
-- each), so the lead-capture table's column needs to track what the visitor
-- actually entered. The table has no rows yet, so a plain rename is safe.
--
-- Version note: this migration was originally stamped 20260724140000, colliding
-- with 20260724140000_add_standalone_annual_courses_fire_abuse_rights.sql (two
-- files sharing one version violate supabase_migrations.schema_migrations' PK,
-- so a from-scratch apply died with "duplicate key value ... (version)=
-- (20260724140000)"). Renumbered to ...140001 to give it a unique version.
-- Because either file may already have recorded 20260724140000 in a given
-- database (depending on the order the two source PRs were deployed), the rename
-- is now guarded so re-applying it here is a no-op when the column was already
-- renamed.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'savings_model_requests'
      and column_name = 'facility_count'
  )
  and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'savings_model_requests'
      and column_name = 'resident_count'
  )
  then
    alter table public.savings_model_requests
      rename column facility_count to resident_count;
  end if;
end $$;
