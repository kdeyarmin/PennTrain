-- Codex review follow-up: validate the QAPI project lead server-side.
--
-- create_qapi_project (20260713200000) accepted any profile id as p_project_lead without checking it
-- was active or could access the project's facility. In a mixed-type organization a manager could
-- designate a lead assigned only elsewhere, producing a project whose lead cannot open it. This
-- CREATE OR REPLACE adds the same signature + body plus a lead-access check; existing grants persist.
--
-- Rollback: re-apply the create_qapi_project definition from 20260713200000_formal_qapi_quality_management.sql.

create or replace function public.create_qapi_project(
 p_facility_id uuid,p_title text,p_problem_statement text,p_source_of_concern text,
 p_baseline_data text,p_measurable_objective text,p_target_description text,
 p_target_value numeric,p_target_completion_date date,p_project_lead uuid,
 p_source_type text default null,p_source_id uuid default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_fac public.facilities%rowtype;v_id uuid;v_num text;begin
 select * into v_fac from public.facilities where id=p_facility_id;
 if not found then raise exception 'Facility not found' using errcode='P0002';end if;
 perform app_private.assert_admission_manager(v_fac.organization_id,v_fac.id);
 -- The lead runs the project at this facility, so it must be an active member of the org who can
 -- access the facility: an org/platform admin (org-wide) or a facility manager assigned here.
 if p_project_lead is not null and not exists (
   select 1 from public.profiles p
   where p.id=p_project_lead and p.is_active and p.organization_id=v_fac.organization_id
     and (p.role in ('org_admin','platform_admin')
          or (p.role='facility_manager' and exists (
            select 1 from public.facility_assignments fa where fa.profile_id=p.id and fa.facility_id=v_fac.id)))
 ) then
   raise exception 'The QAPI lead must be an active manager with access to this facility' using errcode='23514';
 end if;
 perform pg_advisory_xact_lock(hashtext(v_fac.organization_id::text));
 if length(btrim(p_title))<3 or length(btrim(p_problem_statement))<10 or p_target_completion_date<current_date then raise exception 'Invalid QAPI project' using errcode='22023';end if;
 if p_source_type is not null and p_source_id is not null then select id into v_id from public.qapi_projects where organization_id=v_fac.organization_id and source_type=p_source_type and source_id=p_source_id;if v_id is not null then return v_id;end if;end if;
 perform pg_advisory_xact_lock(hashtext('qapi_project_numbering'), hashtext(v_fac.organization_id::text));
 v_num:='QAPI-'||to_char(current_date,'YYYY')||'-'||lpad((select (count(*)+1)::text from public.qapi_projects where organization_id=v_fac.organization_id),4,'0');
 insert into public.qapi_projects(organization_id,facility_id,project_number,title,problem_statement,source_of_concern,source_type,source_id,baseline_data,measurable_objective,target_description,target_value,target_completion_date,project_lead_profile_id,created_by)
 values(v_fac.organization_id,v_fac.id,v_num,btrim(p_title),btrim(p_problem_statement),btrim(p_source_of_concern),p_source_type,p_source_id,p_baseline_data,p_measurable_objective,p_target_description,p_target_value,p_target_completion_date,p_project_lead,auth.uid()) returning id into v_id;
 insert into public.qapi_project_history(organization_id,facility_id,project_id,event_type,resulting_status,reason,actor_profile_id)
 values(v_fac.organization_id,v_fac.id,v_id,'created','proposed','QAPI project created',auth.uid()) on conflict do nothing;
 return v_id;end$$;
