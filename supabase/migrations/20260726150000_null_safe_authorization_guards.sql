-- Make two authorization guards NULL-safe (fixes 20260726140000 and 20260726020000).
--
-- THE BUG, AND WHY IT IS WORTH SPELLING OUT. Both guards were written as:
--
--     if not ( is_platform_admin() or (current_org_id() = <org> and current_role() = '<role>') )
--     then raise exception ... end if;
--
-- `public.current_role()` and `public.current_org_id()` both filter on `p.is_active`, so for a
-- DEACTIVATED profile they return NULL rather than a wrong value. `NULL = 'org_admin'` is NULL, the
-- whole disjunction evaluates to NULL, `not NULL` is NULL -- and `if NULL then` does not execute its
-- branch. The exception never fires and the caller proceeds.
--
-- So the guard failed open for exactly the caller it most needed to stop: someone whose account has
-- been deactivated. A guard that admits a suspended account is worse than no guard, because the
-- audit trail reads as an authorized action.
--
-- Caught by the negative authorization test the Phase 8 exit gate demands -- a deactivated manager
-- calling `grant_duty_eligibility_override` directly returned "no exception". That test is the only
-- reason this was found, which is the argument for requiring one per block.
--
-- THE PATTERN TO AVOID: `if not (<permission expression>) then raise`. Three-valued logic makes the
-- negation of an unknown into "no error". Either wrap the whole expression in `coalesce(..., false)`
-- as below, or write the guard in the positive-failure form the app_private.assert_* helpers use
-- (`if auth.uid() is null or current_org_id() is distinct from p_org or ... then raise`), where
-- `is distinct from` is NULL-safe by construction.
--
-- Rollback: re-apply both function bodies without the coalesce -- though that restores the hole.

create or replace function public.grant_duty_eligibility_override(
  p_profile_id uuid,
  p_duty_key text,
  p_facility_id uuid,
  p_reason text,
  p_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_facility public.facilities%rowtype;
  v_id uuid;
begin
  select * into v_facility from public.facilities where id = p_facility_id;
  if not found then raise exception 'Facility not found' using errcode = 'P0002'; end if;

  -- Only an org admin grants an exemption from a duty rule. A facility manager who could exempt
  -- themselves is not a control.
  --
  -- coalesce(..., false): current_role() and current_org_id() return NULL for a deactivated
  -- profile, and without this the negation is NULL and the exception never fires.
  if not coalesce(
    public.is_platform_admin()
    or (v_facility.organization_id = (select public.current_org_id())
        and (select public.current_role()) = 'org_admin'),
    false
  ) then
    raise exception 'Only an organization administrator may override a duty eligibility rule'
      using errcode = '42501';
  end if;
  if auth.uid() = p_profile_id then
    raise exception 'An override cannot be granted to yourself' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'An override requires a written reason of at least 10 characters'
      using errcode = '22023';
  end if;
  if p_expires_at is null or p_expires_at <= now() then
    raise exception 'An override must expire in the future' using errcode = '22023';
  end if;
  -- A year is already long for an exemption from a qualification rule.
  if p_expires_at > now() + interval '365 days' then
    raise exception 'An override cannot run longer than 365 days' using errcode = '22023';
  end if;

  insert into public.duty_eligibility_overrides(
    organization_id, facility_id, profile_id, duty_key, reason, granted_by, expires_at
  ) values (
    v_facility.organization_id, v_facility.id, p_profile_id, p_duty_key,
    btrim(p_reason), auth.uid(), p_expires_at
  )
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.grant_duty_eligibility_override(uuid, text, uuid, text, timestamptz) from public, anon;
grant execute on function public.grant_duty_eligibility_override(uuid, text, uuid, text, timestamptz) to authenticated, service_role;

-- The same hole in the care-delivery analytics guard from 20260726020000. Only the guard line
-- changes; the entire analytics body below it is the 20260726020000 definition, which is itself the
-- 20260714180000 body with the support-plan state literal corrected.
create or replace function public.get_resident_care_delivery_analytics(p_facility_id uuid, p_from date, p_through date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_fac public.facilities%rowtype;
begin
  select * into v_fac from public.facilities where id=p_facility_id;
  if not found then raise exception 'Facility not found' using errcode='P0002'; end if;
  -- coalesce(..., false): current_role()/current_org_id() are NULL for a deactivated profile, and
  -- `not NULL` is NULL, so without this the guard fails open for exactly that caller.
  if not coalesce(
    coalesce(auth.jwt()->>'role','')='service_role'
    or public.is_platform_admin()
    or (public.current_org_id()=v_fac.organization_id
        and (public.current_role() in ('org_admin','auditor') or public.is_assigned_to_facility(v_fac.id))),
    false
  ) then raise exception 'Analytics outside caller scope' using errcode='42501'; end if;
  return jsonb_build_object(
    'scope', jsonb_build_object('organizationId',v_fac.organization_id,'facilityId',v_fac.id,'from',p_from,'through',p_through,'dateBasis','scheduled_start / event timestamps'),
    'serviceCompletion', jsonb_build_object('numerator',(select count(*) from public.resident_service_task_instances t where t.facility_id=v_fac.id and t.scheduled_start::date between p_from and p_through and t.status in ('completed','completed_late','completed_by_other')),'denominator',(select count(*) from public.resident_service_task_instances t where t.facility_id=v_fac.id and t.scheduled_start::date between p_from and p_through and t.status <> 'superseded'),'definition','Completed service tasks divided by non-superseded scheduled service tasks.'),
    'serviceExceptions', jsonb_build_object('count',(select count(*) from public.resident_service_task_instances t where t.facility_id=v_fac.id and t.scheduled_start::date between p_from and p_through and t.status in ('resident_refused','resident_unavailable','not_completed','completed_late')),'definition','Service tasks recorded with exception statuses.'),
    'repeatedRefusals', jsonb_build_object('count',(select count(*) from (select resident_id, service_name from public.resident_service_task_instances t where t.facility_id=v_fac.id and t.scheduled_start::date between p_from and p_through and t.status='resident_refused' group by resident_id, service_name having count(*) >= 2) s),'definition','Resident/service pairs with two or more refusals in the reporting period.'),
    'changeOfConditionFrequency', jsonb_build_object('count',(select count(*) from public.resident_change_events c where c.facility_id=v_fac.id and c.identified_at::date between p_from and p_through),'definition','Change-of-condition events identified in the reporting period.'),
    'planReviewTimeliness', jsonb_build_object('overdue',(select count(*) from public.resident_support_plans p where p.facility_id=v_fac.id and p.state='active' and p.review_due_date < current_date),'definition','Support plans in force with review due dates before today.'),
    'dmeInspectionStatus', jsonb_build_object('due',(select count(*) from public.resident_dme_items d where d.facility_id=v_fac.id and d.status in ('in_use','needs_repair') and d.inspection_frequency_days is not null and not exists (select 1 from public.resident_dme_history h where h.dme_item_id=d.id and h.event_type='inspected' and h.occurred_at >= now() - (d.inspection_frequency_days || ' days')::interval)),'definition','In-use DME items without an inspection recorded inside their configured frequency window.'),
    'hospitalReturnsOpenFollowUp', jsonb_build_object('count',(select count(*) from public.hospital_transfer_episodes h left join public.work_items w on w.id=h.return_work_item_id where h.facility_id=v_fac.id and h.return_time::date between p_from and p_through and h.status='returned' and coalesce(w.state,'open') <> 'closed'),'definition','Returned transfer episodes whose generated follow-up work is not closed.')
  );
end $$;
