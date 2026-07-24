-- Compliance Command Center: SECURITY DEFINER workflow RPCs, the recurrence generator, and the
-- daily maintenance sweep (reminders + overdue flip + supervisor escalation). All writes to the
-- compliance_requirement* tables go through these functions -- the tables have select-only RLS, so
-- status transitions, history, and notifications cannot be bypassed by a direct client write.
--
-- Rollback: drop the cron job then the functions (see the paired rollback doc).

------------------------------------------------------------------------------------------------
-- Scope guard: manager (org_admin / facility_manager on an assigned facility). platform_admin and
-- the service role (cron) bypass. Mirrors app_private.assert_phase5_manager without the identity-
-- assurance step, matching the resident-compliance functions' posture.
------------------------------------------------------------------------------------------------
create or replace function app_private.assert_compliance_manager(p_org uuid, p_fac uuid default null)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' or public.is_platform_admin() then
    return;
  end if;
  if auth.uid() is null
     or (select public.current_org_id()) is distinct from p_org
     or (select public.current_role()) not in ('org_admin', 'facility_manager')
     or (p_fac is not null and (select public.current_role()) = 'facility_manager'
         and not public.is_assigned_to_facility(p_fac)) then
    raise exception 'Compliance operation is outside caller scope' using errcode = '42501';
  end if;
end $$;
revoke all on function app_private.assert_compliance_manager(uuid, uuid) from public, anon, authenticated, service_role;

------------------------------------------------------------------------------------------------
-- Cadence -> interval (null for one_time). Pure helper.
------------------------------------------------------------------------------------------------
create or replace function app_private.compliance_interval(p_recurrence text, p_custom_days integer)
returns interval language sql immutable set search_path = '' as $$
  select case p_recurrence
    when 'monthly' then interval '1 month'
    when 'quarterly' then interval '3 months'
    when 'semiannual' then interval '6 months'
    when 'annual' then interval '1 year'
    when 'custom' then make_interval(days => coalesce(p_custom_days, 0))
    else null
  end;
$$;

------------------------------------------------------------------------------------------------
-- Instance generator: ensure the first occurrence exists, then roll forward any occurrences due on
-- or before p_through. Bounded by p_through and a hard 240-iteration guard. Internal (cron + the
-- public RPCs call it after their own scope checks).
------------------------------------------------------------------------------------------------
create or replace function app_private.ensure_compliance_instances(p_requirement_id uuid, p_through date)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  r public.compliance_requirements%rowtype;
  v_interval interval;
  v_last_due date;
  v_next date;
  v_prev date;
  v_count integer := 0;
  v_guard integer := 0;
begin
  select * into r from public.compliance_requirements where id = p_requirement_id;
  if not found or r.is_template or not r.is_active or r.facility_id is null then
    return 0;
  end if;

  v_interval := app_private.compliance_interval(r.recurrence, r.custom_interval_days);
  select max(due_date) into v_last_due from public.compliance_requirement_instances where requirement_id = r.id;

  -- First occurrence (always created, even if its due date is beyond the horizon, so a new
  -- requirement is immediately visible in the register).
  if v_last_due is null then
    v_next := coalesce(r.anchor_date, current_date);
    insert into public.compliance_requirement_instances
      (organization_id, facility_id, building_id, requirement_id, period_start, due_date, responsible_profile_id)
    values (r.organization_id, r.facility_id, r.building_id, r.id, v_next, v_next, r.responsible_profile_id)
    on conflict (requirement_id, due_date) do nothing;
    if found then
      insert into public.compliance_requirement_events
        (organization_id, facility_id, requirement_id, instance_id, event_type, new_status, metadata)
      select r.organization_id, r.facility_id, r.id, i.id, 'instance_generated', i.status,
             jsonb_build_object('due_date', v_next)
      from public.compliance_requirement_instances i
      where i.requirement_id = r.id and i.due_date = v_next;
      v_count := v_count + 1;
    end if;
    v_last_due := v_next;
  end if;

  -- Roll forward recurring occurrences within the horizon.
  if v_interval is not null then
    v_next := v_last_due;
    loop
      v_guard := v_guard + 1;
      exit when v_guard > 240;
      v_prev := v_next;
      v_next := (v_prev + v_interval)::date;
      exit when v_next > p_through;
      insert into public.compliance_requirement_instances
        (organization_id, facility_id, building_id, requirement_id, period_start, due_date, responsible_profile_id)
      values (r.organization_id, r.facility_id, r.building_id, r.id, v_prev, v_next, r.responsible_profile_id)
      on conflict (requirement_id, due_date) do nothing;
      if found then
        insert into public.compliance_requirement_events
          (organization_id, facility_id, requirement_id, instance_id, event_type, new_status, metadata)
        select r.organization_id, r.facility_id, r.id, i.id, 'instance_generated', i.status,
               jsonb_build_object('due_date', v_next)
        from public.compliance_requirement_instances i
        where i.requirement_id = r.id and i.due_date = v_next;
        v_count := v_count + 1;
      end if;
    end loop;
  end if;

  return v_count;
