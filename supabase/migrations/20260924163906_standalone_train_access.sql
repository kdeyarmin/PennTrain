-- Independent commercial terms never grant another product or override suspension.
create table app_private.module_access_terms (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  module_key text not null check (module_key in ('modules.train','modules.workforce','modules.compliance','modules.billing','modules.carebase')),
  source text not null check (source in ('complimentary','contract')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  revoked_at timestamptz,
  reason text not null check (length(btrim(reason)) between 10 and 1000),
  granted_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);
create index module_access_terms_org_idx on app_private.module_access_terms(organization_id,module_key,starts_at);
revoke all on app_private.module_access_terms from public, anon, authenticated;

create function app_private.has_independent_module_access(p_org uuid,p_as_of timestamptz default now())
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from app_private.module_access_terms t where t.organization_id=p_org
    and t.revoked_at is null and t.starts_at<=p_as_of and (t.ends_at is null or t.ends_at>p_as_of));
$$;
revoke all on function app_private.has_independent_module_access(uuid,timestamptz) from public,anon,authenticated;

-- Preserve the existing billing resolver verbatim, behind the private boundary. Explicit
-- organization denials still win over independent access. Paid access remains provider-derived.
alter function public.get_effective_entitlements(uuid,timestamptz) set schema app_private;
alter function app_private.get_effective_entitlements(uuid,timestamptz) rename to billing_effective_entitlements;
revoke all on function app_private.billing_effective_entitlements(uuid,timestamptz) from public,anon,authenticated;
create function public.get_effective_entitlements(p_organization_id uuid default null,p_as_of timestamptz default now())
returns table(feature_key text,value_type text,entitlement_value jsonb,entitlement_source text,
  effective_from timestamptz,effective_to timestamptz,billing_state text,is_entitled boolean)
language plpgsql stable security definer set search_path='' as $$
declare v_org uuid:=coalesce(p_organization_id,public.current_org_id());
begin
  if v_org is null then raise exception 'Organization is required' using errcode='22023'; end if;
  if coalesce(auth.role(),'')<>'service_role' and auth.uid() is not null and not public.is_platform_admin() and v_org is distinct from public.current_org_id() then
    raise exception 'Organization is outside your access' using errcode='42501'; end if;
  return query
  select e.feature_key,e.value_type,
    case when t.id is not null and not denied.found then 'true'::jsonb else e.entitlement_value end,
    case when t.id is not null and not denied.found then 'independent_'||t.source else e.entitlement_source end,
    coalesce(t.starts_at,e.effective_from),case when t.id is not null then t.ends_at else e.effective_to end,
    e.billing_state,
    o.subscription_status <> 'suspended' and (e.is_entitled or (t.id is not null and not denied.found))
  from app_private.billing_effective_entitlements(v_org,p_as_of) e
  join public.organizations o on o.id=v_org
  left join lateral(select x.* from app_private.module_access_terms x where x.organization_id=v_org
    and x.module_key=e.feature_key and x.revoked_at is null and x.starts_at<=p_as_of
    and (x.ends_at is null or x.ends_at>p_as_of) order by x.starts_at desc,x.id desc limit 1) t on true
  cross join lateral(select coalesce((select g.decision='deny' from public.organization_entitlement_grants g
    where g.organization_id=v_org and g.feature_key=e.feature_key and g.effective_from<=p_as_of
    and (g.effective_to is null or g.effective_to>p_as_of)
    order by g.effective_from desc,g.created_at desc limit 1),false) as found) denied;
end;
$$;
revoke all on function public.get_effective_entitlements(uuid,timestamptz) from public,anon;
grant execute on function public.get_effective_entitlements(uuid,timestamptz) to authenticated,service_role;

-- Provider cancellation is not administrative suspension. Preserve identity access for
-- independently licensed tenants; the resolver above still denies unpaid products.
create function app_private.preserve_independent_module_membership()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.subscription_status='canceled' and old.subscription_status<>'suspended'
    and app_private.has_independent_module_access(new.id) then new.subscription_status:='active'; end if;
  return new;
end;
$$;
revoke all on function app_private.preserve_independent_module_membership() from public,anon,authenticated;
create trigger zz_preserve_independent_module_membership before update on public.organizations
  for each row execute function app_private.preserve_independent_module_membership();

