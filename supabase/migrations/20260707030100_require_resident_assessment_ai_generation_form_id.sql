-- stamp_scope_from_resident_assessment_form() only derived organization_id/facility_id from the
-- referenced form "if new.resident_assessment_form_id is not null" -- since that column was
-- nullable (on delete set null), an insert supplying NULL for it bypassed the trigger's derivation
-- entirely, leaving the row's organization_id/facility_id taken as-is from the caller with nothing
-- enforcing they actually belong together. That's the exact spoofing gap the previous migration's
-- own comment said it was closing, just reached through the one guard it left open.
--
-- Every real caller (the generate-resident-assessment-summary edge function) always has a real
-- form_id at insert time, and this table's whole purpose is proving an AI call happened for a
-- specific form -- a row that outlives its own subject isn't useful here the way it is for
-- course_ai_generations (whose courses get authored/discarded far more routinely), so cascade the
-- delete instead of nulling it out, and require the column so the trigger can never be bypassed.
-- The table is new and has no real rows yet (its writer edge function isn't shipped), so altering
-- it directly is safe.
do $$
declare v_conname text;
begin
  select conname into v_conname
  from pg_constraint
  where conrelid = 'public.resident_assessment_ai_generations'::regclass
    and contype = 'f'
    and pg_get_constraintdef(oid) like '%resident_assessment_form_id%';
  if v_conname is not null then
    execute format('alter table public.resident_assessment_ai_generations drop constraint %I', v_conname);
  end if;
end $$;

alter table public.resident_assessment_ai_generations
  alter column resident_assessment_form_id set not null;

alter table public.resident_assessment_ai_generations
  add constraint resident_assessment_ai_generations_form_fkey
    foreign key (resident_assessment_form_id) references public.resident_assessment_forms(id) on delete cascade;

-- Simplified to match stamp_scope_from_resident()'s exact convention now that the column is
-- required: no more "if present" branch, and raises instead of silently no-opping if the
-- referenced form somehow doesn't resolve.
create or replace function public.stamp_scope_from_resident_assessment_form()
returns trigger language plpgsql set search_path to 'public' as $function$
declare v_org uuid; v_fac uuid;
begin
  select organization_id, facility_id into v_org, v_fac
  from public.resident_assessment_forms where id = new.resident_assessment_form_id;
  if v_org is null then
    raise exception 'resident assessment form % not found', new.resident_assessment_form_id using errcode = 'foreign_key_violation';
  end if;
  new.organization_id := v_org;
  new.facility_id := v_fac;
  return new;
end;
$function$;