end $$;
revoke all on function app_private.ensure_compliance_instances(uuid, date) from public, anon, authenticated, service_role;

------------------------------------------------------------------------------------------------
-- Create / update a requirement (or template). Returns the row.
------------------------------------------------------------------------------------------------
create or replace function public.upsert_compliance_requirement(
  p_id uuid,
  p_facility_id uuid,
  p_building_id uuid,
  p_category text,
  p_title text,
  p_description text,
  p_regulation_citation text,
  p_regulation_chapter text,
  p_responsible_profile_id uuid,
  p_recurrence text,
  p_custom_interval_days integer,
  p_anchor_date date,
  p_warning_days integer,
  p_requires_evidence boolean,
  p_requires_review boolean,
  p_is_template boolean default false,
  p_organization_id uuid default null
) returns public.compliance_requirements
language plpgsql security definer set search_path = '' as $$
declare
  r public.compliance_requirements%rowtype;
  v_org uuid;
  v_is_new boolean := p_id is null;
begin
  if length(btrim(coalesce(p_title, ''))) < 1 then
    raise exception 'A title is required' using errcode = '22023';
  end if;

  if v_is_new then
    -- Derive org from the facility (authoritative) for live requirements; use the caller's org for
    -- templates. The scope guard then confirms the caller may write there.
    v_org := coalesce(
      (select f.organization_id from public.facilities f where f.id = p_facility_id),
      p_organization_id,
      (select public.current_org_id())
    );
    if v_org is null then
      raise exception 'An organization is required' using errcode = '22023';
    end if;
    perform app_private.assert_compliance_manager(v_org, p_facility_id);

    if p_building_id is not null and not exists (
      select 1 from public.facility_buildings b where b.id = p_building_id and b.facility_id = p_facility_id
    ) then
      raise exception 'The selected building is not in this facility' using errcode = '23514';
    end if;
    if p_responsible_profile_id is not null and not exists (
      select 1 from public.profiles p where p.id = p_responsible_profile_id and p.organization_id = v_org
    ) then
      raise exception 'The responsible person is not in this organization' using errcode = '23514';
    end if;

    insert into public.compliance_requirements (
      organization_id, facility_id, building_id, category, title, description,
      regulation_citation, regulation_chapter, responsible_profile_id, recurrence,
      custom_interval_days, anchor_date, warning_days, requires_evidence, requires_review,
      is_template, created_by
    ) values (
      v_org, case when p_is_template then null else p_facility_id end,
      case when p_is_template then null else p_building_id end,
      p_category, btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''),
      nullif(btrim(coalesce(p_regulation_citation, '')), ''), p_regulation_chapter,
      p_responsible_profile_id, coalesce(p_recurrence, 'annual'),
      case when coalesce(p_recurrence, 'annual') = 'custom' then p_custom_interval_days else null end,
      p_anchor_date, coalesce(p_warning_days, 14), coalesce(p_requires_evidence, true),
      coalesce(p_requires_review, false), coalesce(p_is_template, false), (select auth.uid())
    ) returning * into r;

    insert into public.compliance_requirement_events
      (organization_id, facility_id, requirement_id, event_type, actor_profile_id, note)
    values (r.organization_id, r.facility_id, r.id, 'requirement_created', (select auth.uid()), r.title);
  else
    select * into r from public.compliance_requirements where id = p_id for update;
    if not found then raise exception 'Requirement not found' using errcode = 'P0002'; end if;
    perform app_private.assert_compliance_manager(r.organization_id, r.facility_id);

    if p_building_id is not null and r.facility_id is not null and not exists (
      select 1 from public.facility_buildings b where b.id = p_building_id and b.facility_id = r.facility_id
    ) then
      raise exception 'The selected building is not in this facility' using errcode = '23514';
    end if;
    if p_responsible_profile_id is not null and not exists (
      select 1 from public.profiles p where p.id = p_responsible_profile_id and p.organization_id = r.organization_id
    ) then
      raise exception 'The responsible person is not in this organization' using errcode = '23514';
    end if;

    -- facility_id and is_template are immutable after creation (changing them would orphan instances).
    update public.compliance_requirements set
      building_id = case when r.facility_id is null then null else p_building_id end,
      category = p_category,
      title = btrim(p_title),
      description = nullif(btrim(coalesce(p_description, '')), ''),
      regulation_citation = nullif(btrim(coalesce(p_regulation_citation, '')), ''),
      regulation_chapter = p_regulation_chapter,
      responsible_profile_id = p_responsible_profile_id,
      recurrence = coalesce(p_recurrence, recurrence),
      custom_interval_days = case when coalesce(p_recurrence, recurrence) = 'custom' then p_custom_interval_days else null end,
      anchor_date = p_anchor_date,
      warning_days = coalesce(p_warning_days, warning_days),
      requires_evidence = coalesce(p_requires_evidence, requires_evidence),
      requires_review = coalesce(p_requires_review, requires_review)
    where id = r.id returning * into r;

    insert into public.compliance_requirement_events
      (organization_id, facility_id, requirement_id, event_type, actor_profile_id, note)
    values (r.organization_id, r.facility_id, r.id, 'requirement_updated', (select auth.uid()), r.title);
  end if;

  -- Materialize the current/next occurrence(s) for a live active requirement.
  if not r.is_template and r.is_active then
    perform app_private.ensure_compliance_instances(r.id, current_date + greatest(r.warning_days, 30));
  end if;

  return r;
