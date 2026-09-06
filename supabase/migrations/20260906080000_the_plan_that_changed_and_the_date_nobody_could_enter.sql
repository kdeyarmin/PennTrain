-- The plan that changed on paper but not on the floor, and a completion date nobody could enter.
--
-- BACKLOG J4, J5 and J32.
--
-- J4. `app_private.activate_support_plan` supersedes the previous plan's service requirements and
-- inserts the new ones, and stops there. It never supersedes the task INSTANCES those requirements
-- already produced -- the generator runs fourteen days ahead -- and it never calls
-- `generate_resident_service_tasks` for the new ones. So for up to two weeks after a revised
-- support plan goes active, the Floor queue shows aides the OLD plan's instructions, they document
-- against them, and the new plan's tasks do not exist until the 02:10 UTC nightly job.
--
-- `materialize_service_requirements_from_assessment_form` -- the assessment-form path into exactly
-- the same tables -- does both. The two statements are lifted from it.
--
-- J5. `complete_resident_compliance_item` had no date parameter: it stamped
-- `completed_date = pa_today()`, the UPLOAD day. A facility uploads the signed RASP/ASP days or
-- weeks after the assessor signed it, so an ALF initial assessment due 30 days before admission
-- reads late when it was on time, and -- worse -- every successor the function inserts is anchored
-- on that upload day, which pushes the annual reassessment past what 2600.225 / 2800.225 allow.
-- The date is now a parameter, bounded so it cannot be in the future and cannot precede the
-- resident's admission.
--
-- J32. The generator issues instances for every active requirement without looking at the
-- resident. 20260905140000 stopped a discharged resident's tasks from being SHOWN and stopped
-- documentation landing against them, but the generator kept minting fresh ones every night, so
-- the queue predicate was filtering rows that should never have been created. This is the same
-- predicate `get_resident_service_task_queue` uses.

-- ---------------------------------------------------------------------------
-- J4 -- activating a plan moves the floor with it
-- ---------------------------------------------------------------------------

