-- A major incident's support-plan stage said "revise the plan or record that it was
-- reviewed and needs no change." Nothing could write the second answer. Approval
-- only looked for a support plan created at or after the incident, so a plan that
-- was read and left alone could not close the stage.
--
-- The review names the plan that already existed, the person, and why nothing
-- changed. A plan created after the incident is still a revision, and that path
-- is unchanged. A review cannot be rewritten after approval.

create table public.incident_support_plan_reviews (
  incident_id uuid primary key references public.incidents(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  resident_id uuid not null references public.residents(id) on delete restrict,
  support_plan_id uuid not null references public.resident_support_plans(id) on delete restrict,
  rationale text not null,
  reviewed_by uuid not null references public.profiles(id),
  reviewed_at timestamptz not null default now(),
  constraint incident_support_plan_reviews_rationale_check
    check (char_length(btrim(rationale)) >= 10)
);

create index incident_support_plan_reviews_organization_id_idx
  on public.incident_support_plan_reviews (organization_id);
create index incident_support_plan_reviews_facility_id_idx
  on public.incident_support_plan_reviews (facility_id);
create index incident_support_plan_reviews_resident_id_idx
  on public.incident_support_plan_reviews (resident_id);
create index incident_support_plan_reviews_support_plan_id_idx
  on public.incident_support_plan_reviews (support_plan_id);
create index incident_support_plan_reviews_reviewed_by_idx
  on public.incident_support_plan_reviews (reviewed_by);

alter table public.incident_support_plan_reviews enable row level security;

create policy incident_support_plan_reviews_select
  on public.incident_support_plan_reviews
  for select
  to authenticated
  using (
    public.is_platform_admin()
    or (
      organization_id = (select public.current_org_id())
      and (
        (select public.current_role()) in ('org_admin', 'auditor')
        or (
          (select public.current_role()) = 'facility_manager'
          and public.is_assigned_to_facility(facility_id)
        )
      )
    )
  );

revoke all on table public.incident_support_plan_reviews from public, anon;
grant select on table public.incident_support_plan_reviews to authenticated;
grant all on table public.incident_support_plan_reviews to service_role;

create or replace function public.record_incident_support_plan_review(
  p_incident_id uuid,
  p_rationale text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.incidents%rowtype;
  v_plan_id uuid;
begin
  if p_incident_id is null then
    raise exception 'Incident is required' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_rationale, ''))) < 10 then
    raise exception 'Record why the support plan needs no change' using errcode = '22023';
  end if;

  select * into v from public.incidents where id = p_incident_id for update;
  if not found then
    raise exception 'Incident not found' using errcode = 'P0002';
  end if;
  perform app_private.assert_incident_manager(v.organization_id, v.facility_id);
  if auth.uid() is null then
    raise exception 'A person has to sign the support-plan review' using errcode = '42501';
  end if;
  if v.status = 'closed' or v.administrator_approved_at is not null then
    raise exception 'This incident is already approved; the support-plan review cannot be rewritten'
      using errcode = '55000';
  end if;
  if v.resident_id is null or v.severity not in ('major', 'critical') then
    raise exception 'A support-plan review is only required for a major or critical incident about a resident'
      using errcode = '55000';
  end if;
  if exists (
    select 1 from public.incident_support_plan_reviews r where r.incident_id = v.id
  ) then
    raise exception 'A support-plan review is already recorded for this incident'
      using errcode = '55000';
  end if;
  if exists (
    select 1 from public.resident_support_plans p
    where p.resident_id = v.resident_id and p.created_at >= v.occurred_at
  ) then
    raise exception 'A support plan was already created after this incident; record the revision instead of no change'
      using errcode = '55000';
  end if;

  select p.id into v_plan_id
  from public.resident_support_plans p
  where p.resident_id = v.resident_id
    and p.created_at < v.occurred_at
  order by p.created_at desc, p.version_number desc
  limit 1;
  if v_plan_id is null then
    raise exception 'There is no support plan from before this incident to review; create one'
      using errcode = '55000';
  end if;

  insert into public.incident_support_plan_reviews (
    incident_id, organization_id, facility_id, resident_id, support_plan_id, rationale, reviewed_by
  ) values (
    v.id, v.organization_id, v.facility_id, v.resident_id, v_plan_id, btrim(p_rationale), auth.uid()
  );
  return v.id;
end $$;

revoke all on function public.record_incident_support_plan_review(uuid, text) from public, anon;
grant execute on function public.record_incident_support_plan_review(uuid, text) to authenticated, service_role;

