-- Authenticated current-publication evidence for the shared catalog. This read
-- changes no course, placement, enrollment, credit or learner receipt.
create function public.get_learning_distribution_context(
  p_actor uuid,p_hub_user uuid,p_hub_session uuid,p_session_started_at timestamptz,
  p_assurance_expires_at timestamptz,p_course_id uuid,p_authentication_method text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_course public.courses; v_version public.course_versions; v_source jsonb:=null;
begin
  perform app_private.assert_platform_admin_delegate(p_actor,p_hub_user,p_hub_session,
    p_session_started_at,p_assurance_expires_at,p_authentication_method);
  -- The parent lock freezes the pointer and prevents new FK descendants while
  -- the canonical source lock protects all of this published version's content.
  select * into v_course from public.courses where id=p_course_id and organization_id is null for update;
  if not found then raise exception 'Global course not found' using errcode='P0002'; end if;
  if v_course.current_version_id is not null then
    select * into v_version from public.course_versions where id=v_course.current_version_id
      and course_id=v_course.id and organization_id is null for share;
    if not found then raise exception 'Current course version is inconsistent' using errcode='22023'; end if;
  end if;
  if v_course.status='published' and v_version.status='published' then
    perform app_private.lock_learning_authoring_source(v_course.id,v_version.id);
    -- Reuse the native source projection, size limit and credential exclusion.
    v_source:=public.get_learning_authoring_source(p_actor,p_hub_user,p_hub_session,
      p_session_started_at,p_assurance_expires_at,v_course.id,v_version.id,p_authentication_method);
    if v_source->'payload' is null or (v_source->>'payload')::jsonb->>'publicationState'<>'published'
      or (v_source->>'payload')::jsonb->>'sourceVersionState'<>'published' then
      raise exception 'Current published source is inconsistent' using errcode='22023';
    end if;
    v_source:=jsonb_build_object('payload',v_source->'payload','sourceRevision',v_source->'sourceRevision');
  end if;
  return jsonb_build_object('courseId',v_course.id,'publicationState',v_course.status,
    'currentVersionId',v_course.current_version_id,'currentVersionState',v_version.status,'source',v_source);
end;
$$;
revoke all on function public.get_learning_distribution_context(uuid,uuid,uuid,timestamptz,timestamptz,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.get_learning_distribution_context(uuid,uuid,uuid,timestamptz,timestamptz,uuid,text) to service_role;

-- The continuous observer can only read bounded current global publication
-- metadata and hashes. It cannot fetch source content or impersonate an editor.
create function public.get_learning_distribution_status(p_course_ids uuid[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_course public.courses; v_version public.course_versions;
  v_payload text; v_hash text; v_items jsonb:='[]'::jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service observer required' using errcode='42501';
  end if;
  if p_course_ids is null or cardinality(p_course_ids) not between 1 and 10
    or array_position(p_course_ids,null) is not null
    or (select count(distinct id) from unnest(p_course_ids) ids(id))<>cardinality(p_course_ids) then
    raise exception 'A unique bounded course batch is required' using errcode='22023';
  end if;
  -- Stable lock order across overlapping batches and normal course writers.
  for v_id in select id from unnest(p_course_ids) ids(id) order by id loop
    v_hash:=null; v_version:=null;
    select * into v_course from public.courses where id=v_id and organization_id is null for update;
    if not found then
      v_items:=v_items||jsonb_build_array(jsonb_build_object('courseId',v_id,'publicationState','missing',
        'currentVersionId',null,'currentVersionState',null,'sourceRevision',null));
      continue;
    end if;
    if v_course.current_version_id is not null then
      select * into v_version from public.course_versions where id=v_course.current_version_id
        and course_id=v_id and organization_id is null for update;
      if not found then raise exception 'Current course version is inconsistent' using errcode='22023'; end if;
    end if;
    if v_course.status='published' and v_version.status='published' then
      perform app_private.lock_learning_authoring_source(v_id,v_version.id);
      v_payload:=app_private.learning_source_payload(v_id,v_version.id);
      if v_payload is null or octet_length(v_payload)>2000000 then
        raise exception 'Current source is unavailable' using errcode='22023';
      end if;
      v_hash:=encode(extensions.digest(v_payload,'sha256'),'hex');
    end if;
    v_items:=v_items||jsonb_build_array(jsonb_build_object('courseId',v_id,'publicationState',v_course.status,
      'currentVersionId',v_course.current_version_id,'currentVersionState',v_version.status,'sourceRevision',v_hash));
  end loop;
  return jsonb_build_object('items',v_items);
end;
$$;
revoke all on function public.get_learning_distribution_status(uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.get_learning_distribution_status(uuid[]) to service_role;
