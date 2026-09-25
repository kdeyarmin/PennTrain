-- The QAPI recommendation engine (qapiRecommendations.ts) deliberately re-surfaces a pattern whose
-- project is closed or canceled: if the falls are still happening after the project closed, that is
-- exactly when somebody needs to see it again. The database disagreed. qapi_projects_pattern_key_uk
-- (20260726090100) was partial only on `pattern_key is not null`, so a second project for that
-- pattern could never be inserted, and create_qapi_project's idempotency lookup carried no status
-- filter, so "Open project" on the re-surfaced recommendation returned the CLOSED project's id, the
-- page toasted "QAPI project opened", nothing new existed, and the recommendation stayed on the list
-- with no action that could clear it.
--
-- The pattern claim now belongs to OPEN projects only, on both the index and the lookup. The lookup
-- is patched onto the LIVE body with pg_get_functiondef + a guarded replace: the deployed definition
-- was re-declared by 20260727010100 (pa_today) after 20260726090100 wrote it, and a fresh
-- `create or replace` from either file would revert the other.
drop index if exists public.qapi_projects_pattern_key_uk;
create unique index qapi_projects_pattern_key_uk
  on public.qapi_projects(organization_id, facility_id, pattern_key)
  where pattern_key is not null and status not in ('closed', 'canceled');

do $do$
declare v_def text; v_old text; v_new text;
begin
  v_def := pg_get_functiondef(
    'public.create_qapi_project(uuid,text,text,text,text,text,text,numeric,date,uuid,text,uuid,text)'::regprocedure
  );
  v_old := $q$    where organization_id=v_fac.organization_id and facility_id=v_fac.id and pattern_key=v_pattern;$q$;
  if position(v_old in v_def) = 0 then
    raise exception 'create_qapi_project no longer contains the pattern lookup this migration patches';
  end if;
  v_new := $q$    where organization_id=v_fac.organization_id and facility_id=v_fac.id and pattern_key=v_pattern
      and status not in ('closed', 'canceled');$q$;
  execute replace(v_def, v_old, v_new);
end
$do$;