end $$;
revoke all on function public.upsert_compliance_requirement(uuid,uuid,uuid,text,text,text,text,text,uuid,text,integer,date,integer,boolean,boolean,boolean,uuid) from public, anon, authenticated, service_role;
grant execute on function public.upsert_compliance_requirement(uuid,uuid,uuid,text,text,text,text,text,uuid,text,integer,date,integer,boolean,boolean,boolean,uuid) to authenticated;

------------------------------------------------------------------------------------------------
-- Archive / reactivate a requirement.
------------------------------------------------------------------------------------------------
create or replace function public.set_compliance_requirement_active(p_requirement_id uuid, p_active boolean, p_note text default null)
returns public.compliance_requirements
language plpgsql security definer set search_path = '' as $$
declare r public.compliance_requirements%rowtype;
begin
  select * into r from public.compliance_requirements where id = p_requirement_id for update;
  if not found then raise exception 'Requirement not found' using errcode = 'P0002'; end if;
  perform app_private.assert_compliance_manager(r.organization_id, r.facility_id);

  update public.compliance_requirements set is_active = coalesce(p_active, is_active)
  where id = r.id returning * into r;

  insert into public.compliance_requirement_events
    (organization_id, facility_id, requirement_id, event_type, actor_profile_id, note)
  values (r.organization_id, r.facility_id, r.id,
    case when p_active then 'requirement_reactivated' else 'requirement_archived' end,
    (select auth.uid()), nullif(btrim(coalesce(p_note, '')), ''));

  if not r.is_template and r.is_active then
    perform app_private.ensure_compliance_instances(r.id, current_date + greatest(r.warning_days, 30));
  end if;
  return r;
