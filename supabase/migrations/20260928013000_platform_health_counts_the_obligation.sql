-- Platform health still read the wrong obligation.
--
-- A clearance is due on the earlier of the document expiration and the facility
-- renewal. These two tiles still used expiration_date, so a policy date inside
-- 30 days was missing behind a later document, and a document date inside 30
-- days was still "expiring" after the policy date had passed. A waived
-- credential (not_applicable) kept its old document date and counted too.
--
-- A canceled assignment is closed. A paused assignment keeps its old due date
-- while leave stops the clock. The assignment analytics already ignore both.
-- These tiles still treated that historical date as incomplete and overdue.
--
-- The overdue-training tile picks one current row per person and type, but a
-- full date tie had no missing-last rule. The rulepack placeholder created in
-- the same write could be the row that counted. The dashboard already breaks
-- that tie toward the real record.

do $cl29do$
declare
  body text;
begin
  select pg_get_functiondef('public.get_platform_health()'::regprocedure) into body;
  if body is null then
    raise exception 'public.get_platform_health is missing';
  end if;

  if position('least(expiration_date, policy_renewal_due_date) < v_today' in body) > 0 then
    raise notice 'platform health already dates credentials on the governing date';
  else
    if position($cl29$    'expiredCredentials', (
      select count(*) from public.employee_credentials
      where expiration_date is not null and expiration_date < v_today
    ),
    'expiringCredentialsWithin30Days', (
      select count(*) from public.employee_credentials
      where expiration_date is not null
        and expiration_date >= v_today
        and expiration_date <= v_soon
    ),$cl29$ in body) = 0 then
      raise exception 'platform health credential counts changed';
    end if;
    body := replace(body, $cl29$    'expiredCredentials', (
      select count(*) from public.employee_credentials
      where expiration_date is not null and expiration_date < v_today
    ),
    'expiringCredentialsWithin30Days', (
      select count(*) from public.employee_credentials
      where expiration_date is not null
        and expiration_date >= v_today
        and expiration_date <= v_soon
    ),$cl29$, $cl29$    'expiredCredentials', (
      select count(*) from public.employee_credentials
      where status is distinct from 'not_applicable'
        and least(expiration_date, policy_renewal_due_date) is not null
        and least(expiration_date, policy_renewal_due_date) < v_today
    ),
    'expiringCredentialsWithin30Days', (
      select count(*) from public.employee_credentials
      where status is distinct from 'not_applicable'
        and least(expiration_date, policy_renewal_due_date) is not null
        and least(expiration_date, policy_renewal_due_date) >= v_today
        and least(expiration_date, policy_renewal_due_date) <= v_soon
    ),$cl29$);
    execute body;
  end if;

  select pg_get_functiondef('public.get_platform_health()'::regprocedure) into body;
  if position('status not in (''completed'', ''canceled'', ''paused'')' in body) > 0 then
    raise notice 'platform health already skips closed assignments';
  else
    if position($cl29$    'incompleteCourseAssignments', (
      select count(*) from public.course_assignments where status is distinct from 'completed'
    ),
    'overdueCourseAssignments', (
      select count(*) from public.course_assignments
      where status is distinct from 'completed'
        and due_date is not null
        and due_date < v_today
    ),$cl29$ in body) = 0 then
      raise exception 'platform health assignment counts changed';
    end if;
    body := replace(body, $cl29$    'incompleteCourseAssignments', (
      select count(*) from public.course_assignments where status is distinct from 'completed'
    ),
    'overdueCourseAssignments', (
      select count(*) from public.course_assignments
      where status is distinct from 'completed'
        and due_date is not null
        and due_date < v_today
    ),$cl29$, $cl29$    'incompleteCourseAssignments', (
      select count(*) from public.course_assignments
      where status not in ('completed', 'canceled', 'paused')
    ),
    'overdueCourseAssignments', (
      select count(*) from public.course_assignments
      where status not in ('completed', 'canceled', 'paused')
        and due_date is not null
        and due_date < v_today
    ),$cl29$);
    execute body;
  end if;

  select pg_get_functiondef('public.get_platform_health()'::regprocedure) into body;
  if position('created_at desc nulls last,' || E'\n' || '          (status = ''missing''), id' in body) > 0 then
    raise notice 'platform health already prefers the real training record';
  else
    if position($cl29$        order by employee_id, training_type_id,
          due_date desc nulls last,
          completion_date desc nulls last,
          created_at desc nulls last$cl29$ in body) = 0 then
      raise exception 'platform health training order changed';
    end if;
    body := replace(body, $cl29$        order by employee_id, training_type_id,
          due_date desc nulls last,
          completion_date desc nulls last,
          created_at desc nulls last$cl29$, $cl29$        order by employee_id, training_type_id,
          due_date desc nulls last,
          completion_date desc nulls last,
          created_at desc nulls last,
          (status = 'missing'), id$cl29$);
    execute body;
  end if;
end;
$cl29do$;
