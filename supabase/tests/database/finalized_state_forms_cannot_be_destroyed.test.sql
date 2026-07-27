begin;
select plan(7);

-- resident_assessment_forms holds the RASP and ASP, the Pennsylvania support-plan assessments a DHS
-- inspector asks for by name, and `authenticated` writes to it directly rather than through an RPC.
-- Its UPDATE policy carries `status = 'draft'` in both USING and WITH CHECK. Its DELETE policy
-- carried no status test at all, so the weaker operation was refused and the stronger one allowed.
--
-- Controls first, as always: an assertion that a delete is refused proves nothing if this role cannot
-- delete anything.

insert into public.organizations(id, name, slug, subscription_status) values
  ('ea000000-0000-4000-8000-000000000001', 'Form Org', 'form-org', 'active');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('ea000000-0000-4000-8000-000000000011', 'ea000000-0000-4000-8000-000000000001', 'Form Facility', 'PCH');
insert into public.residents(id, organization_id, facility_id, first_name, last_name, admission_date, status) values
  ('ea000000-0000-4000-8000-000000000201', 'ea000000-0000-4000-8000-000000000001',
   'ea000000-0000-4000-8000-000000000011', 'Ada', 'Resident', public.pa_today() - 100, 'active');
insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values ('00000000-0000-0000-0000-000000000000', 'ea000000-0000-4000-8000-000000000101',
  'authenticated', 'authenticated', 'form-admin@test.local', 'x', now(), '{}', '{}',
  now(), now(), '', '', '', '', '', '', false, false);
select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active)
values ('ea000000-0000-4000-8000-000000000101', 'ea000000-0000-4000-8000-000000000001',
        'form-admin@test.local', 'F', 'Admin', 'org_admin', true)
on conflict (id) do update
set organization_id = excluded.organization_id, role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);

-- SECURITY INVOKER (the plpgsql default), so the delete below runs as whoever calls it -- the
-- org_admin, under the same policies PostgREST would apply. Defined before the role switch because
-- creating it is the only thing here that needs the owner.
create or replace function pg_temp.try_delete_form(p_id uuid)
returns integer language plpgsql as $fn$
declare v_count integer;
begin
  delete from public.resident_assessment_forms where id = p_id;
  get diagnostics v_count = row_count;
  return v_count;
end $fn$;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"ea000000-0000-4000-8000-000000000101","role":"authenticated","aal":"aal2"}', true);

-- Three forms. Version numbers differ because (resident, form_type, version) is unique.
--   301  finalized, recorded a service       -> also protected by ON DELETE RESTRICT
--   302  finalized, recorded no service      -> the case that was deletable
--   303  left as a draft                     -> the control
insert into public.resident_assessment_forms(
  id, resident_id, form_type, reason, version_number, status, schema_version, content,
  prepared_by_profile_id, prepared_by_name, prepared_date
) values
  ('ea000000-0000-4000-8000-000000000301', 'ea000000-0000-4000-8000-000000000201', 'ASP', 'annual', 1,
   'draft', 1,
   '{"section1":{"items":{"bathing":{"planDescription":"Staff assist with bathing","planFrequency":"daily"}}}}'::jsonb,
   'ea000000-0000-4000-8000-000000000101', 'F Admin', public.pa_today() - 30),
  ('ea000000-0000-4000-8000-000000000302', 'ea000000-0000-4000-8000-000000000201', 'ASP', 'annual', 2,
   'draft', 1, '{}'::jsonb,
   'ea000000-0000-4000-8000-000000000101', 'F Admin', public.pa_today() - 30),
  ('ea000000-0000-4000-8000-000000000303', 'ea000000-0000-4000-8000-000000000201', 'ASP', 'annual', 3,
   'draft', 1, '{}'::jsonb,
   'ea000000-0000-4000-8000-000000000101', 'F Admin', public.pa_today() - 30);

select lives_ok(
  $$select public.finalize_resident_assessment_form('ea000000-0000-4000-8000-000000000301')$$,
  'CONTROL: an org_admin can finalize an assessment form at all'
);
select lives_ok(
  $$select public.finalize_resident_assessment_form('ea000000-0000-4000-8000-000000000302')$$,
  'CONTROL: and finalize one that records no services'
);
-- The two halves of the old, incidental protection. Only the first form generated a downstream row,
-- and only that first form was undeletable because of it.
select is(
  (select count(*)::int from public.resident_service_requirements
   where source_assessment_form_id = 'ea000000-0000-4000-8000-000000000301'),
  1,
  'CONTROL: the first form produced a service requirement, the second produced none'
);

-- The control that makes the next assertion mean something: this role really can delete a form.
select is(
  pg_temp.try_delete_form('ea000000-0000-4000-8000-000000000303'),
  1,
  'CONTROL: an org_admin can still delete a DRAFT form'
);

-- The defect. Measured as a row count rather than an exception: RLS makes a forbidden DELETE match
-- no rows, it does not raise, so `throws_ok` would pass against a policy that allowed everything and
-- simply found nothing.
select is(
  pg_temp.try_delete_form('ea000000-0000-4000-8000-000000000302'),
  0,
  'a finalized state form that recorded no services cannot be deleted either'
);
select ok(
  exists (select 1 from public.resident_assessment_forms
          where id = 'ea000000-0000-4000-8000-000000000302' and status = 'finalized'),
  'and it is still on file afterwards'
);

reset role;

-- The structural ratchet -------------------------------------------------------------------------
--
-- The shape of the bug, not the instance: an UPDATE policy that refuses to modify a record in a
-- locked lifecycle state, sitting next to a DELETE policy that will remove it in that same state.
--
-- The first version of this sweep returned 23 tables, all false positives, because the alternation
-- contained `signed` -- which matches `is_as[signed]_to_facility`, present in most write policies in
-- this schema. is_assigned_to_facility is masked out below for that reason. With it masked, exactly
-- one table matched, which is what made this worth fixing rather than a schema-wide pattern.
select is(
  (select coalesce(string_agg(upd.tbl, ', ' order by upd.tbl), '(none)')
   from (select polrelid::regclass::text as tbl,
                string_agg(replace(coalesce(pg_get_expr(polqual, polrelid), ''),
                                   'is_assigned_to_facility', 'ASSIGNFN'), ' ') as q
         from pg_catalog.pg_policy
         where polcmd = 'w'
           and polrelid in (select oid from pg_catalog.pg_class
                            where relnamespace = 'public'::regnamespace)
         group by 1) upd
   join (select polrelid::regclass::text as tbl,
                string_agg(replace(coalesce(pg_get_expr(polqual, polrelid), ''),
                                   'is_assigned_to_facility', 'ASSIGNFN'), ' ') as q
         from pg_catalog.pg_policy
         where polcmd = 'd'
           and polrelid in (select oid from pg_catalog.pg_class
                            where relnamespace = 'public'::regnamespace)
         group by 1) del on del.tbl = upd.tbl
   where upd.q ~* '(status|state|lifecycle_state|is_locked|is_final|finalized|published|locked|approved|effective|entered_in_error|superseded_by_id|signed_at|completed_at)[[:space:]]*(=|<>|IS)'
     and del.q !~* '(status|state|lifecycle_state|is_locked|is_final|finalized|published|locked|approved|effective|entered_in_error|superseded_by_id|signed_at|completed_at)[[:space:]]*(=|<>|IS)'),
  '(none)',
  'no table locks a lifecycle state against UPDATE while leaving DELETE open'
);

select * from finish();
rollback;