create or replace function public.get_incident_follow_through(p_incident_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v public.incidents%rowtype;
begin
  select * into v from public.incidents where id = p_incident_id;
  if not found then return null; end if;

  return jsonb_build_object(
    'incident', to_jsonb(v),
    'notifications', coalesce((
      select jsonb_agg(jsonb_build_object(
        'notification_type', n.notification_type, 'status', n.status,
        'due_at', n.due_at, 'completed_at', n.completed_at
      ) order by n.due_at)
      from public.incident_notifications n where n.incident_id = v.id
    ), '[]'::jsonb),
    'corrective_actions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'status', c.status, 'due_date', c.due_date,
        'completed_date', c.completed_date, 'verification_notes', c.verification_notes
      ) order by c.due_date)
      from public.corrective_actions c where c.incident_id = v.id
    ), '[]'::jsonb),
    'assessment_review_finalized', exists (
      select 1 from public.resident_assessment_reviews r
      where r.incident_id = v.id and r.status = 'final'
    ),
    'support_plan_revised_after_incident', v.resident_id is not null and exists (
      select 1 from public.resident_support_plans p
      where p.resident_id = v.resident_id and p.created_at >= v.occurred_at
    ),
    'support_plan_reviewed_no_change', exists (
      select 1 from public.incident_support_plan_reviews r where r.incident_id = v.id
    ),
    'support_plan_review_rationale', (
      select r.rationale from public.incident_support_plan_reviews r where r.incident_id = v.id
    )
  );
end $$;

revoke all on function public.get_incident_follow_through(uuid) from public, anon;
grant execute on function public.get_incident_follow_through(uuid) to authenticated, service_role;

create or replace function public.approve_incident_investigation(
  p_incident_id uuid,
  p_note text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.incidents%rowtype;
  v_open_notifications integer;
  v_open_actions integer;
  v_unverified_actions integer;
  v_reviews_apply boolean;
begin
  select * into v from public.incidents where id = p_incident_id for update;
  if not found then raise exception 'Incident not found' using errcode = 'P0002'; end if;
  perform app_private.assert_incident_manager(v.organization_id, v.facility_id);

  if length(btrim(coalesce(v.immediate_response, ''))) = 0 then
    raise exception 'Record the immediate response before approving the investigation'
      using errcode = '55000';
  end if;
  if v.reportability_status = 'pending_review' then
    raise exception 'Determine whether this incident is reportable before approving it'
      using errcode = '55000';
  end if;

  select count(*) into v_open_notifications
  from public.incident_notifications n
  where n.incident_id = v.id
    and n.status not in ('completed', 'not_required')
    and n.completed_at is null;
  if v_open_notifications > 0 then
    raise exception '% required notification(s) are still outstanding', v_open_notifications
      using errcode = '55000';
  end if;

  if v.pathway_completed_at is null then
    raise exception 'Complete the investigation pathway before approving it' using errcode = '55000';
  end if;
  if length(btrim(coalesce(v.investigation_findings, ''))) = 0 then
    raise exception 'Record the investigation findings before approving it' using errcode = '55000';
  end if;
  if length(btrim(coalesce(v.root_cause, ''))) = 0 or v.root_cause_method is null then
    raise exception 'Record the root cause and the method used to reach it' using errcode = '55000';
  end if;

  select count(*) filter (where c.status not in ('completed', 'cancelled') and c.completed_date is null),
         count(*) filter (where c.status = 'completed' and length(btrim(coalesce(c.verification_notes, ''))) = 0)
    into v_open_actions, v_unverified_actions
  from public.corrective_actions c
  where c.incident_id = v.id;
  if v_open_actions > 0 then
    raise exception '% corrective action(s) are still open', v_open_actions using errcode = '55000';
  end if;
  if v_unverified_actions > 0 then
    raise exception '% completed corrective action(s) have no verification recorded', v_unverified_actions
      using errcode = '55000';
  end if;

  v_reviews_apply := v.resident_id is not null and v.severity in ('major', 'critical');
  if v_reviews_apply then
    if not exists (
      select 1 from public.resident_assessment_reviews r
      where r.incident_id = v.id and r.status = 'final'
    ) then
      raise exception 'Finalize the post-incident assessment review before approving it'
        using errcode = '55000';
    end if;
    if not exists (
      select 1 from public.resident_support_plans p
      where p.resident_id = v.resident_id and p.created_at >= v.occurred_at
    ) and not exists (
      select 1 from public.incident_support_plan_reviews r
      where r.incident_id = v.id
    ) then
      raise exception 'Revise the support plan, or record a review of it, before approving this incident'
        using errcode = '55000';
    end if;
  end if;

  if v.qapi_consideration = 'pending'
     and (v.incident_type in ('abuse_allegation', 'neglect_allegation', 'death', 'elopement', 'medication_error')
          or v.severity in ('major', 'critical')) then
    raise exception 'Record whether this incident warrants a QAPI project before approving it'
      using errcode = '55000';
  end if;

  update public.incidents set
    administrator_approved_at = now(),
    administrator_approved_by = auth.uid(),
    administrator_approval_note = nullif(btrim(coalesce(p_note, '')), ''),
    updated_at = now()
  where id = v.id;
  return true;
end $$;

revoke all on function public.approve_incident_investigation(uuid, text) from public, anon;
grant execute on function public.approve_incident_investigation(uuid, text) to authenticated, service_role;
