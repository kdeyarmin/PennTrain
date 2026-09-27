-- Repair existing tied positions when moving a pair; ordinary swaps remain unchanged.
-- Identifiers come only from this
-- fixed resource list; row and parent authorization remains enforced by RLS.
create or replace function public.swap_training_item_order(
  p_resource text, p_first_id uuid, p_second_id uuid,
  p_first_sort_order integer, p_second_sort_order integer
)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_table text;
  v_parent_column text;
  v_parent_table text;
  v_parent_id uuid;
  v_locked_id uuid;
  v_version_id uuid;
  v_status text;
  v_first_order integer;
  v_second_order integer;
  v_count integer;
  v_sibling_ids uuid[];
  v_first_position integer;
  v_second_position integer;
begin
  if auth.uid() is null then raise exception 'Sign in to reorder training items.' using errcode='42501'; end if;
  if p_first_id is null or p_second_id is null or p_first_id=p_second_id
    or p_first_sort_order is null or p_second_sort_order is null then
    raise exception 'Choose two distinct training items and their current positions.' using errcode='22023';
  end if;
  case p_resource
    when 'course_blocks' then v_table:='course_blocks'; v_parent_column:='course_version_id'; v_parent_table:='course_versions';
    when 'quiz_questions' then v_table:='quiz_questions'; v_parent_column:='quiz_id'; v_parent_table:='quizzes';
    when 'training_plan_items' then v_table:='training_plan_items'; v_parent_column:='training_plan_id'; v_parent_table:='training_plans';
    when 'competency_template_items' then v_table:='competency_template_items'; v_parent_column:='template_id'; v_parent_table:='competency_templates';
    else raise exception 'Unsupported training item resource.' using errcode='22023';
  end case;
  execute format('select a.%I from public.%I a join public.%I b on a.%I=b.%I where a.id=$1 and b.id=$2',
    v_parent_column,v_table,v_table,v_parent_column,v_parent_column)
    into v_parent_id using p_first_id,p_second_id;
  if v_parent_id is null then
    raise exception 'Both training items must be accessible and belong to the same parent.' using errcode='42501';
  end if;

  -- Publication and governed edits take the version lock before child rows.
  if p_resource='course_blocks' then v_version_id:=v_parent_id;
  elsif p_resource='quiz_questions' then
    select b.course_version_id into v_version_id from public.quizzes z
      join public.course_blocks b on b.id=z.course_block_id where z.id=v_parent_id;
  end if;
  if p_resource in ('course_blocks','quiz_questions') then
    select id,status into v_locked_id,v_status from public.course_versions where id=v_version_id for update;
    if not found then raise exception 'This course cannot be edited.' using errcode='42501'; end if;
    if v_status<>'draft' then raise exception 'Only draft course content can be reordered.' using errcode='0A000'; end if;
  end if;
  v_locked_id:=null;
  execute format('select id from public.%I where id=$1 for update',v_parent_table) into v_locked_id using v_parent_id;
  if v_locked_id is null then raise exception 'This training item parent cannot be edited.' using errcode='42501'; end if;

  -- Recheck scope after the parent lock, then reject a stale display instead of
  -- silently undoing another author's intervening reorder.
  execute format('select a.sort_order,b.sort_order from public.%I a join public.%I b on a.%I=b.%I
    where a.id=$1 and b.id=$2 and a.%I=$3 for update of a,b',v_table,v_table,v_parent_column,v_parent_column,v_parent_column)
    into v_first_order,v_second_order using p_first_id,p_second_id,v_parent_id;
  if v_first_order is null or v_second_order is null then
    raise exception 'Training items changed while saving. Reload and retry.' using errcode='40001';
  end if;
  if v_first_order<>p_first_sort_order or v_second_order<>p_second_sort_order then
    raise exception 'Training item order changed. Reload and retry.' using errcode='40001';
  end if;
  if v_first_order=v_second_order then
    -- Earlier independent swaps could leave tied positions. Match the readers'
    -- stable order, lock every sibling, and exchange this pair while normalizing
    -- the full list in one statement. Other siblings retain their relative order.
    execute format('select array_agg(s.id order by s.sort_order,s.id) from
      (select id,sort_order from public.%I where %I=$1 order by id for update) s',v_table,v_parent_column)
      into v_sibling_ids using v_parent_id;
    v_first_position:=array_position(v_sibling_ids,p_first_id)-1;
    v_second_position:=array_position(v_sibling_ids,p_second_id)-1;
    if v_first_position is null or v_second_position is null then
      raise exception 'Training items changed while saving. Reload and retry.' using errcode='40001';
    end if;
    execute format('update public.%I item set sort_order=case item.id when $2 then $5 when $3 then $4 else ordered.ordinality::integer-1 end
      from unnest($1::uuid[]) with ordinality ordered(id,ordinality) where item.id=ordered.id and item.%I=$6',v_table,v_parent_column)
      using v_sibling_ids,p_first_id,p_second_id,v_first_position,v_second_position,v_parent_id;
    get diagnostics v_count=row_count;
    if v_count<>cardinality(v_sibling_ids) then
      raise exception 'All training items must be editable to repair tied positions.' using errcode='42501';
    end if;
  else
    execute format('update public.%I set sort_order=case id when $1 then $4 else $3 end where id in ($1,$2) and %I=$5',v_table,v_parent_column)
      using p_first_id,p_second_id,v_first_order,v_second_order,v_parent_id;
    get diagnostics v_count=row_count;
    if v_count<>2 then raise exception 'Both training items must be editable.' using errcode='42501'; end if;
  end if;
end;
$$;
revoke all on function public.swap_training_item_order(text,uuid,uuid,integer,integer) from public,anon,service_role;
grant execute on function public.swap_training_item_order(text,uuid,uuid,integer,integer) to authenticated;