do $do$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'app_private' and p.proname = 'activate_support_plan';
  if v_def is null then raise exception 'app_private.activate_support_plan is missing'; end if;

  v_old := '  update public.resident_service_requirements set status=''superseded'', superseded_at=now(), updated_at=now()
    where resident_id=v.resident_id and status=''active'';';
  v_new := '  update public.resident_service_requirements set status=''superseded'', superseded_at=now(),
    expires_on = greatest(effective_from, coalesce(v.effective_date, public.pa_today()) - 1), updated_at=now()
    where resident_id=v.resident_id and status=''active'';

  -- BACKLOG J4. The requirements are superseded above; the instances they already produced are
  -- not, and the generator runs fourteen days ahead. Without this the Floor queue keeps showing
  -- the old plan''s instructions -- and accepting documentation against them -- for up to two
  -- weeks after the revision goes active. Same statement as
  -- materialize_service_requirements_from_assessment_form.
  update public.resident_service_task_instances i
  set status = ''superseded'', updated_at = now()
  where i.resident_id = v.resident_id
    and i.status = ''scheduled''
    and public.pa_day(i.scheduled_start) >= coalesce(v.effective_date, public.pa_today())
    and exists (
      select 1 from public.resident_service_requirements r
      where r.id = i.requirement_id and r.status = ''superseded''
    );';
  if position(v_old in v_def) = 0 then
    raise exception 'activate_support_plan no longer contains the requirement-supersede statement this migration patches';
  end if;
  v_def := replace(v_def, v_old, v_new);

  v_old := '  insert into public.audit_logs(organization_id,actor_profile_id,entity_type,entity_id,action,new_values)';
  v_new := '  -- BACKLOG J4. The new plan''''s tasks exist the moment it goes active, not at 02:10 UTC.
  -- Same call, same window, as the assessment-form materializer.
  perform public.generate_resident_service_tasks(
    greatest(public.pa_today(), coalesce(v.effective_date, public.pa_today())),
    greatest(public.pa_today(), coalesce(v.effective_date, public.pa_today())) + 14,
    null
  );

  insert into public.audit_logs(organization_id,actor_profile_id,entity_type,entity_id,action,new_values)';
  if position(v_old in v_def) = 0 then
    raise exception 'activate_support_plan no longer contains the audit insert this migration patches';
  end if;
  v_def := replace(v_def, v_old, v_new);

  execute v_def;
end;
$do$;

comment on function app_private.activate_support_plan(uuid) is
  'Makes a support plan version active. Supersedes the prior version''s service requirements AND '
  'the task instances they already produced from the effective date forward, then regenerates the '
  'fourteen-day window -- so the Floor queue changes with the plan instead of showing the old '
  'plan''s instructions until the nightly job (BACKLOG J4). These are the two statements '
  'materialize_service_requirements_from_assessment_form has always had on the assessment path.';

-- ---------------------------------------------------------------------------
-- J32 -- the generator stops minting tasks for residents who are not there
-- ---------------------------------------------------------------------------

do $do$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'generate_resident_service_tasks';
  if v_def is null then raise exception 'public.generate_resident_service_tasks is missing'; end if;

  v_old := '      and (r.expires_on is null or r.expires_on >= p_from)';
  v_new := '      and (r.expires_on is null or r.expires_on >= p_from)
      -- BACKLOG J32. 20260905140000 stopped a discharged resident''s tasks being shown and stopped
      -- documentation landing on them; nothing stopped this loop minting fresh ones every night.
      -- Same predicate as get_resident_service_task_queue''s due list.
      and exists (
        select 1 from public.residents res
        where res.id = r.resident_id and res.status in (''active'', ''temporarily_out'')
      )';
  if position(v_old in v_def) = 0 then
    raise exception 'generate_resident_service_tasks no longer contains the requirement predicate this migration patches';
  end if;
  execute replace(v_def, v_old, v_new);
end;
$do$;

comment on function public.generate_resident_service_tasks(date, date, uuid) is
  'Materialises resident service task instances for a date window. Only residents who are active '
  'or temporarily out get instances -- the same predicate get_resident_service_task_queue applies '
  'when it shows them. Before BACKLOG J32 this loop minted tasks for discharged and deceased '
  'residents every night and the queue filtered them back out downstream.';

-- ---------------------------------------------------------------------------
-- J5 -- the date the assessor signed, not the day somebody uploaded the scan
-- ---------------------------------------------------------------------------
--
-- The 2-argument form is dropped rather than kept alongside: leaving it would let a caller keep
-- stamping the upload day, which is the defect. check-rpc-call-signatures pins the frontend to the
-- new shape.

drop function if exists public.complete_resident_compliance_item(uuid, uuid);

create or replace function public.complete_resident_compliance_item(
  p_item_id uuid,
  p_document_id uuid,
  p_completed_on date default null
)
returns public.resident_compliance_items
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_item public.resident_compliance_items;
  v_document public.resident_documents;
  v_completed_date date;
  v_updated public.resident_compliance_items;
  v_facility_type text;
  v_support_plan_citation_ref text;
  v_annual_rule public.resident_compliance_rule_packs;
  v_admission_track text;
  v_admission_date date;
begin
  select * into v_item from public.resident_compliance_items where id = p_item_id for update;
  if v_item.id is null then
    raise exception 'resident compliance item % not found', p_item_id using errcode = 'no_data_found';
  end if;

  if not coalesce((
    public.is_platform_admin()
    or (v_item.organization_id = public.current_org_id()
        and public.current_role() in ('org_admin', 'facility_manager')
        and public.is_assigned_to_facility(v_item.facility_id))
  ), false) then
    raise exception 'not authorized to complete this resident compliance item' using errcode = 'insufficient_privilege';
  end if;

  if v_item.status = 'compliant' and v_item.completed_date is not null then
    return v_item;
  end if;

  -- BACKLOG J5. The date the assessor signed the form, not the day somebody got round to
  -- uploading the scan. Everything downstream is anchored on it: `completed_date` is what the
  -- checklist prints and what get_resident_care_header.lastAssessment.completedOn shows, and every
  -- successor item this function inserts is due `completed_date + interval`. Stamping the upload
  -- day made an initial ALF assessment completed 30 days before admission read late, and pushed
  -- the annual reassessment past 2600.225 / 2800.225.
  --
  -- Bounded on both sides. Not in the future, because a completion is a record of something that
  -- has happened. Not before the resident existed as a resident, because a form for this admission
  -- cannot predate it -- except that ALF pre-admission assessments legitimately do, so the floor is
  -- 180 days before admission rather than admission itself.
  select r.admission_date into v_admission_date
  from public.residents r where r.id = v_item.resident_id;

  v_completed_date := coalesce(p_completed_on, public.pa_today());
  if v_completed_date > public.pa_today() then
    raise exception 'a completion date cannot be in the future' using errcode = 'check_violation';
  end if;
  if v_admission_date is not null and v_completed_date < v_admission_date - 180 then
    raise exception 'a completion date more than 180 days before admission is not a record of this admission'
      using errcode = 'check_violation';
  end if;

  -- The document must exist, belong to the same resident, be linked to THIS item specifically
  -- (not just any state form on file for the resident), and be flagged as the actual state form.
  -- IS DISTINCT FROM (not <>) so a document with a null compliance_item_id -- e.g. uploaded via the
  -- generic per-resident Documents uploader without picking an item -- is correctly rejected instead
  -- of silently passing through three-valued-logic NULL comparison.
  select * into v_document from public.resident_documents where id = p_document_id;
  if v_document.id is null
     or v_document.resident_id is distinct from v_item.resident_id
     or v_document.compliance_item_id is distinct from p_item_id
     or v_document.is_state_form is not true then
    raise exception 'the state-approved DHS form for this item must be uploaded and attached before it can be marked complete -- no exception'
      using errcode = 'check_violation';
  end if;

  update public.resident_compliance_items
  set completed_date = v_completed_date, status = 'compliant'
  where id = p_item_id
  returning * into v_updated;

  -- CHANGE (20260804170000): the successor's item_type and grace are no longer inherited blindly.
  -- A completed *initial* medical evaluation renews as `annual_medical_evaluation`, and takes that
  -- item type's own rule-pack row -- which is the only reason the 15-day annual grace can be
  -- applied at all without also handing it to the initial cycle. Every other item type renews as
  -- itself on its own carried values, exactly as before.
  if v_item.item_type = 'medical_evaluation' then
    select facility_type into v_facility_type from public.facilities where id = v_item.facility_id;
    -- CHANGE (20260805160000): admission_track and state, the two predicates every other
    -- rule-pack lookup in this schema uses. Without the track this SELECT matched both ALR
    -- medical-evaluation rows, they tie on the only ORDER BY key, and which one LIMIT 1 returned
    -- was the planner's choice -- so an expedited resident's annual evaluation got a 30-day
    -- warning window or a 14-day one at random. PCH has one track, exactly as
    -- instantiate_resident_compliance_items assumes when it substitutes 'standard'.
    select case when v_facility_type = 'ALR' then r.admission_track else 'standard' end
    into v_admission_track
    from public.residents r where r.id = v_item.resident_id;

    select * into v_annual_rule
    from public.resident_compliance_rule_packs rp
    where rp.item_type = 'annual_medical_evaluation'
      and rp.facility_type = v_facility_type
      and rp.admission_track = coalesce(v_admission_track, 'standard')
      and rp.state = 'PA'
      and rp.is_active
      and (rp.organization_id = v_item.organization_id or rp.organization_id is null)
    -- A tenant override wins, and beyond that the newest row does: two rows on the same key are
    -- not supposed to exist, and if they ever do the answer must still not depend on the plan.
    order by rp.organization_id nulls last, rp.created_at desc, rp.id
    limit 1;

    if v_annual_rule.id is not null then
      insert into public.resident_compliance_items
        (organization_id, facility_id, resident_id, item_type, due_date, renewal_interval_days, warning_days, grace_period_days)
      values
        (v_item.organization_id, v_item.facility_id, v_item.resident_id, 'annual_medical_evaluation',
         v_completed_date + v_annual_rule.renewal_interval_days, v_annual_rule.renewal_interval_days,
         v_annual_rule.warning_days, v_annual_rule.grace_period_days);
    end if;
  elsif v_item.renewal_interval_days is not null then
    insert into public.resident_compliance_items
      (organization_id, facility_id, resident_id, item_type, due_date, renewal_interval_days, warning_days, grace_period_days)
    values
      (v_item.organization_id, v_item.facility_id, v_item.resident_id, v_item.item_type,
       v_completed_date + v_item.renewal_interval_days, v_item.renewal_interval_days, v_item.warning_days, v_item.grace_period_days);
  end if;

  if v_item.item_type in ('annual_reassessment', 'significant_change_reassessment')
     and not exists (select 1 from public.resident_compliance_items where triggered_by_item_id = p_item_id) then
    select facility_type into v_facility_type from public.facilities where id = v_item.facility_id;
    v_support_plan_citation_ref := case when v_facility_type = 'ALR' then '2800.224' else '2600.227' end;

    insert into public.resident_compliance_items
      (organization_id, facility_id, resident_id, item_type, due_date, renewal_interval_days, warning_days, grace_period_days, citation_topic_id, triggered_by_item_id)
    values
      (v_item.organization_id, v_item.facility_id, v_item.resident_id, 'support_plan_30day',
       v_completed_date + 30, null, 14, 0,
       (select id from public.dhs_citation_topics where citation_ref = v_support_plan_citation_ref),
       p_item_id);
  end if;

  return v_updated;
end;
$function$;

comment on function public.complete_resident_compliance_item(uuid, uuid, date) is
  'Marks a resident compliance item complete against its uploaded state form. p_completed_on is '
  'the date on the form -- when the assessor signed it -- defaulting to today and bounded to a '
  'date that is not in the future and not more than 180 days before admission. Every successor '
  'this function inserts is anchored on it, so uploading a scan late no longer makes an '
  'on-time assessment read late nor pushes the annual reassessment past 2600.225 / 2800.225 '
  '(BACKLOG J5).';

revoke all on function public.complete_resident_compliance_item(uuid, uuid, date)
  from public, anon, authenticated;
grant execute on function public.complete_resident_compliance_item(uuid, uuid, date) to authenticated;
