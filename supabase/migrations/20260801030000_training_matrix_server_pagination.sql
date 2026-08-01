-- Training matrix server-side pagination (2026-08-01)
--
-- TrainingMatrix.tsx loaded the entire active roster, every active training type, and every
-- training record joining the two, then filtered, sorted, and paginated in the browser to show
-- 15 rows. Payload grew as employees x training types regardless of what was on screen, and the
-- per-type compliance summary needed the whole set in memory to compute.
--
-- get_training_matrix_page() does that work in the database and returns exactly one page, plus
-- the totals and the per-training-type summary computed over the whole filtered set (not just
-- the page -- the summary bar reports the filter, not the page).
--
-- security invoker on purpose: the matrix must show precisely the rows the caller's RLS already
-- permits on employees / training_types / employee_training_records. No policy is bypassed.

-- Supports the distinct-on "most current record per (employee, training type)" scan below.
create index if not exists employee_training_records_matrix_current_idx
  on public.employee_training_records (
    employee_id,
    training_type_id,
    due_date desc nulls last,
    completion_date desc nulls last,
    created_at desc nulls last
  );

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
  -- facilities west of UTC, matching how the page compared dates client-side.
  v_today date := coalesce(p_today, current_date);
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
      r.employee_id, r.training_type_id, r.id, r.status,
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

comment on function public.get_training_matrix_page(
  uuid, text, text, boolean, boolean, integer, text, text, integer, integer, date
) is
  'One page of the training matrix (rows + cells), the filtered total, and the per-training-type '
  'compliance summary over the whole filtered set. security invoker so employees / training_types / '
  'employee_training_records RLS decides what the caller sees.';

revoke all on function public.get_training_matrix_page(
  uuid, text, text, boolean, boolean, integer, text, text, integer, integer, date
) from public, anon;

grant execute on function public.get_training_matrix_page(
  uuid, text, text, boolean, boolean, integer, text, text, integer, integer, date
) to authenticated;
