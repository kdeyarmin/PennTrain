-- Share the existing lifecycle state machine with explicitly delegated actors.
-- Preserve every current validation/disposition branch; change only its actor
-- source. The private core cannot be invoked through PostgREST or a browser role.
do $extract$
declare definition text; actor_calls integer;
begin
 definition:=pg_get_functiondef('public.apply_employee_lifecycle_transition(uuid,text,date,uuid,text)'::regprocedure);
 actor_calls:=(length(definition)-length(replace(definition,'app_private.current_actor_profile_id()','')))/length('app_private.current_actor_profile_id()');
 if actor_calls<>5 or position('perform public.assert_identity_assurance(''operational_admin'');' in definition)=0
  or position('CREATE OR REPLACE FUNCTION public.apply_employee_lifecycle_transition(' in definition)<>1 then
  raise exception 'Lifecycle implementation shape changed; review core extraction';
 end if;
 definition:=replace(definition,'CREATE OR REPLACE FUNCTION public.apply_employee_lifecycle_transition(',
  'CREATE OR REPLACE FUNCTION app_private.apply_employee_lifecycle_transition_core(p_actor_profile_id uuid, ');
 definition:=replace(definition,'app_private.current_actor_profile_id()','p_actor_profile_id');
 execute definition;
end;
$extract$;
revoke all on function app_private.apply_employee_lifecycle_transition_core(uuid,uuid,text,date,uuid,text) from public,anon,authenticated,service_role;

-- Native callers still derive their actor from the authenticated profile and
-- retain the original operational assurance and preview permission checks.
create or replace function public.apply_employee_lifecycle_transition(
 p_employee_id uuid,p_transition text,p_effective_on date default current_date,p_facility_id uuid default null,p_reason text default null)
returns uuid language plpgsql security definer set search_path='' as $$
begin
 perform public.assert_identity_assurance('operational_admin');
 return app_private.apply_employee_lifecycle_transition_core(app_private.current_actor_profile_id(),
  p_employee_id,p_transition,p_effective_on,p_facility_id,p_reason);
end;
$$;
revoke all on function public.apply_employee_lifecycle_transition(uuid,text,date,uuid,text) from public,anon;
grant execute on function public.apply_employee_lifecycle_transition(uuid,text,date,uuid,text) to authenticated,service_role;
comment on function app_private.apply_employee_lifecycle_transition_core(uuid,uuid,text,date,uuid,text) is
 'Shared lifecycle state machine. Actor must come from a native authenticated wrapper or verified mapped Hub delegation; no caller-controlled JWT or actor context is installed.';
