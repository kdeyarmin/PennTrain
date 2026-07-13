-- Complete the browser-safe command surface for the Phase 5 work_items engine.
-- Direct table writes remain service-role only; authenticated users act through scoped RPCs.

alter table public.work_item_templates drop constraint work_item_templates_source_type_check;
alter table public.work_item_templates add constraint work_item_templates_source_type_check
  check (source_type in (
    'violation', 'inspection', 'incident', 'near_miss', 'training_gap',
    'exclusion_match', 'credential', 'policy', 'rule_exception', 'move_in',
    'complaint', 'support_plan', 'qapi'
  ));

insert into storage.buckets (id, name, public)
values ('work-item-evidence', 'work-item-evidence', false)
on conflict (id) do nothing;

create policy "work-item-evidence insert"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'work-item-evidence'
  and exists (
    select 1
    from public.work_items w
    where w.organization_id::text = (storage.foldername(name))[1]
      and w.facility_id::text = (storage.foldername(name))[2]
      and w.id::text = (storage.foldername(name))[3]
      and (
        public.is_platform_admin()
        or (
          w.organization_id = (select public.current_org_id())
          and (
            (select public.current_role()) in ('org_admin', 'facility_manager')
            or w.owner_profile_id = (select auth.uid())
          )
          and (
            (select public.current_role()) <> 'facility_manager'
            or public.is_assigned_to_facility(w.facility_id)
          )
        )
      )
  )
);

create policy "work-item-evidence read"
on storage.objects for select to authenticated
using (
  bucket_id = 'work-item-evidence'
  and exists (
    select 1
    from public.work_item_evidence e
    join public.work_items w on w.id = e.work_item_id
    where e.storage_bucket = storage.objects.bucket_id
      and e.storage_path = storage.objects.name
      and (
        public.is_platform_admin()
        or (
          w.organization_id = (select public.current_org_id())
          and (
            (select public.current_role()) in ('org_admin', 'auditor')
            or public.is_assigned_to_facility(w.facility_id)
            or w.owner_profile_id = (select auth.uid())
          )
        )
      )
  )
);

create policy work_watchers_select on public.work_item_watchers
for select to authenticated
using (
  exists (
    select 1 from public.work_items w
    where w.id = work_item_id
      and (
        public.is_platform_admin()
        or (
          w.organization_id = (select public.current_org_id())
          and (
            (select public.current_role()) in ('org_admin', 'auditor')
            or public.is_assigned_to_facility(w.facility_id)
            or w.owner_profile_id = (select auth.uid())
          )
        )
      )
  )
);

create policy work_dependencies_select on public.work_item_dependencies
for select to authenticated
using (
  exists (
    select 1 from public.work_items w
    where w.id = work_item_id
      and (
        public.is_platform_admin()
        or (
          w.organization_id = (select public.current_org_id())
          and (
            (select public.current_role()) in ('org_admin', 'auditor')
            or public.is_assigned_to_facility(w.facility_id)
            or w.owner_profile_id = (select auth.uid())
          )
        )
      )
  )
);

create policy work_comments_select on public.work_item_comments
for select to authenticated
using (
  exists (
    select 1 from public.work_items w
    where w.id = work_item_id
      and (
        public.is_platform_admin()
        or (
          w.organization_id = (select public.current_org_id())
          and (
            (select public.current_role()) in ('org_admin', 'auditor')
            or public.is_assigned_to_facility(w.facility_id)
            or w.owner_profile_id = (select auth.uid())
          )
        )
      )
  )
);

create policy work_evidence_select on public.work_item_evidence
for select to authenticated
using (
  exists (
    select 1 from public.work_items w
    where w.id = work_item_id
      and (
        public.is_platform_admin()
        or (
          w.organization_id = (select public.current_org_id())
          and (
            (select public.current_role()) in ('org_admin', 'auditor')
            or public.is_assigned_to_facility(w.facility_id)
            or w.owner_profile_id = (select auth.uid())
          )
        )
      )
  )
);

grant select on public.work_item_watchers, public.work_item_dependencies,
  public.work_item_comments, public.work_item_evidence to authenticated;

create or replace function app_private.get_work_item_for_contributor(
  p_work_item_id uuid,
  p_manager_required boolean default false
)
returns public.work_items
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_work public.work_items%rowtype;
  v_is_manager boolean;
