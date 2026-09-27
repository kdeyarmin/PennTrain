-- A license selection belongs to a facility, never to an entire organization:
-- an organization can operate separately licensed PCH and ALF locations.
-- ALF is the product label for the existing stored ALR code (Chapter 2800).
-- Rollout is additive: deploy-migrations.yml pushes the database before Edge
-- Functions. Keep the existing service-role-only four-argument RPC unchanged
-- while the previously deployed signup function still calls it. It creates an
-- organization/settings only, never an inferred PCH or ALF facility. Remove that
-- legacy signature in a separate deployment after the five-argument caller is live.
-- All five arguments below are required: no default may make the two RPC
-- signatures ambiguous or allow the new caller to omit the selected license.
create function public.record_organization_signup(
  p_name text, p_slug text, p_trial_ends_at timestamptz,
  p_baa_version text, p_facility_type text
)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
  if nullif(btrim(coalesce(p_name,'')),'') is null
     or nullif(btrim(coalesce(p_slug,'')),'') is null then
    raise exception 'organization name and slug are required' using errcode='22023';
  end if;
  if nullif(btrim(coalesce(p_baa_version,'')),'') is null then
    raise exception 'a BAA version is required to record an organization signup' using errcode='22023';
  end if;
  if coalesce(p_facility_type,'') not in ('PCH','ALR') then
    raise exception 'Choose Personal Care Home (PCH) or Assisted Living Facility (ALF)' using errcode='22023';
  end if;
  insert into public.organizations(name,slug,trial_ends_at,baa_version,baa_accepted_at)
    values(btrim(p_name),btrim(p_slug),p_trial_ends_at,btrim(p_baa_version),now()) returning id into v_id;
  insert into public.organization_settings(organization_id,email_notifications_enabled,sms_notifications_enabled)
    values(v_id,true,true);
  insert into public.facilities(organization_id,name,facility_type,state)
    values(v_id,btrim(p_name),p_facility_type,'PA');
  return v_id;
end;
$$;
revoke all on function public.record_organization_signup(text,text,timestamptz,text,text) from public,anon,authenticated;
grant execute on function public.record_organization_signup(text,text,timestamptz,text,text) to service_role;

-- Stored resident/staff/site evidence is chapter-specific. Relabeling an existing
-- facility would leave the former chapter's deadlines and citations attached.
-- Separately licensed locations therefore retain separate facility identities.
create function public.preserve_facility_license_type()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.facility_type is distinct from old.facility_type
     and (old.facility_type in ('PCH','ALR') or new.facility_type in ('PCH','ALR')) then
    raise exception 'The license type selected at creation cannot change. Create a separate facility for a different license.' using errcode='23514';
  end if;
  return new;
end;
$$;
revoke all on function public.preserve_facility_license_type() from public,anon,authenticated;
create trigger preserve_facility_license_type before update of facility_type on public.facilities
  for each row execute function public.preserve_facility_license_type();

-- Teardown must remove the new facility and its seeded exception rules before
-- clearing the audit rows those deletes produce. Preserve the billing guards.
do $patch$
declare v_def text; v_old text := '  -- Provisioning + the teardown above write audit_logs.';
begin
  v_def:=pg_get_functiondef('public.rollback_organization_signup(uuid)'::regprocedure);
  if position(v_old in v_def)=0 then raise exception 'Review signup rollback before adding facility cleanup'; end if;
  v_def:=replace(v_def,v_old,E'  delete from public.facilities where organization_id = p_organization_id;\n\n'||v_old);
  execute v_def;
end $patch$;
