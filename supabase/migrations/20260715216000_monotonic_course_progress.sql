-- Browser checkpoints can arrive out of order when a learner navigates while
-- debounced note/video saves are still in flight. Keep the authoritative
-- progress cursor monotonic so an older request cannot lower completion or
-- make the next session resume behind a step the learner already reached.
create or replace function public.protect_course_progress_timing()
returns trigger
language plpgsql
set search_path = 'public'
as $function$
declare
  v_assignment_version_id uuid;
  v_old_sort_order integer;
  v_new_sort_order integer;
begin
  if coalesce(current_setting('app.privileged_write', true), '') = 'on' then
    return new;
  end if;

  select ca.course_version_id
    into v_assignment_version_id
  from public.course_assignments ca
  where ca.id = new.assignment_id;

  if not found then
    raise exception 'course progress assignment % not found', new.assignment_id
      using errcode = 'foreign_key_violation';
  end if;

  if new.last_block_id is not null then
    select cb.sort_order
      into v_new_sort_order
    from public.course_blocks cb
    where cb.id = new.last_block_id
      and cb.course_version_id = v_assignment_version_id;

    if not found then
      raise exception 'course progress last block must belong to the assignment course version'
        using errcode = 'check_violation';
    end if;
  end if;

  if tg_op = 'INSERT' then
    new.started_at := now();
    return new;
  end if;

  new.started_at := coalesce(old.started_at, now());
  new.percent_complete := greatest(old.percent_complete, new.percent_complete);

  if old.last_block_id is not null then
    select cb.sort_order
      into v_old_sort_order
    from public.course_blocks cb
    where cb.id = old.last_block_id
      and cb.course_version_id = v_assignment_version_id;

    if found and (
      new.last_block_id is null
      or v_new_sort_order < v_old_sort_order
      or (
        v_new_sort_order = v_old_sort_order
        and new.last_block_id < old.last_block_id
      )
    ) then
      new.last_block_id := old.last_block_id;
    end if;
  end if;

  return new;
end;
$function$;

drop trigger if exists protect_course_progress_timing on public.course_progress;
create trigger protect_course_progress_timing
  before insert or update on public.course_progress
  for each row execute function public.protect_course_progress_timing();

revoke all on function public.protect_course_progress_timing()
  from public, anon, authenticated, service_role;
