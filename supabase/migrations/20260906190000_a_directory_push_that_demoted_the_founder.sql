-- A directory push that demoted the founder.
--
-- BACKLOG J22.
--
-- `apply_scim_change` resolves the app role for an incoming subject as
--
--     v_role := coalesce(v_mapping.app_role, 'employee')
--
-- and then writes it onto whatever profile the subject links to. Two things follow from that, and
-- both are one directory sync away.
--
--   * A create or update for an address that belongs to an existing org_admin links their profile
--     and rewrites its role. With no group mapping matching, the fallback is `employee`: the
--     founding administrator of the tenant is demoted by a routine sync, and if they were the only
--     one, nobody in the organization can undo it, because undoing it needs an org_admin.
--   * A suspend or deprovision deactivates the profile, with the same reasoning and the same
--     result. Nothing anywhere protects the last active administrator.
--
-- The rule is not "SCIM cannot manage administrators" -- an organization that maps an admin group
-- means it. The rule is that a directory push may only ASSERT what it actually says. Lowering an
-- org_admin has to come from a mapping that names an admin group; the `employee` FALLBACK is what
-- must never do it, because the fallback is the absence of an assertion, not an assertion of
-- `employee`.
--
-- And the last active org_admin is never demoted or deactivated by SCIM at all, mapping or no
-- mapping. That is not a policy about roles; it is the difference between an organization that can
-- administer itself and one that has to call support.
--
-- Both refusals are recorded on the receipt rather than raised: a SCIM connector retries a 500 for
-- ever, and a directory that keeps pushing the same demotion should be told it was declined and
-- why, once, in the response it already reads.

do $do$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'apply_scim_change';
  if v_def is null then raise exception 'public.apply_scim_change is missing'; end if;

  if position('v_scim_declined' in v_def) > 0 then
    raise notice 'apply_scim_change already protects administrators';
  else
    -- 1. Two more locals.
    v_old := '  v_role text := ''employee'';';
    v_new := '  v_role text := ''employee'';
  -- BACKLOG J22. What the directory asserted, and what we declined to do about it.
  v_scim_mapped_role text;
  v_scim_declined text;
  v_scim_current_role text;
  v_scim_admin_count integer;';
    if position(v_old in v_def) = 0 then
      raise exception 'apply_scim_change no longer declares v_role the way this migration patches';
    end if;
    v_def := replace(v_def, v_old, v_new);

    -- 2. Remember whether a mapping actually named a role, before the fallback erases the
    --    difference between "the directory said employee" and "the directory said nothing".
    v_old := '    v_role := coalesce(v_mapping.app_role, ''employee'');';
    v_new := '    v_scim_mapped_role := nullif(btrim(coalesce(v_mapping.app_role, '''')), '''');
    v_role := coalesce(v_scim_mapped_role, ''employee'');';
    if position(v_old in v_def) = 0 then
      raise exception 'apply_scim_change no longer resolves the mapped role the way this migration patches';
    end if;
    v_def := replace(v_def, v_old, v_new);

    -- 3. The update branch: refuse to lower an administrator on a fallback, and never lower the
    --    last one.
    v_old := '        perform public.admin_update_profile(
          p_user_id => v_link.profile_id,
          p_role => v_role,';
    v_new := $patch$        select p.role into v_scim_current_role
        from public.profiles p where p.id = v_link.profile_id;

        if v_scim_current_role = 'org_admin' and v_role <> 'org_admin' then
          select count(*)::integer into v_scim_admin_count
          from public.profiles p
          where p.organization_id = v_connection.organization_id
            and p.role = 'org_admin' and p.is_active;

          if v_scim_mapped_role is null then
            -- BACKLOG J22. No mapping matched, so the directory asserted nothing about this
            -- person's role; `employee` is this function's fallback, not the directory's claim.
            -- Falling back onto an administrator demotes them on a routine sync.
            v_scim_declined := 'role unchanged: no group mapping named a role for this subject, and the employee fallback does not demote an organization administrator';
            v_role := 'org_admin';
          elsif v_scim_admin_count <= 1 then
            -- An explicit mapping DID name a lower role, and we still decline: this is the last
            -- administrator, and after it there is nobody in the organization who can undo it.
            v_scim_declined := 'role unchanged: this is the last active organization administrator';
            v_role := 'org_admin';
          end if;
        end if;

        perform public.admin_update_profile(
          p_user_id => v_link.profile_id,
          p_role => v_role,$patch$;
    if position(v_old in v_def) = 0 then
      raise exception 'apply_scim_change no longer calls admin_update_profile the way this migration patches';
    end if;
    v_def := replace(v_def, v_old, v_new);

    -- 4. The suspend/deprovision branch: the same protection for the last administrator.
    v_old := '      if p_operation in (''suspend'', ''deprovision'') then';
    v_new := $patch$      if p_operation in ('suspend', 'deprovision') then
        select p.role into v_scim_current_role
        from public.profiles p where p.id = v_link.profile_id;
        select count(*)::integer into v_scim_admin_count
        from public.profiles p
        where p.organization_id = v_connection.organization_id
          and p.role = 'org_admin' and p.is_active;
      end if;

      if p_operation in ('suspend', 'deprovision')
         and v_scim_current_role = 'org_admin' and coalesce(v_scim_admin_count, 0) <= 1 then
        -- BACKLOG J22. Deactivating the last administrator leaves an organization that cannot
        -- administer itself, and no path back that does not go through support.
        v_scim_declined := 'not deactivated: this is the last active organization administrator';
      elsif p_operation in ('suspend', 'deprovision') then$patch$;
    if position(v_old in v_def) = 0 then
      raise exception 'apply_scim_change no longer branches on suspend the way this migration patches';
    end if;
    v_def := replace(v_def, v_old, v_new);

    -- 5. Say so in the response the connector already reads, rather than raising: a SCIM client
    --    retries a 500 for ever, and a decline is an answer, not a failure.
    v_old := '    v_response := jsonb_build_object(
      ''ok'', true,';
    v_new := '    v_response := jsonb_build_object(
      ''ok'', true,
      ''declined'', v_scim_declined,';
    if position(v_old in v_def) = 0 then
      raise exception 'apply_scim_change no longer builds the response this migration patches';
    end if;
    v_def := replace(v_def, v_old, v_new);

    execute v_def;
  end if;
end;
$do$;

comment on function public.apply_scim_change(uuid, text, text, text, text, jsonb) is
  'Applies one SCIM create, update, suspend or deprovision. A directory push may only assert what '
  'it actually says: with no group mapping matching, the `employee` fallback is the absence of an '
  'assertion and never demotes an organization administrator, and the last active administrator is '
  'never demoted or deactivated by SCIM at all -- after that there is nobody in the organization '
  'who can undo it. Both refusals come back on the response as `declined` rather than as an error, '
  'because a connector retries a 500 for ever. BACKLOG J22.';
