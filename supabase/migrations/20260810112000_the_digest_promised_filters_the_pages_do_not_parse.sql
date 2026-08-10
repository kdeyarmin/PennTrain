-- The manager digest's deep links carried query strings their destinations reject or ignore.
--
-- 20260803040000 fixed exactly this for the two items it added ("Paths point at pages that
-- exist, with no query string that the destination does not parse") but carried the five older
-- items forward untouched. Four of those five break the promise:
--
--   * '/app/incidents?status=open' is the worst of them: incidents.status is constrained to
--     ('reported','investigating','closed') and the Incidents page feeds the URL value straight
--     into an equality filter, so a manager whose digest says "3 open incidents" clicks through
--     to "No incidents found" -- a filter on a status that cannot exist. The count reads as
--     work that vanished.
--   * '/app/training-matrix?status=overdue' -- the matrix reads `statusFilter`, not `status`,
--     and has no 'overdue' value; lands unfiltered while looking filtered.
--   * '/app/credentials?status=expiring&withinDays=30' -- the credentials page reads
--     facilityFilter/employeeFilter/statusFilter only; both params are ignored.
--   * '/trainer/classes?range=this-week' -- no `range` param exists.
--
-- '/app/alerts?status=open' is the one carried-forward query string that is genuine: the Alerts
-- page parses `status` and 'open' is a value it accepts. It stays.
--
-- As in 20260803040000, the body below is pg_get_functiondef of the LIVE function with two
-- substituted regions -- the four path literals and the comment above them -- and every other
-- line carried forward verbatim, because a CREATE OR REPLACE rebased on an older migration
-- silently deletes every change made to the function since.
--
-- Already-queued snapshots store these paths as data, and the digest notification links to the
-- snapshot page for as long as the notification exists, so stored items are rewritten too.
--
-- Rollback: CREATE OR REPLACE from 20260803040000, and the inverse path replacements on
-- manager_digest_snapshots.items.

CREATE OR REPLACE FUNCTION public.queue_manager_weekly_digests()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_profile public.profiles%rowtype;
  v_facility_ids uuid[];
  v_credentials integer;
  v_training integer;
  v_incidents integer;
  v_alerts integer;
  v_classes integer;
  v_resident_items integer;
  v_poc_due integer;
  v_inserted integer := 0;
  v_body text;
  v_items jsonb;
  v_digest_id uuid;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role'
     and current_user not in ('postgres','supabase_admin') then
    raise exception 'Only the trusted digest worker may queue manager digests'
      using errcode = '42501';
  end if;
  for v_profile in
    select p.* from public.profiles p
    join public.organizations o on o.id = p.organization_id
    where p.is_active and p.role in ('org_admin','facility_manager')
      and o.subscription_status not in ('suspended','canceled')
  loop
    if exists (
      select 1 from public.notifications n
      where n.profile_id = v_profile.id
        and n.notification_type = 'manager_weekly_digest'
        and n.created_at >= public.pa_midnight(public.pa_week_start(now()))
    ) then continue; end if;

    if v_profile.role = 'org_admin' then
      select coalesce(array_agg(f.id), '{}'::uuid[]) into v_facility_ids
      from public.facilities f
      where f.organization_id = v_profile.organization_id
        and f.is_active and not f.is_sandbox;
    else
      select coalesce(array_agg(f.id), '{}'::uuid[]) into v_facility_ids
      from public.facility_assignments fa
      join public.facilities f on f.id = fa.facility_id
      where fa.profile_id = v_profile.id and f.is_active and not f.is_sandbox;
    end if;
    if cardinality(v_facility_ids) = 0 then continue; end if;

    select count(*) into v_credentials from public.employee_credentials c
    where c.facility_id = any(v_facility_ids)
      and c.expiration_date between public.pa_today() and public.pa_today() + 30;
    select count(*) into v_training from (
      select distinct on (r.employee_id, r.training_type_id) r.status
      from public.employee_training_records r
      where r.facility_id = any(v_facility_ids)
      order by r.employee_id, r.training_type_id,
        r.due_date desc nulls last, r.completion_date desc nulls last, r.created_at desc,
        (r.status = 'missing'), r.id
    ) cur
    where cur.status in ('expired','missing');
    select count(*) into v_incidents from public.incidents i
    where i.facility_id = any(v_facility_ids) and i.status <> 'closed';
    select count(*) into v_alerts from public.alerts a
    where a.facility_id = any(v_facility_ids) and a.status = 'open';
    select count(*) into v_classes from public.training_classes c
    where c.facility_id = any(v_facility_ids)
      and c.class_date between public.pa_today() and public.pa_today() + 6
      and c.status <> 'cancelled';
    -- Carried over from send_monday_digest(), which is losing its schedule below. Restricted to
    -- active residents for the same reason it was there: an item against a discharged resident is
    -- not this week's work.
    select count(*) into v_resident_items
    from public.resident_compliance_items i
    join public.residents res on res.id = i.resident_id
    where i.facility_id = any(v_facility_ids)
      and res.status = 'active'
      and i.status in ('due_soon','expired');
    -- BACKLOG.md C4, digest half: a plan of correction whose due date is within a week or already
    -- past, on a violation whose plan has NOT yet been submitted. Counted from the facility day,
    -- like every other date comparison in this function.
    --
    -- 'open' only. The first cut also counted 'poc_submitted', which put this tally out of step
    -- with run_plan_of_correction_escalations once that sweep narrowed to unsubmitted plans. The
    -- digest is the number a manager reconciles against, so a tally larger than anything the
    -- daily job escalates reads as "some of these are silently unescalated" when the difference
    -- is entirely work already done. poc_due_date is the deadline to SUBMIT and
    -- submit_plan_of_correction meets it; what remains after that is corrective-action work
    -- items with their own escalation (C3), which is not this line.
    select count(*) into v_poc_due
    from public.dhs_violations v
    where v.facility_id = any(v_facility_ids)
      and v.status = 'open'
      and v.poc_due_date is not null
      and v.poc_due_date <= public.pa_today() + 7;

    v_body := format(
      '%s credentials expiring; %s overdue or missing training items; %s open incidents; '
        || '%s unacknowledged alerts; %s classes this week; %s resident compliance items due or overdue; '
        || '%s plans of correction due or overdue.',
      v_credentials, v_training, v_incidents, v_alerts, v_classes, v_resident_items, v_poc_due
    );
    -- Paths point at pages that exist, with no query string that the destination does not parse.
    -- The first cut used ?complianceStatus=due and ?pocStatus=due; Residents/Violations accept only
    -- search/facility/status/page, so both silently opened an ordinary unfiltered list while looking
    -- like a filtered one. Resident compliance items get their own report page. Violations has a
    -- status filter, and now that this count is 'open' only, ?status=open would at least be a
    -- valid value -- but the count is also narrowed by due date and that filter is not, so the
    -- list would still be larger than the number beside it. Worse than no filter, so still none.
    --
    -- The carried-forward items hold to the same rule. Incidents has a status filter, but 'open'
    -- is not a value its table allows ('reported','investigating','closed'), so ?status=open
    -- rendered an EMPTY list under a non-zero count, and the page cannot express "not closed" --
    -- no filter. The training matrix reads statusFilter (with no 'overdue' value), credentials
    -- reads facilityFilter/employeeFilter/statusFilter, and classes has no range param -- each
    -- ignored its query string while looking filtered, so none carry one. Alerts keeps
    -- ?status=open: that page parses status, and 'open' is the very value this count uses.
    v_items := jsonb_build_array(
      jsonb_build_object('key','credentials','label','Credentials expiring within 30 days','count',v_credentials,'path','/app/credentials'),
      jsonb_build_object('key','training','label','Overdue or missing training items','count',v_training,'path','/app/training-matrix'),
      jsonb_build_object('key','incidents','label','Open incidents','count',v_incidents,'path','/app/incidents'),
      jsonb_build_object('key','alerts','label','Unacknowledged alerts','count',v_alerts,'path','/app/alerts?status=open'),
      jsonb_build_object('key','classes','label','Classes this week','count',v_classes,'path','/trainer/classes'),
      jsonb_build_object('key','resident_compliance','label','Resident compliance items due or overdue','count',v_resident_items,'path','/app/resident-compliance'),
      jsonb_build_object('key','poc','label','Plans of correction due or overdue','count',v_poc_due,'path','/app/violations')
    );
    insert into public.manager_digest_snapshots (
      organization_id, profile_id, week_started_on, items
    ) values (
      v_profile.organization_id, v_profile.id, public.pa_week_start(now()), v_items
    )
    on conflict (profile_id, week_started_on) do update set items = excluded.items
    returning id into v_digest_id;
    insert into public.notifications (
      organization_id, profile_id, notification_type, title, body, link
    ) values (
      v_profile.organization_id, v_profile.id, 'manager_weekly_digest',
      'Your weekly manager digest', v_body, '/account/manager-digest/' || v_digest_id
    );
    v_inserted := v_inserted + 1;
  end loop;
  return v_inserted;
end;
$function$;

-- Snapshots already queued with the old paths keep serving them from the digest page until the
-- next weekly upsert; the notification that links to a snapshot has no expiry, so the stored
-- items are corrected in place. Path values only -- keys, labels and counts are untouched.
update public.manager_digest_snapshots s
   set items = (
     select jsonb_agg(
       case item->>'path'
         when '/app/credentials?status=expiring&withinDays=30' then jsonb_set(item, '{path}', '"/app/credentials"')
         when '/app/training-matrix?status=overdue' then jsonb_set(item, '{path}', '"/app/training-matrix"')
         when '/app/incidents?status=open' then jsonb_set(item, '{path}', '"/app/incidents"')
         when '/trainer/classes?range=this-week' then jsonb_set(item, '{path}', '"/trainer/classes"')
         else item
       end
       order by ord
     )
     from jsonb_array_elements(s.items) with ordinality as elems(item, ord)
   )
 where s.items::text like '%/app/incidents?status=open%'
    or s.items::text like '%/app/training-matrix?status=overdue%'
    or s.items::text like '%/app/credentials?status=expiring%'
    or s.items::text like '%/trainer/classes?range=this-week%';
