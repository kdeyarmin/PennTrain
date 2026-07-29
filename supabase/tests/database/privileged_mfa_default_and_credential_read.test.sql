begin;
select plan(4);

-- Privileged MFA defaults back on for real tenants; demo orgs stay exempt.
select ok(
  pg_get_functiondef('public.get_my_mfa_policy()'::regprocedure)
    like '%coalesce(v_policy.require_aal2, true)%',
  'absent identity policy still requires AAL2 for privileged roles'
);
select ok(
  pg_get_functiondef('public.get_my_mfa_policy()'::regprocedure)
    like '%o.is_demo%',
  'demo organizations are exempt from the MFA login gate'
);

select ok(
  exists(
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'integration_api_credentials'
      and policyname = 'integration_api_credentials_read'
      and qual ilike '%facility_manager%'
  ),
  'facility managers can read integration credential metadata for source binding'
);

select ok(
  exists(
    select 1
    from public.role_templates rt
    join public.role_template_permissions rtp on rtp.role_template_id = rt.id
    where rt.built_in_role = 'facility_manager'
      and rtp.permission_key = 'integrations.api.read'
  ),
  'facility_manager role template includes integrations.api.read'
);

select * from finish();
rollback;
