-- Server-side auto-pin for Survey Day binders. The compliance-binder export is asynchronous and the
-- export UI explicitly invites the user to leave the page while it renders, so a client-side pin
-- (fired only from a mounted button) misses the common case. When a single-facility binder finishes
-- rendering and its facility has an active Survey Day session, pin the fresh binder to that session
-- here instead, on the same UPDATE that marks the job 'succeeded'.
--
-- Mirrors pin_survey_day_binder's matching rule (succeeded, exactly one facility, same org and
-- facility as the session), so multi-facility exports -- which a manager is auto-scoped to and which
-- could never match a single-facility session -- are left untouched. SECURITY DEFINER so it can
-- update the session regardless of which worker/role finalized the job. Pins whichever single-
-- facility binder for the facility completes most recently while a session is active (freshest wins).
create or replace function app_private.autopin_survey_day_binder()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_session public.survey_day_sessions%rowtype;
begin
  if new.status = 'succeeded'
     and old.status is distinct from 'succeeded'
     and cardinality(new.facility_ids) = 1 then
    select * into v_session
      from public.survey_day_sessions
      where facility_id = new.facility_ids[1]
        and organization_id = new.organization_id
        and status = 'active'
      for update;
    if found and v_session.pinned_binder_job_id is distinct from new.id then
      update public.survey_day_sessions
        set pinned_binder_job_id = new.id
        where id = v_session.id;
      insert into public.survey_day_events (session_id, organization_id, facility_id, actor_id, event_type, metadata)
      values (
        v_session.id, v_session.organization_id, v_session.facility_id, null, 'binder_pinned',
        jsonb_build_object('binderJobId', new.id, 'auto', true)
      );
    end if;
  end if;
  return new;
end;
$function$;
revoke all on function app_private.autopin_survey_day_binder() from public, anon, authenticated, service_role;

drop trigger if exists autopin_survey_day_binder_after_update on public.binder_export_jobs;
create trigger autopin_survey_day_binder_after_update
  after update of status on public.binder_export_jobs
  for each row execute function app_private.autopin_survey_day_binder();
