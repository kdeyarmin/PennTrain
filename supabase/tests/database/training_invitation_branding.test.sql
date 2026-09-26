begin;
select no_plan();
create function pg_temp.branding_id(n integer) returns uuid language sql immutable as $$
  select ('eb260000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
$$;
insert into public.organizations(id,name,slug,subscription_status,trial_ends_at,package_id)
select fixture.id,fixture.name,fixture.slug,'trial',now()-interval '1 day',p.id
from (values
  (pg_temp.branding_id(1),'Training invitation tenant','training-invite-branding'),
  (pg_temp.branding_id(2),'Other invitation tenant','training-invite-other')) fixture(id,name,slug)
cross join public.packages p where p.name='CareMetric Train';
insert into app_private.module_access_terms(organization_id,module_key,source,reason)
  values(pg_temp.branding_id(1),'modules.train','complimentary','Disposable invitation branding test');
insert into public.facilities(id,organization_id,name,facility_type) values
  (pg_temp.branding_id(11),pg_temp.branding_id(1),'Invitation facility','PCH'),
  (pg_temp.branding_id(12),pg_temp.branding_id(2),'Other facility','PCH');
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values(pg_temp.branding_id(101),'authenticated','authenticated','branding-test@test.local','{}','{}',now(),now());
insert into public.organization_settings(organization_id,branding_logo_path)
  values(pg_temp.branding_id(1),pg_temp.branding_id(1)::text||'/logo.png')
  on conflict(organization_id) do update set branding_logo_path=excluded.branding_logo_path;
insert into app_private.training_facility_welcome(facility_id,organization_id,contact_name,contact_email,updated_by)
  values(pg_temp.branding_id(11),pg_temp.branding_id(1),'Education Team','training@example.test',pg_temp.branding_id(101));
select ok(not has_function_privilege('anon','public.get_training_invitation_branding(uuid,uuid)','EXECUTE'),'anonymous cannot read invitation branding');
select ok(not has_function_privilege('authenticated','public.get_training_invitation_branding(uuid,uuid)','EXECUTE'),'client cannot bypass invitation authorization');
set local role service_role;
select is(public.get_training_invitation_branding(pg_temp.branding_id(1),pg_temp.branding_id(11))->>'contact_name','Education Team','authorized handler can read exact facility contact');
select is(public.get_training_invitation_branding(pg_temp.branding_id(1),pg_temp.branding_id(11))->>'logo_path',pg_temp.branding_id(1)::text||'/logo.png','authorized handler receives same organization logo');
select is(public.get_training_invitation_branding(pg_temp.branding_id(1),pg_temp.branding_id(12)),null::jsonb,'cross-organization facility is rejected');
select is(public.get_training_invitation_branding(pg_temp.branding_id(2),null),null::jsonb,'non-Training customer has no Training invitation branding');
select is(public.get_training_invitation_branding(pg_temp.branding_id(1),null)->>'contact_name',null::text,'organization invitation does not guess a facility contact');
reset role;
update public.organization_settings set branding_logo_path=pg_temp.branding_id(2)::text||'/logo.png' where organization_id=pg_temp.branding_id(1);
select is(public.get_training_invitation_branding(pg_temp.branding_id(1),pg_temp.branding_id(11))->>'logo_path',null::text,'foreign logo path is not returned for signing');
create function pg_temp.branding_logo(p_path text) returns text language plpgsql as $$
begin
  update public.organization_settings set branding_logo_path=p_path where organization_id=pg_temp.branding_id(1);
  return public.get_training_invitation_branding(pg_temp.branding_id(1),pg_temp.branding_id(11))->>'logo_path';
end;
$$;
select is(pg_temp.branding_logo(pg_temp.branding_id(1)::text||'/'||suffix),null::text,'unsafe logo path is not returned: '||suffix)
from unnest(array['%2e%2e/other/logo.png','.%2e/other/logo.png','folder'||chr(92)||'..'||chr(92)||'..'||chr(92)||'other/logo.png',
  '../other/logo.png','./logo.png','folder//logo.png','logo.png?token=spoof','logo.png#fragment','logo.png'||chr(10),'logo image.png','logo.png/']) suffix;
select is(pg_temp.branding_logo(pg_temp.branding_id(1)::text||'/brand-assets/logo_v2.png'),pg_temp.branding_id(1)::text||'/brand-assets/logo_v2.png','canonical nested organization logo remains available');
update public.organizations set subscription_status='suspended' where id=pg_temp.branding_id(1);
select is(public.get_training_invitation_branding(pg_temp.branding_id(1),pg_temp.branding_id(11)),null::jsonb,'suspended customer returns no branding');
select * from finish();
rollback;
