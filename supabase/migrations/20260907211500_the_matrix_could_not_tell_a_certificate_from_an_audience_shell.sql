-- The training matrix could not tell a certificate awaiting review from an audience shell.
--
-- Both appear in `employee_training_records.status` as `pending_review`, and they want opposite
-- things from an edit:
--
--   * A certificate awaiting approval, written by the Pending Approvals queue as
--     `status = 'pending_review'` WITH `approval_status = 'pending'`. Only a reviewer may graduate
--     it; an ordinary edit that recomputed the status would credit a certificate nobody had read.
--     Measured: the employee's annual bucket goes from crediting nothing to `completed_hours 8.00`
--     while `approval_status` is still `pending` and `verified_at` null.
--
--   * An auto-instantiated audience shell, `approval_status` NULL. For a training type with
--     `audience_verification_required`, that column's own comment (20260715210000) says the
--     requirement "remains pending_review and is excluded from annual-hour rollups until an
--     employer confirms this exact audience by changing the record to an active requirement
--     status". Recording training against such a cell IS that confirmation, so its status MUST
--     recompute -- preserving it would save the completion and the hours while
--     `recalculate_compliance_core` went on excluding them. The seeded demo tenant alone carries 47
--     of these.
--
-- `approval_status` is the only column that separates them: the reviewer's queue filters on it, and
-- a shell has never been through that queue. This function did not return it, so the client had no
-- way to tell, which is why the fix is here rather than in the page. Additive and type-neutral: the
-- cell is built with `jsonb_build_object` into a `jsonb` return, so no generated type moves.
--
-- Everything else is byte-identical to 20260801030000.