create function public.manage_module_access_term(p_organization_id uuid,p_module_key text,p_source text,
  p_reason text,p_ends_at timestamptz default null,p_revoke_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_old text;
begin
  perform app_private.assert_billing_aal2();
  if not public.is_platform_admin() then raise exception 'Platform administrator required' using errcode='42501'; end if;
  if length(btrim(coalesce(p_reason,''))) not between 10 and 1000 then
    raise exception 'Record a reason of 10 to 1000 characters' using errcode='22023'; end if;
  select subscription_status into v_old from public.organizations where id=p_organization_id for update;
  if not found then raise exception 'Organization not found' using errcode='22023'; end if;
  if p_revoke_id is not null then
    update app_private.module_access_terms set revoked_at=now()
      where id=p_revoke_id and organization_id=p_organization_id and revoked_at is null returning id into v_id;
    if v_id is null then raise exception 'Active access term not found' using errcode='22023'; end if;
  else
    insert into app_private.module_access_terms(organization_id,module_key,source,ends_at,reason,granted_by)
      values(p_organization_id,p_module_key,p_source,p_ends_at,btrim(p_reason),auth.uid()) returning id into v_id;
    if v_old='canceled' then
      perform set_config('app.privileged_write','on',true);
      update public.organizations set subscription_status='active' where id=p_organization_id;
    end if;
  end if;
  insert into public.audit_logs(organization_id,actor_profile_id,action,entity_type,entity_id,metadata)
    values(p_organization_id,auth.uid(),case when p_revoke_id is null then 'module_access.granted' else 'module_access.revoked' end,
      'module_access_terms',v_id::text,jsonb_build_object('module',p_module_key,'reason',p_reason));
  return jsonb_build_object('id',v_id);
end;
$$;
revoke all on function public.manage_module_access_term(uuid,text,text,text,timestamptz,uuid) from public,anon;
grant execute on function public.manage_module_access_term(uuid,text,text,text,timestamptz,uuid) to authenticated;

create function public.list_module_access_terms(p_organization_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not public.is_platform_admin() and (p_organization_id is distinct from public.current_org_id()
    or public.current_role() is distinct from 'org_admin') then
    raise exception 'Organization administrator required' using errcode='42501'; end if;
  return coalesce((select jsonb_agg(to_jsonb(t) order by created_at desc) from app_private.module_access_terms t
    where t.organization_id=p_organization_id),'[]'::jsonb);
end;
$$;
revoke all on function public.list_module_access_terms(uuid) from public,anon;
grant execute on function public.list_module_access_terms(uuid) to authenticated;

-- A resident directory is shared by resident products, not by a training-only license.
create function app_private.has_resident_product()
returns boolean language sql stable security definer set search_path='' as $$
  select app_private.has_product_module('modules.carebase') or app_private.has_product_module('modules.compliance')
    or app_private.has_product_module('modules.billing');
$$;
revoke all on function app_private.has_resident_product() from public,anon;
grant execute on function app_private.has_resident_product() to authenticated,service_role;
create policy resident_product_access on public.residents as restrictive for all to authenticated
  using ((select app_private.has_resident_product())) with check ((select app_private.has_resident_product()));
create policy resident_product_access on public.resident_contacts as restrictive for all to authenticated
  using ((select app_private.has_resident_product())) with check ((select app_private.has_resident_product()));

-- Called only by the abuse-protected signup service before the first user exists.
-- Complimentary public signup is a server configuration decision, never a client field.
create function public.configure_train_signup(p_organization_id uuid,p_complimentary boolean default false)
returns void language plpgsql security definer set search_path='' as $$
declare v_package uuid;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'Signup service required' using errcode='42501'; end if;
  perform 1 from public.organizations where id=p_organization_id and subscription_status='trial'
    and created_at>now()-interval '10 minutes' for update;
  if not found or exists(select 1 from public.profiles where organization_id=p_organization_id) then
    raise exception 'Only a new unclaimed signup can be configured' using errcode='22023'; end if;
  select id into v_package from public.packages where name='CareMetric Train' and is_active;
  if v_package is null then raise exception 'Train signup is unavailable' using errcode='22023'; end if;
  perform set_config('app.privileged_write','on',true);
  update public.organizations set package_id=v_package where id=p_organization_id;
  if p_complimentary then
    insert into app_private.module_access_terms(organization_id,module_key,source,reason)
      values(p_organization_id,'modules.train','complimentary','Server-configured complimentary Train signup');
  end if;
  insert into public.audit_logs(organization_id,action,entity_type,entity_id,metadata)
    values(p_organization_id,'train_signup.configured','organizations',p_organization_id::text,
      jsonb_build_object('complimentary',p_complimentary,'package_id',v_package));
end;
$$;
revoke all on function public.configure_train_signup(uuid,boolean) from public,anon,authenticated;
grant execute on function public.configure_train_signup(uuid,boolean) to service_role;

create function public.provision_training_facility(p_request_id uuid,p_organization_name text,p_facility_name text,p_facility_type text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_package uuid; v_facility uuid;
begin
  perform app_private.assert_billing_aal2();
  if not public.is_platform_admin() then raise exception 'Platform administrator required' using errcode='42501'; end if;
  if p_request_id is null or length(btrim(coalesce(p_organization_name,''))) not between 2 and 200
    or length(btrim(coalesce(p_facility_name,''))) not between 2 and 200
    or coalesce(p_facility_type,'') not in ('PCH','ALR') then raise exception 'Organization, facility and PCH/ALR license type are required' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  if exists(select 1 from public.organizations where id=p_request_id) then
    if not exists(select 1 from app_private.module_access_terms where organization_id=p_request_id and granted_by=auth.uid()
      and reason='Complimentary Train facility provisioning') then raise exception 'Provisioning request already used' using errcode='22023'; end if;
    select id into v_facility from public.facilities where organization_id=p_request_id order by created_at,id limit 1;
    return jsonb_build_object('organization_id',p_request_id,'facility_id',v_facility);
  end if;
  select id into v_package from public.packages where name='CareMetric Train' and is_active;
  if v_package is null then raise exception 'Train package unavailable' using errcode='22023'; end if;
  perform set_config('app.privileged_write','on',true);
  insert into public.organizations(id,name,slug,package_id,subscription_status,trial_ends_at)
    values(p_request_id,btrim(p_organization_name),'train-'||p_request_id::text,v_package,'trial',now());
  insert into public.facilities(organization_id,name,facility_type)
    values(p_request_id,btrim(p_facility_name),p_facility_type) returning id into v_facility;
  insert into app_private.module_access_terms(organization_id,module_key,source,reason,granted_by)
    values(p_request_id,'modules.train','complimentary','Complimentary Train facility provisioning',auth.uid());
  insert into public.audit_logs(organization_id,actor_profile_id,action,entity_type,entity_id,metadata)
    values(p_request_id,auth.uid(),'train_facility.provisioned','organizations',p_request_id::text,jsonb_build_object('facility_id',v_facility));
  return jsonb_build_object('organization_id',p_request_id,'facility_id',v_facility);
end;
$$;
revoke all on function public.provision_training_facility(uuid,text,text,text) from public,anon;
grant execute on function public.provision_training_facility(uuid,text,text,text) to authenticated;
