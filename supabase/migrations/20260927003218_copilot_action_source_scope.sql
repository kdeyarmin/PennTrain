-- An action draft must not attach facility B's work to a response generated for facility A.
-- Source-less manual drafts keep their existing contract. Validate supplied references only;
-- do not add a foreign key that would change the existing receipt-retention lifecycle.
create function app_private.guard_copilot_action_source_scope()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if new.source_response_id is not null and not exists (
    select 1
    from public.compliance_copilot_runs r
    where r.id = new.source_response_id
      and r.organization_id = new.organization_id
      and r.facility_id is not distinct from new.facility_id
      and r.status = 'completed'
  ) then
    raise exception 'Copilot source response must be completed and belong to this facility'
      using errcode = '22023';
  end if;
  return new;
end;
$function$;

revoke all on function app_private.guard_copilot_action_source_scope() from public, anon, authenticated;

create trigger guard_copilot_action_source_scope
before insert or update of organization_id, facility_id, source_response_id
on public.copilot_action_drafts
for each row execute function app_private.guard_copilot_action_source_scope();