create or replace function public.get_training_matrix_page(
  p_facility_id uuid default null,
  p_search text default null,
  p_status_filter text default 'all',
  p_trainer_only boolean default false,
  p_meds_only boolean default false,
  p_due_within_days integer default null,
  p_sort_field text default 'lastName',
  p_sort_dir text default 'asc',
  p_page integer default 1,
  p_page_size integer default 15,
  p_today date default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  -- The caller passes its own local day so a due-date window doesn't shift by one for
  -- facilities west of UTC, matching how the page compared dates client-side. The fallback is
  -- pa_today() -- the facility (America/New_York) day. Hosted Supabase runs UTC, where the
  -- server's own calendar day is already tomorrow every evening after 20:00 ET and would pull
  -- the next day's renewals into a "due within 30 days" window. See 20260727010100 and
  -- pa_day_is_the_facility_day.test.sql, whose ratchet greps every function body for the UTC
  -- spelling -- including comments, so this one deliberately avoids naming it.
  v_today date := coalesce(p_today, public.pa_today());
  -- 500 mirrors the compliance binder's MAX_LISTED_ROWS cap; the CSV export asks for a
  -- full page at this size rather than streaming an unbounded result set.
  v_limit integer := least(greatest(coalesce(p_page_size, 15), 1), 500);
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_status text := coalesce(nullif(btrim(coalesce(p_status_filter, '')), ''), 'all');
  v_trainer_only boolean := coalesce(p_trainer_only, false);
  v_meds_only boolean := coalesce(p_meds_only, false);
  v_sort_field text := case
    when p_sort_field in ('firstName', 'jobTitle', 'lastName') then p_sort_field
    else 'lastName'
  end;
  v_sort_dir text := case when lower(coalesce(p_sort_dir, 'asc')) = 'desc' then 'desc' else 'asc' end;
  v_result jsonb;
begin
  if v_status not in ('all', 'compliant', 'due_soon', 'expired', 'missing') then
    raise exception 'unsupported training matrix status filter: %', v_status using errcode = '22023';
  end if;
  if p_due_within_days is not null and p_due_within_days < 0 then
    raise exception 'due-window days must not be negative' using errcode = '22023';
  end if;

  with types as (
    select t.id, t.code, t.name, t.applies_to_facility_type, t.sort_order
    from public.training_types t
    where t.is_active
  ),
  emp as (
    select e.*, f.facility_type
    from public.employees e
    left join public.facilities f on f.id = e.facility_id
    where e.status = 'active'
      and (p_facility_id is null or e.facility_id = p_facility_id)
  ),
  -- Employees accumulate a fresh row per renewal cycle rather than updating the prior one,
  -- so "current" is the row with the furthest-out due date, then completion, then created_at.
  -- nulls last matches the client's null-sorts-lowest comparison it replaces.
  current_records as (
    select distinct on (r.employee_id, r.training_type_id)
      r.employee_id, r.training_type_id, r.id, r.status, r.approval_status,
      r.completion_date, r.due_date, r.trainer_name, r.hours
    from public.employee_training_records r
    where r.employee_id in (select id from emp)
      and r.training_type_id in (select id from types)
      and (p_facility_id is null or r.facility_id = p_facility_id)
    order by
      r.employee_id, r.training_type_id,
      r.due_date desc nulls last, r.completion_date desc nulls last, r.created_at desc nulls last
  ),
  -- A type outside this employee's facility type is not a missing requirement, but a real
  -- record always wins over that scoping (a manually tracked one, say).
  cells as (
    select
      e.id as employee_id,
      t.id as training_type_id,
      r.id as training_record_id,
      coalesce(
        r.status,
        case
          when t.applies_to_facility_type = 'BOTH' or t.applies_to_facility_type = e.facility_type
            then 'missing'
          else 'not_applicable'
        end
      ) as status,
      -- NOT coalesced like `status` above: a cell with no record has no approval status, and null
      -- is the honest answer rather than a derived one.
      r.approval_status,
      r.completion_date, r.due_date, r.trainer_name, r.hours
    from emp e
    cross join types t
    left join current_records r on r.employee_id = e.id and r.training_type_id = t.id
  ),
  -- not_applicable / pending_review cells sit outside the compliant-vs-not split entirely,
  -- matching computeDashboardSummary; they must not drag a row down to "missing".
  row_rollup as (
    select
      c.employee_id,
      case
        when bool_or(c.status = 'expired') then 'expired'
        when bool_or(c.status = 'missing') then 'missing'
        when bool_or(c.status = 'due_soon') then 'due_soon'
        else 'compliant'
      end as worst_status,
      bool_or(
        c.due_date is not null
        and c.due_date >= v_today
        and p_due_within_days is not null
        and c.due_date <= v_today + p_due_within_days
      ) as in_due_window
    from cells c
    group by c.employee_id
  ),
  filtered as (
    select e.*, rr.worst_status
    from emp e
    join row_rollup rr on rr.employee_id = e.id
    where (not v_trainer_only or e.trainer_status)
      and (not v_meds_only or e.administers_medications)
      and (
        v_search is null
        or (e.first_name || ' ' || e.last_name) ilike '%' || v_search || '%'
        or coalesce(e.job_title, '') ilike '%' || v_search || '%'
      )
      and (v_status = 'all' or rr.worst_status = v_status)
      and (p_due_within_days is null or rr.in_due_window)
  ),
  ordered as (
    select
      f.*,
      case v_sort_field
        when 'firstName' then f.first_name
        when 'jobTitle' then coalesce(f.job_title, '')
        else f.last_name
      end as sort_key
    from filtered f
  ),
  page_rows as (
    select o.*, row_number() over (
      order by
        (case when v_sort_dir = 'asc' then o.sort_key end) asc,
        (case when v_sort_dir = 'desc' then o.sort_key end) desc,
        o.id
    ) as rn
    from ordered o
    order by
      (case when v_sort_dir = 'asc' then o.sort_key end) asc,
      (case when v_sort_dir = 'desc' then o.sort_key end) desc,
      o.id
    limit v_limit offset (v_page - 1) * v_limit
  ),
  -- Computed over every filtered row, not just the page: the summary bar describes the
  -- filter the user set, and paging must not change the denominator underneath them.
  summary as (
    select
      c.training_type_id,
      count(*) filter (where c.status in ('compliant', 'due_soon', 'expired', 'missing')) as total,
      count(*) filter (where c.status = 'compliant') as compliant
    from cells c
    join filtered f on f.id = c.employee_id
    group by c.training_type_id
  )
  select jsonb_build_object(
    'trainingTypes', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', t.id, 'code', t.code, 'name', t.name,
        'applies_to_facility_type', t.applies_to_facility_type,
        'sort_order', t.sort_order
      ) order by t.sort_order, t.name), '[]'::jsonb)
      from types t
    ),
    'totalCount', (select count(*)::integer from filtered),
    'page', v_page,
    'pageSize', v_limit,
    'summary', (
      select coalesce(jsonb_object_agg(
        s.training_type_id,
        jsonb_build_object('compliant', s.compliant, 'total', s.total)
      ), '{}'::jsonb)
      from summary s
    ),
    'rows', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'employee', to_jsonb(pr) - 'facility_type' - 'worst_status' - 'sort_key' - 'rn',
        'cells', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'trainingTypeId', c.training_type_id,
            'trainingRecordId', c.training_record_id,
            'status', c.status,
            'approvalStatus', c.approval_status,
            'completionDate', c.completion_date,
            'dueDate', c.due_date,
            'trainerName', c.trainer_name,
            'hours', c.hours
          ) order by t.sort_order, t.name), '[]'::jsonb)
          from cells c
          join types t on t.id = c.training_type_id
          where c.employee_id = pr.id
        )
      ) order by pr.rn), '[]'::jsonb)
      from page_rows pr
    )
  )
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_training_matrix_page(
  uuid, text, text, boolean, boolean, integer, text, text, integer, integer, date
) from public, anon;

grant execute on function public.get_training_matrix_page(
  uuid, text, text, boolean, boolean, integer, text, text, integer, integer, date
) to authenticated;