begin
  select * into v_work from public.work_items where id = p_work_item_id;
  if not found then
    raise exception 'Work item not found' using errcode = 'P0002';
  end if;

  v_is_manager := coalesce(auth.jwt()->>'role', '') = 'service_role'
    or public.is_platform_admin()
    or (
      public.current_org_id() = v_work.organization_id
      and public.current_role() in ('org_admin', 'facility_manager')
      and (
        public.current_role() <> 'facility_manager'
        or public.is_assigned_to_facility(v_work.facility_id)
      )
    );

  if not v_is_manager and (
    p_manager_required
    or auth.uid() is null
    or public.current_org_id() <> v_work.organization_id
    or v_work.owner_profile_id is distinct from auth.uid()
  ) then
    raise exception 'Work item operation is outside caller scope' using errcode = '42501';
  end if;

  return v_work;
end;
$$;
revoke all on function app_private.get_work_item_for_contributor(uuid, boolean)
  from public, anon, authenticated, service_role;

create or replace function public.add_work_item_comment(
  p_work_item_id uuid,
  p_body text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_work public.work_items%rowtype;
  v_id uuid;
begin
  v_work := app_private.get_work_item_for_contributor(p_work_item_id, false);
  if length(btrim(coalesce(p_body, ''))) not between 1 and 10000 then
    raise exception 'Comment must contain between 1 and 10000 characters' using errcode = '22023';
  end if;
  insert into public.work_item_comments (
    organization_id, work_item_id, author_profile_id, body
  ) values (
    v_work.organization_id, v_work.id, auth.uid(), btrim(p_body)
  ) returning id into v_id;
  insert into public.work_item_history (
    organization_id, facility_id, work_item_id, event_type, prior_state,
    resulting_state, actor_profile_id, reason
  ) values (
    v_work.organization_id, v_work.facility_id, v_work.id, 'commented',
    v_work.state, v_work.state, auth.uid(), 'Comment added'
  );
  return v_id;
end;
$$;

create or replace function public.set_work_item_watching(
  p_work_item_id uuid,
  p_watching boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_work public.work_items%rowtype;
begin
  v_work := app_private.get_work_item_for_contributor(p_work_item_id, false);
  if p_watching then
    insert into public.work_item_watchers(work_item_id, profile_id)
    values (v_work.id, auth.uid())
    on conflict (work_item_id, profile_id) do nothing;
  else
    delete from public.work_item_watchers
    where work_item_id = v_work.id and profile_id = auth.uid();
  end if;
  return p_watching;
end;
$$;

create or replace function public.update_work_item_assignment(
  p_work_item_id uuid,
  p_owner_profile_id uuid,
  p_priority text,
  p_due_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_work public.work_items%rowtype;
begin
  v_work := app_private.get_work_item_for_contributor(p_work_item_id, true);
  perform public.assert_identity_assurance('workforce_admin');
  if p_priority not in ('low', 'normal', 'high', 'urgent') or p_due_at is null then
    raise exception 'Invalid work item assignment' using errcode = '22023';
  end if;
  if p_owner_profile_id is not null and not exists (
    select 1 from public.profiles p
    where p.id = p_owner_profile_id
      and p.organization_id = v_work.organization_id
      and p.is_active
  ) then
    raise exception 'Owner must be an active profile in this organization' using errcode = '22023';
  end if;
  update public.work_items
  set owner_profile_id = p_owner_profile_id,
      priority = p_priority,
      due_at = p_due_at,
      updated_at = now()
  where id = v_work.id;
  insert into public.work_item_history (
    organization_id, facility_id, work_item_id, event_type, prior_state,
    resulting_state, actor_profile_id, reason, evidence
  ) values (
    v_work.organization_id, v_work.facility_id, v_work.id, 'assignment_updated',
    v_work.state, v_work.state, auth.uid(), 'Owner, priority, or due date updated',
    jsonb_build_object(
      'priorOwner', v_work.owner_profile_id,
      'owner', p_owner_profile_id,
      'priorPriority', v_work.priority,
      'priority', p_priority,
      'priorDueAt', v_work.due_at,
      'dueAt', p_due_at
    )
  );
  return true;
end;
$$;

create or replace function public.add_work_item_dependency(
  p_work_item_id uuid,
  p_depends_on_work_item_id uuid,
  p_dependency_type text default 'blocks'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_work public.work_items%rowtype;
  v_dependency public.work_items%rowtype;
  v_id uuid;
begin
  v_work := app_private.get_work_item_for_contributor(p_work_item_id, true);
  v_dependency := app_private.get_work_item_for_contributor(p_depends_on_work_item_id, true);
  perform public.assert_identity_assurance('workforce_admin');
  if v_work.organization_id <> v_dependency.organization_id
    or p_work_item_id = p_depends_on_work_item_id
    or p_dependency_type not in ('blocks', 'relates_to') then
    raise exception 'Invalid work item dependency' using errcode = '22023';
  end if;
  insert into public.work_item_dependencies (
    work_item_id, depends_on_work_item_id, dependency_type
  ) values (
    p_work_item_id, p_depends_on_work_item_id, p_dependency_type
  )
  on conflict (work_item_id, depends_on_work_item_id)
  do update set dependency_type = excluded.dependency_type
  returning id into v_id;
  if p_dependency_type = 'blocks' and v_dependency.state <> 'closed'
    and v_work.state not in ('closed', 'canceled') then
    update public.work_items set state = 'blocked', updated_at = now() where id = v_work.id;
  end if;
  insert into public.work_item_history (
    organization_id, facility_id, work_item_id, event_type, prior_state,
    resulting_state, actor_profile_id, reason, evidence
  ) values (
    v_work.organization_id, v_work.facility_id, v_work.id, 'dependency_added',
    v_work.state,
    case when p_dependency_type = 'blocks' and v_dependency.state <> 'closed'
      and v_work.state not in ('closed', 'canceled') then 'blocked' else v_work.state end,
    auth.uid(), 'Work item dependency added',
    jsonb_build_object('dependsOnWorkItemId', p_depends_on_work_item_id, 'type', p_dependency_type)
  );
  return v_id;
end;
$$;

create or replace function public.remove_work_item_dependency(p_dependency_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dependency public.work_item_dependencies%rowtype;
  v_work public.work_items%rowtype;
begin
  select * into v_dependency from public.work_item_dependencies where id = p_dependency_id;
  if not found then raise exception 'Dependency not found' using errcode = 'P0002'; end if;
  v_work := app_private.get_work_item_for_contributor(v_dependency.work_item_id, true);
  perform public.assert_identity_assurance('workforce_admin');
  delete from public.work_item_dependencies where id = p_dependency_id;
  insert into public.work_item_history (
    organization_id, facility_id, work_item_id, event_type, prior_state,
    resulting_state, actor_profile_id, reason, evidence
  ) values (
    v_work.organization_id, v_work.facility_id, v_work.id, 'dependency_removed',
    v_work.state, v_work.state, auth.uid(), 'Work item dependency removed',
    jsonb_build_object('dependsOnWorkItemId', v_dependency.depends_on_work_item_id)
  );
  return true;
end;
$$;

create or replace function public.submit_work_item_evidence(
  p_work_item_id uuid,
  p_evidence_type text,
  p_storage_bucket text default null,
  p_storage_path text default null,
  p_linked_record_type text default null,
  p_linked_record_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_work public.work_items%rowtype;
  v_id uuid;
begin
  v_work := app_private.get_work_item_for_contributor(p_work_item_id, false);
  if length(btrim(coalesce(p_evidence_type, ''))) < 2
    or ((p_storage_path is not null)::integer + (p_linked_record_id is not null)::integer) <> 1
    or (p_storage_path is not null and (
      p_storage_bucket <> 'work-item-evidence'
      or p_storage_path not like
        v_work.organization_id::text || '/' || v_work.facility_id::text || '/' || v_work.id::text || '/%'
    ))
    or (p_linked_record_id is not null and length(btrim(coalesce(p_linked_record_type, ''))) < 2) then
    raise exception 'Invalid work item evidence' using errcode = '22023';
  end if;
  insert into public.work_item_evidence (
    organization_id, facility_id, work_item_id, evidence_type,
    storage_bucket, storage_path, linked_record_type, linked_record_id, submitted_by
  ) values (
    v_work.organization_id, v_work.facility_id, v_work.id, btrim(p_evidence_type),
    p_storage_bucket, p_storage_path, btrim(p_linked_record_type), p_linked_record_id, auth.uid()
  ) returning id into v_id;
  insert into public.work_item_history (
    organization_id, facility_id, work_item_id, event_type, prior_state,
    resulting_state, actor_profile_id, reason, evidence
  ) values (
    v_work.organization_id, v_work.facility_id, v_work.id, 'evidence_submitted',
    v_work.state, v_work.state, auth.uid(), 'Evidence submitted',
    jsonb_build_object('evidenceId', v_id, 'evidenceType', btrim(p_evidence_type))
  );
  return v_id;
end;
$$;

create or replace function public.transition_work_item(
  p_work_item_id uuid,
  p_target_state text,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.work_items%rowtype;
  v_template public.work_item_templates%rowtype;
  v_is_manager boolean;
begin
  select * into v from public.work_items where id = p_work_item_id for update;
  if not found then raise exception 'Work item not found' using errcode = 'P0002'; end if;
  perform app_private.get_work_item_for_contributor(v.id, false);
  v_is_manager := coalesce(auth.jwt()->>'role', '') = 'service_role'
    or public.is_platform_admin()
    or (
      public.current_org_id() = v.organization_id
      and public.current_role() in ('org_admin', 'facility_manager')
      and (public.current_role() <> 'facility_manager' or public.is_assigned_to_facility(v.facility_id))
    );
  select * into v_template from public.work_item_templates where id = v.template_id;
  if p_target_state not in ('open', 'in_progress', 'blocked', 'pending_approval', 'closed', 'canceled')
    or length(btrim(coalesce(p_reason, ''))) < 5
    or v.state in ('closed', 'canceled')
    or (not v_is_manager and p_target_state not in ('in_progress', 'blocked', 'pending_approval')) then
    raise exception 'Invalid work transition' using errcode = '22023';
  end if;
  if p_target_state = 'closed' and coalesce(v_template.approval_required, false) then
    raise exception 'Approval-required work must use approve_work_item' using errcode = '55000';
  end if;
  if p_target_state = 'closed' and (
    exists (
      select 1 from unnest(coalesce(v_template.required_evidence_types, array[]::text[])) r
      where not exists (
        select 1 from public.work_item_evidence e
        where e.work_item_id = v.id and e.evidence_type = r
      )
    )
    or exists (
      select 1
      from public.work_item_dependencies d
      join public.work_items w on w.id = d.depends_on_work_item_id
      where d.work_item_id = v.id and d.dependency_type = 'blocks' and w.state <> 'closed'
    )
  ) then
    raise exception 'Closure evidence or dependencies are incomplete' using errcode = '55000';
  end if;
  update public.work_items
  set state = p_target_state,
      closure_reason = case when p_target_state = 'closed' then btrim(p_reason) else closure_reason end,
      closed_at = case when p_target_state = 'closed' then now() else null end,
      updated_at = now()
  where id = v.id;
  insert into public.work_item_history (
    organization_id, facility_id, work_item_id, event_type, prior_state,
    resulting_state, actor_profile_id, reason
  ) values (
    v.organization_id, v.facility_id, v.id, 'transition', v.state,
    p_target_state, auth.uid(), btrim(p_reason)
  );
  return true;
end;
$$;

create or replace function public.approve_work_item(
  p_work_item_id uuid,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.work_items%rowtype;
  v_template public.work_item_templates%rowtype;
begin
  select * into v from public.work_items where id = p_work_item_id for update;
  if not found then raise exception 'Work item not found' using errcode = 'P0002'; end if;
  perform app_private.get_work_item_for_contributor(v.id, true);
  perform public.assert_identity_assurance('workforce_admin');
  select * into v_template from public.work_item_templates where id = v.template_id;
  if v.state <> 'pending_approval' or not coalesce(v_template.approval_required, false)
    or length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Work item is not ready for approval' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(coalesce(v_template.required_evidence_types, array[]::text[])) r
    where not exists (
      select 1 from public.work_item_evidence e
      where e.work_item_id = v.id and e.evidence_type = r
    )
  ) or exists (
    select 1
    from public.work_item_dependencies d
    join public.work_items w on w.id = d.depends_on_work_item_id
    where d.work_item_id = v.id and d.dependency_type = 'blocks' and w.state <> 'closed'
  ) then
    raise exception 'Approval evidence or dependencies are incomplete' using errcode = '55000';
  end if;
  update public.work_items
  set state = 'closed', approved_by = auth.uid(), approved_at = now(),
      closure_reason = btrim(p_reason), closed_at = now(), updated_at = now()
  where id = v.id;
  insert into public.work_item_history (
    organization_id, facility_id, work_item_id, event_type, prior_state,
    resulting_state, actor_profile_id, reason
  ) values (
    v.organization_id, v.facility_id, v.id, 'approved', v.state,
    'closed', auth.uid(), btrim(p_reason)
  );
  return true;
end;
$$;

create or replace function public.record_work_item_effectiveness(
  p_work_item_id uuid,
  p_result text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.work_items%rowtype;
begin
  v := app_private.get_work_item_for_contributor(p_work_item_id, true);
  perform public.assert_identity_assurance('workforce_admin');
  if v.state <> 'closed'
    or v.effectiveness_review_due_at is null
    or length(btrim(coalesce(p_result, ''))) < 5 then
    raise exception 'Effectiveness review is not available' using errcode = '22023';
  end if;
  update public.work_items
  set effectiveness_result = btrim(p_result), updated_at = now()
  where id = v.id;
  insert into public.work_item_history (
    organization_id, facility_id, work_item_id, event_type, prior_state,
    resulting_state, actor_profile_id, reason
  ) values (
    v.organization_id, v.facility_id, v.id, 'effectiveness_reviewed',
    v.state, v.state, auth.uid(), btrim(p_result)
  );
  return true;
end;
$$;

create or replace function public.escalate_overdue_work_items()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with escalated as (
    update public.work_items w
    set escalated_at = now(),
        priority = case when w.priority in ('low', 'normal') then 'high' else w.priority end,
        updated_at = now()
    where w.state not in ('closed', 'canceled')
      and w.due_at < now()
      and w.escalated_at is null
    returning w.*
  ), history as (
    insert into public.work_item_history (
      organization_id, facility_id, work_item_id, event_type, prior_state,
      resulting_state, actor_profile_id, reason
    )
    select organization_id, facility_id, id, 'escalated', state, state, null,
      'Work item escalated after passing its due date'
    from escalated
    returning 1
  )
  select count(*)::integer into v_count from history;
  return v_count;
end;
$$;
revoke all on function public.escalate_overdue_work_items() from public, anon, authenticated;
grant execute on function public.escalate_overdue_work_items() to service_role;

do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname = 'escalate-overdue-work-items';
  if v_job_id is not null then perform cron.unschedule(v_job_id); end if;
  perform cron.schedule(
    'escalate-overdue-work-items',
    '*/15 * * * *',
    'select public.escalate_overdue_work_items()'
  );
end
$$;

revoke all on function public.add_work_item_comment(uuid, text),
  public.set_work_item_watching(uuid, boolean),
  public.update_work_item_assignment(uuid, uuid, text, timestamptz),
  public.add_work_item_dependency(uuid, uuid, text),
  public.remove_work_item_dependency(uuid),
  public.submit_work_item_evidence(uuid, text, text, text, text, uuid),
  public.approve_work_item(uuid, text),
  public.record_work_item_effectiveness(uuid, text)
from public, anon, authenticated, service_role;

grant execute on function public.add_work_item_comment(uuid, text),
  public.set_work_item_watching(uuid, boolean),
  public.update_work_item_assignment(uuid, uuid, text, timestamptz),
  public.add_work_item_dependency(uuid, uuid, text),
  public.remove_work_item_dependency(uuid),
  public.submit_work_item_evidence(uuid, text, text, text, text, uuid),
  public.approve_work_item(uuid, text),
  public.record_work_item_effectiveness(uuid, text)
to authenticated;

-- Seed global automation templates. New source modules can use the same idempotent trigger helper.
insert into public.work_item_templates (
  template_key, name, source_type, default_priority, due_interval,
  approval_required, escalation_after, default_owner_role
) values
  ('incident.followup', 'Incident follow-up', 'incident', 'high', interval '1 day', true, interval '4 hours', 'facility_manager'),
  ('violation.remediation', 'Violation remediation', 'violation', 'high', interval '7 days', true, interval '1 day', 'facility_manager'),
  ('inspection.deficiency', 'Inspection deficiency', 'inspection', 'high', interval '2 days', true, interval '4 hours', 'facility_manager'),
  ('credential.remediation', 'Credential remediation', 'credential', 'high', interval '1 day', false, interval '4 hours', 'facility_manager'),
  ('move_in.readiness', 'Move-in readiness', 'move_in', 'normal', interval '7 days', true, interval '1 day', 'facility_manager')
on conflict (organization_id, template_key) do nothing;

create or replace function app_private.create_automatic_work_item(
  p_org uuid,
  p_fac uuid,
  p_template_key text,
  p_source_type text,
  p_source_id uuid,
  p_title text,
  p_description text,
  p_priority text,
  p_due_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_template public.work_item_templates%rowtype;
begin
  select * into v_template
  from public.work_item_templates
  where (organization_id = p_org or organization_id is null)
    and template_key = p_template_key
    and is_active
  order by organization_id nulls last
  limit 1;
  if not found then return null; end if;
  insert into public.work_items (
    organization_id, facility_id, template_id, source_type, source_id,
    deduplication_key, title, description, priority, due_at
  ) values (
    p_org, p_fac, v_template.id, p_source_type, p_source_id,
    p_source_type || ':' || p_source_id::text, p_title, p_description,
    coalesce(p_priority, v_template.default_priority),
    coalesce(p_due_at, now() + v_template.due_interval)
  )
  on conflict (organization_id, deduplication_key) do update
    set updated_at = public.work_items.updated_at
  returning id into v_id;
  if not exists (
    select 1 from public.work_item_history
    where work_item_id = v_id and event_type = 'created'
  ) then
    insert into public.work_item_history (
      organization_id, facility_id, work_item_id, event_type,
      resulting_state, reason
    ) values (
      p_org, p_fac, v_id, 'created', 'open', 'Source record created work automatically'
    );
  end if;
  return v_id;
end;
$$;
revoke all on function app_private.create_automatic_work_item(
  uuid, uuid, text, text, uuid, text, text, text, timestamptz
) from public, anon, authenticated, service_role;

create or replace function app_private.route_operational_work()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new jsonb := to_jsonb(new);
begin
  if tg_table_name = 'incidents' then
    perform app_private.create_automatic_work_item(
      new.organization_id, new.facility_id, 'incident.followup', 'incident', new.id,
      'Investigate ' || replace(v_new->>'incident_type', '_', ' '),
      v_new->>'narrative',
      case when v_new->>'severity' = 'critical' then 'urgent'
           when v_new->>'severity' = 'major' then 'high' else 'normal' end,
      now() + case when v_new->>'severity' = 'critical' then interval '1 hour' else interval '1 day' end
    );
  elsif tg_table_name = 'dhs_violations' then
    perform app_private.create_automatic_work_item(
      new.organization_id, new.facility_id, 'violation.remediation', 'violation', new.id,
      'Remediate citation ' || coalesce(v_new->>'citation_ref', 'finding'),
      v_new->>'description',
      case when v_new->>'severity' = 'high' then 'urgent' else 'high' end,
      coalesce((v_new->>'poc_due_date')::timestamptz, now() + interval '7 days')
    );
  elsif tg_table_name = 'inspection_events' and (
    v_new->>'result' in ('fail', 'deficiency_noted')
    or coalesce((v_new->>'follow_up_required')::boolean, false)
  ) then
    perform app_private.create_automatic_work_item(
      new.organization_id, new.facility_id, 'inspection.deficiency', 'inspection', new.id,
      'Resolve inspection deficiency',
      coalesce(v_new->>'deficiency_notes', v_new->>'notes', 'Inspection follow-up required'),
      case when v_new->>'result' = 'fail' then 'urgent' else 'high' end,
      now() + interval '2 days'
    );
  elsif tg_table_name = 'employee_credentials' and v_new->>'status' in ('expired', 'missing') then
    perform app_private.create_automatic_work_item(
      new.organization_id, new.facility_id, 'credential.remediation', 'credential', new.id,
      'Resolve ' || replace(v_new->>'credential_type', '_', ' ') || ' credential',
      coalesce(v_new->>'notes', 'Credential evidence or renewal is required'),
      case when v_new->>'status' = 'expired' then 'urgent' else 'high' end,
      now() + interval '1 day'
    );
  elsif tg_table_name = 'residents' then
    perform app_private.create_automatic_work_item(
      new.organization_id, new.facility_id, 'move_in.readiness', 'move_in', new.id,
      'Complete move-in readiness for ' || (v_new->>'first_name') || ' ' || (v_new->>'last_name'),
      'Coordinate required documents, approvals, room readiness, and admission tasks.',
      'normal',
      (v_new->>'admission_date')::timestamptz
    );
  end if;
  return new;
end;
$$;
revoke all on function app_private.route_operational_work()
  from public, anon, authenticated, service_role;

create trigger route_incident_work
after insert on public.incidents
for each row execute function app_private.route_operational_work();
create trigger route_violation_work
after insert on public.dhs_violations
for each row execute function app_private.route_operational_work();
create trigger route_inspection_work
after insert on public.inspection_events
for each row execute function app_private.route_operational_work();
create trigger route_credential_work
after insert or update of status on public.employee_credentials
for each row when (new.status in ('expired', 'missing'))
execute function app_private.route_operational_work();
create trigger route_move_in_work
after insert on public.residents
for each row execute function app_private.route_operational_work();