end $$;
revoke all on function public.set_compliance_requirement_active(uuid, boolean, text) from public, anon, authenticated, service_role;
grant execute on function public.set_compliance_requirement_active(uuid, boolean, text) to authenticated;

------------------------------------------------------------------------------------------------
-- Manual "generate now".
------------------------------------------------------------------------------------------------
create or replace function public.generate_compliance_instances_now(p_requirement_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare r public.compliance_requirements%rowtype;
begin
  select * into r from public.compliance_requirements where id = p_requirement_id;
  if not found then raise exception 'Requirement not found' using errcode = 'P0002'; end if;
  perform app_private.assert_compliance_manager(r.organization_id, r.facility_id);
  return app_private.ensure_compliance_instances(r.id, current_date + greatest(r.warning_days, 30));
end $$;
revoke all on function public.generate_compliance_instances_now(uuid) from public, anon, authenticated, service_role;
grant execute on function public.generate_compliance_instances_now(uuid) to authenticated;

------------------------------------------------------------------------------------------------
-- Copy a template into one or more facilities as live requirements.
------------------------------------------------------------------------------------------------
create or replace function public.copy_compliance_requirement(p_template_id uuid, p_facility_ids uuid[])
returns integer language plpgsql security definer set search_path = '' as $$
declare
  t public.compliance_requirements%rowtype;
  v_fac uuid;
  v_new public.compliance_requirements%rowtype;
  v_count integer := 0;
begin
  select * into t from public.compliance_requirements where id = p_template_id;
  if not found then raise exception 'Template not found' using errcode = 'P0002'; end if;
  perform app_private.assert_compliance_manager(t.organization_id, null);
  if coalesce(array_length(p_facility_ids, 1), 0) = 0 then
    raise exception 'Select at least one facility' using errcode = '22023';
  end if;

  foreach v_fac in array p_facility_ids loop
    if not exists (select 1 from public.facilities f where f.id = v_fac and f.organization_id = t.organization_id) then
      raise exception 'Facility is not in this organization' using errcode = '23514';
    end if;
    perform app_private.assert_compliance_manager(t.organization_id, v_fac);
    -- Skip if this template was already copied to this facility (anti-duplicate).
    if exists (
      select 1 from public.compliance_requirements c
      where c.source_template_id = t.id and c.facility_id = v_fac
    ) then
      continue;
    end if;

    insert into public.compliance_requirements (
      organization_id, facility_id, category, title, description, regulation_citation,
      regulation_chapter, responsible_profile_id, recurrence, custom_interval_days, anchor_date,
      warning_days, requires_evidence, requires_review, is_template, source_template_id, created_by
    ) values (
      t.organization_id, v_fac, t.category, t.title, t.description, t.regulation_citation,
      t.regulation_chapter, t.responsible_profile_id, t.recurrence, t.custom_interval_days,
      coalesce(t.anchor_date, current_date), t.warning_days, t.requires_evidence, t.requires_review,
      false, t.id, (select auth.uid())
    ) returning * into v_new;

    insert into public.compliance_requirement_events
      (organization_id, facility_id, requirement_id, event_type, actor_profile_id, note, metadata)
    values (v_new.organization_id, v_new.facility_id, v_new.id, 'template_copied', (select auth.uid()),
      v_new.title, jsonb_build_object('template_id', t.id));

    perform app_private.ensure_compliance_instances(v_new.id, current_date + greatest(v_new.warning_days, 30));
    v_count := v_count + 1;
  end loop;

  return v_count;
end $$;
revoke all on function public.copy_compliance_requirement(uuid, uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.copy_compliance_requirement(uuid, uuid[]) to authenticated;

------------------------------------------------------------------------------------------------
-- Transition an instance's status. Enforces the review gate and the evidence gate; records history
-- and notifications.
------------------------------------------------------------------------------------------------
create or replace function public.transition_compliance_instance(p_instance_id uuid, p_action text, p_note text default null)
returns public.compliance_requirement_instances
language plpgsql security definer set search_path = '' as $$
declare
  i public.compliance_requirement_instances%rowtype;
  r public.compliance_requirements%rowtype;
  v_prior text;
  v_new text;
  v_actor uuid := (select auth.uid());
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select * into i from public.compliance_requirement_instances where id = p_instance_id for update;
  if not found then raise exception 'Requirement occurrence not found' using errcode = 'P0002'; end if;
  select * into r from public.compliance_requirements where id = i.requirement_id;
  perform app_private.assert_compliance_manager(i.organization_id, i.facility_id);

  v_prior := i.status;

  if p_action = 'start' then
    v_new := 'in_progress';
  elsif p_action = 'submit_review' then
    if not r.requires_review then raise exception 'This requirement does not use review' using errcode = '22023'; end if;
    if r.requires_evidence and i.evidence_count = 0 then
      raise exception 'Attach evidence before submitting for review' using errcode = '55000';
    end if;
    v_new := 'awaiting_review';
  elsif p_action = 'complete' then
    if r.requires_review then raise exception 'Submit for review instead of completing directly' using errcode = '22023'; end if;
    if r.requires_evidence and i.evidence_count = 0 then
      raise exception 'Attach evidence before marking complete' using errcode = '55000';
    end if;
    v_new := 'complete';
  elsif p_action = 'approve_review' then
    if i.status <> 'awaiting_review' then raise exception 'Only occurrences awaiting review can be approved' using errcode = '22023'; end if;
    v_new := 'complete';
  elsif p_action = 'mark_not_applicable' then
    if v_note is null then raise exception 'A reason is required to mark not applicable' using errcode = '22023'; end if;
    v_new := 'not_applicable';
  elsif p_action = 'approve_exception' then
    if v_note is null then raise exception 'A justification is required to approve an exception' using errcode = '22023'; end if;
    v_new := 'exception_approved';
  elsif p_action = 'reopen' then
    if v_note is null then raise exception 'A reason is required to reopen' using errcode = '22023'; end if;
    v_new := 'in_progress';
  else
    raise exception 'Unsupported action' using errcode = '22023';
  end if;

  update public.compliance_requirement_instances set
    status = v_new,
    completed_by = case when p_action in ('complete') then v_actor
                        when p_action = 'submit_review' then v_actor
                        when p_action = 'reopen' then null else completed_by end,
    completed_at = case when p_action in ('complete') then now()
                        when p_action = 'submit_review' then now()
                        when p_action = 'reopen' then null else completed_at end,
    completion_note = case when p_action in ('complete', 'submit_review') then coalesce(v_note, completion_note)
                           when p_action = 'reopen' then null else completion_note end,
    reviewed_by = case when p_action = 'approve_review' then v_actor when p_action = 'reopen' then null else reviewed_by end,
    reviewed_at = case when p_action = 'approve_review' then now() when p_action = 'reopen' then null else reviewed_at end,
    review_note = case when p_action = 'approve_review' then coalesce(v_note, review_note) when p_action = 'reopen' then null else review_note end,
    na_reason = case when p_action = 'mark_not_applicable' then v_note when p_action = 'reopen' then null else na_reason end,
    exception_reason = case when p_action = 'approve_exception' then v_note when p_action = 'reopen' then null else exception_reason end,
    exception_approved_by = case when p_action = 'approve_exception' then v_actor when p_action = 'reopen' then null else exception_approved_by end,
    exception_approved_at = case when p_action = 'approve_exception' then now() when p_action = 'reopen' then null else exception_approved_at end
  where id = i.id returning * into i;

  insert into public.compliance_requirement_events
    (organization_id, facility_id, requirement_id, instance_id, event_type, prior_status, new_status, actor_profile_id, note)
  values (i.organization_id, i.facility_id, i.requirement_id, i.id,
    case p_action
      when 'complete' then 'completed' when 'approve_review' then 'reviewed'
      when 'reopen' then 'reopened' when 'mark_not_applicable' then 'marked_not_applicable'
      when 'approve_exception' then 'exception_approved' else 'status_changed' end,
    v_prior, v_new, v_actor, v_note);

  -- Notify a reviewer pool when work is submitted for review.
  if p_action = 'submit_review' then
    insert into public.notifications (organization_id, profile_id, notification_type, title, body, link)
    select i.organization_id, p.id, 'compliance_requirement_awaiting_review',
      'Compliance item awaiting review', left(r.title, 400), '/app/compliance-command-center'
    from public.profiles p
    where p.organization_id = i.organization_id and p.is_active
      and (p.role = 'org_admin'
           or (p.role = 'facility_manager' and exists (
             select 1 from public.facility_assignments fa where fa.profile_id = p.id and fa.facility_id = i.facility_id)))
      and p.id is distinct from v_actor;
  end if;

  return i;
end $$;
revoke all on function public.transition_compliance_instance(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.transition_compliance_instance(uuid, text, text) to authenticated;

------------------------------------------------------------------------------------------------
-- Reassign an occurrence's responsible person (+ notify).
------------------------------------------------------------------------------------------------
create or replace function public.assign_compliance_instance(p_instance_id uuid, p_profile_id uuid, p_note text default null)
returns public.compliance_requirement_instances
language plpgsql security definer set search_path = '' as $$
declare
  i public.compliance_requirement_instances%rowtype;
  r public.compliance_requirements%rowtype;
begin
  select * into i from public.compliance_requirement_instances where id = p_instance_id for update;
  if not found then raise exception 'Requirement occurrence not found' using errcode = 'P0002'; end if;
  select * into r from public.compliance_requirements where id = i.requirement_id;
  perform app_private.assert_compliance_manager(i.organization_id, i.facility_id);
  if p_profile_id is not null and not exists (
    select 1 from public.profiles p where p.id = p_profile_id and p.organization_id = i.organization_id and p.is_active
  ) then
    raise exception 'The selected person is not an active member of this organization' using errcode = '23514';
  end if;

  update public.compliance_requirement_instances set responsible_profile_id = p_profile_id
  where id = i.id returning * into i;

  insert into public.compliance_requirement_events
    (organization_id, facility_id, requirement_id, instance_id, event_type, actor_profile_id, note, metadata)
  values (i.organization_id, i.facility_id, i.requirement_id, i.id, 'assigned', (select auth.uid()),
    nullif(btrim(coalesce(p_note, '')), ''), jsonb_build_object('responsible_profile_id', p_profile_id));

  if p_profile_id is not null and p_profile_id is distinct from (select auth.uid()) then
    insert into public.notifications (organization_id, profile_id, notification_type, title, body, link)
    values (i.organization_id, p_profile_id, 'compliance_requirement_assigned',
      'Compliance item assigned to you', left(r.title, 400), '/app/compliance-command-center');
  end if;
  return i;
end $$;
revoke all on function public.assign_compliance_instance(uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.assign_compliance_instance(uuid, uuid, text) to authenticated;

------------------------------------------------------------------------------------------------
-- Add a note / comment to a requirement or a specific occurrence.
------------------------------------------------------------------------------------------------
create or replace function public.add_compliance_note(p_requirement_id uuid, p_instance_id uuid, p_note text)
returns public.compliance_requirement_events
language plpgsql security definer set search_path = '' as $$
declare
  r public.compliance_requirements%rowtype;
  v_fac uuid;
  e public.compliance_requirement_events%rowtype;
begin
  if length(btrim(coalesce(p_note, ''))) < 1 then raise exception 'A note is required' using errcode = '22023'; end if;
  select * into r from public.compliance_requirements where id = p_requirement_id;
  if not found then raise exception 'Requirement not found' using errcode = 'P0002'; end if;
  v_fac := r.facility_id;
  if p_instance_id is not null then
    select facility_id into v_fac from public.compliance_requirement_instances where id = p_instance_id and requirement_id = r.id;
    if not found then raise exception 'Occurrence not found for this requirement' using errcode = 'P0002'; end if;
  end if;
  perform app_private.assert_compliance_manager(r.organization_id, coalesce(v_fac, r.facility_id));

  insert into public.compliance_requirement_events
    (organization_id, facility_id, requirement_id, instance_id, event_type, actor_profile_id, note)
  values (r.organization_id, v_fac, r.id, p_instance_id, 'note_added', (select auth.uid()), btrim(p_note))
  returning * into e;
  return e;
end $$;
revoke all on function public.add_compliance_note(uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.add_compliance_note(uuid, uuid, text) to authenticated;

------------------------------------------------------------------------------------------------
-- Record an uploaded evidence document (the file itself is uploaded to the compliance-evidence
-- bucket by the client first, then registered here). Maintains evidence_count for the fast
-- "missing evidence" filter.
------------------------------------------------------------------------------------------------
create or replace function public.attach_compliance_evidence(
  p_instance_id uuid,
  p_storage_path text,
  p_file_name text,
  p_file_type text,
  p_file_size integer default null,
  p_document_label text default null
) returns public.compliance_requirement_documents
language plpgsql security definer set search_path = '' as $$
declare
  i public.compliance_requirement_instances%rowtype;
  d public.compliance_requirement_documents%rowtype;
begin
  select * into i from public.compliance_requirement_instances where id = p_instance_id for update;
  if not found then raise exception 'Requirement occurrence not found' using errcode = 'P0002'; end if;
  perform app_private.assert_compliance_manager(i.organization_id, i.facility_id);
  if length(btrim(coalesce(p_storage_path, ''))) < 1 or length(btrim(coalesce(p_file_name, ''))) < 1 then
    raise exception 'A stored file is required' using errcode = '22023';
  end if;

  insert into public.compliance_requirement_documents
    (organization_id, facility_id, requirement_id, instance_id, storage_path, file_name, file_type, file_size, document_label, uploaded_by_profile_id)
  values (i.organization_id, i.facility_id, i.requirement_id, i.id, btrim(p_storage_path), btrim(p_file_name),
    coalesce(nullif(btrim(coalesce(p_file_type, '')), ''), 'application/octet-stream'), p_file_size,
    nullif(btrim(coalesce(p_document_label, '')), ''), (select auth.uid()))
  returning * into d;

  update public.compliance_requirement_instances set evidence_count = evidence_count + 1 where id = i.id;

  insert into public.compliance_requirement_events
    (organization_id, facility_id, requirement_id, instance_id, event_type, actor_profile_id, note, metadata)
  values (i.organization_id, i.facility_id, i.requirement_id, i.id, 'evidence_added', (select auth.uid()),
    coalesce(d.document_label, d.file_name), jsonb_build_object('document_id', d.id));
  return d;
end $$;
revoke all on function public.attach_compliance_evidence(uuid, text, text, text, integer, text) from public, anon, authenticated, service_role;
grant execute on function public.attach_compliance_evidence(uuid, text, text, text, integer, text) to authenticated;

create or replace function public.remove_compliance_evidence(p_document_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare d public.compliance_requirement_documents%rowtype;
begin
  select * into d from public.compliance_requirement_documents where id = p_document_id;
  if not found then raise exception 'Document not found' using errcode = 'P0002'; end if;
  perform app_private.assert_compliance_manager(d.organization_id, d.facility_id);

  delete from public.compliance_requirement_documents where id = d.id;
  if d.instance_id is not null then
    update public.compliance_requirement_instances set evidence_count = greatest(evidence_count - 1, 0) where id = d.instance_id;
  end if;
  insert into public.compliance_requirement_events
    (organization_id, facility_id, requirement_id, instance_id, event_type, actor_profile_id, note, metadata)
  values (d.organization_id, d.facility_id, d.requirement_id, d.instance_id, 'evidence_removed', (select auth.uid()),
    coalesce(d.document_label, d.file_name), jsonb_build_object('storage_path', d.storage_path));
  return true;
end $$;
revoke all on function public.remove_compliance_evidence(uuid) from public, anon, authenticated, service_role;
grant execute on function public.remove_compliance_evidence(uuid) to authenticated;

------------------------------------------------------------------------------------------------
-- Daily maintenance: generate upcoming occurrences, flip overdue, send due-soon reminders, and
-- escalate overdue occurrences to org admins + assigned facility managers. cron-invoked; SECURITY
-- DEFINER so it runs org-wide without a JWT (mirrors recalculate_resident_compliance_statuses).
------------------------------------------------------------------------------------------------
create or replace function public.run_compliance_requirement_maintenance(p_today date default current_date)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  r record;
  i record;
  v_profile uuid;
  v_touched integer := 0;
begin
  -- 1. Ensure occurrences exist through each requirement's warning window.
  for r in select id, warning_days from public.compliance_requirements
           where is_active and not is_template and facility_id is not null loop
    perform app_private.ensure_compliance_instances(r.id, p_today + greatest(r.warning_days, 30));
  end loop;

  -- 2. Flip past-due, non-terminal occurrences to overdue.
  update public.compliance_requirement_instances
  set status = 'overdue'
  where status in ('not_started', 'in_progress') and due_date < p_today;

  -- 3. Due-soon reminders (once per occurrence) to the responsible person, or to facility
  --    managers + org admins when unassigned.
  for i in
    select ci.*, cr.title, cr.warning_days
    from public.compliance_requirement_instances ci
    join public.compliance_requirements cr on cr.id = ci.requirement_id
    where ci.status in ('not_started', 'in_progress')
      and ci.due_date >= p_today
      and ci.due_date <= p_today + cr.warning_days
      and ci.reminder_sent_on is null
      and cr.is_active
  loop
    if i.responsible_profile_id is not null then
      insert into public.notifications (organization_id, profile_id, notification_type, title, body, link)
      values (i.organization_id, i.responsible_profile_id, 'compliance_requirement_due_soon',
        'Compliance item due soon', left(i.title, 400), '/app/compliance-command-center');
    else
      for v_profile in
        select p.id from public.profiles p
        where p.organization_id = i.organization_id and p.is_active
          and (p.role = 'org_admin' or (p.role = 'facility_manager' and exists (
            select 1 from public.facility_assignments fa where fa.profile_id = p.id and fa.facility_id = i.facility_id)))
      loop
        insert into public.notifications (organization_id, profile_id, notification_type, title, body, link)
        values (i.organization_id, v_profile, 'compliance_requirement_due_soon',
          'Compliance item due soon', left(i.title, 400), '/app/compliance-command-center');
      end loop;
    end if;
    update public.compliance_requirement_instances set reminder_sent_on = p_today where id = i.id;
    v_touched := v_touched + 1;
  end loop;

  -- 4. Escalate overdue occurrences to org admins + assigned facility managers, at most daily.
  for i in
    select ci.*, cr.title
    from public.compliance_requirement_instances ci
    join public.compliance_requirements cr on cr.id = ci.requirement_id
    where ci.status = 'overdue'
      and (ci.last_escalated_at is null or ci.last_escalated_at < p_today::timestamptz)
      and cr.is_active
  loop
    for v_profile in
      select p.id from public.profiles p
      where p.organization_id = i.organization_id and p.is_active
        and (p.role = 'org_admin' or (p.role = 'facility_manager' and exists (
          select 1 from public.facility_assignments fa where fa.profile_id = p.id and fa.facility_id = i.facility_id)))
    loop
      insert into public.notifications (organization_id, profile_id, notification_type, title, body, link)
      values (i.organization_id, v_profile, 'compliance_requirement_overdue',
        'Overdue compliance item', left(i.title, 400), '/app/compliance-command-center');
    end loop;
    update public.compliance_requirement_instances
      set escalation_level = escalation_level + 1, last_escalated_at = now()
    where id = i.id;
    v_touched := v_touched + 1;
  end loop;

  return v_touched;
end $$;
revoke all on function public.run_compliance_requirement_maintenance(date) from public, anon, authenticated, service_role;

select cron.schedule(
  'compliance-requirement-maintenance-daily',
  '15 6 * * *',
  $$ select public.run_compliance_requirement_maintenance(); $$
);
