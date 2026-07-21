-- Server-side summary for the Evidence Room list so its status/legal-hold tiles can be computed over
-- the whole facility scope while the collection list is served page by page. SECURITY INVOKER so the
-- caller's own RLS scopes every count.
create or replace function public.get_evidence_collection_list_summary(
  p_facility_id uuid default null
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  with filtered as (
    select c.*
    from public.evidence_collections c
    where (p_facility_id is null or c.facility_id = p_facility_id)
  )
  select jsonb_build_object(
    'total', count(*),
    'draft', count(*) filter (where status = 'draft'),
    'published', count(*) filter (where status = 'published'),
    'legalHolds', count(*) filter (where legal_hold)
  )
  from filtered;
$function$;
revoke all on function public.get_evidence_collection_list_summary(uuid) from public, anon;
grant execute on function public.get_evidence_collection_list_summary(uuid) to authenticated, service_role;
