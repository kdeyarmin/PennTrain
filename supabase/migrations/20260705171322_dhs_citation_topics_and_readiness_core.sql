-- Tier 3.1 (ROADMAP.md): DHS inspection-readiness dashboard + entrance-conference packet.
--
-- dhs_citation_topics is a global reference table mapping the compliance dimensions this
-- product already tracks (training types, credentials, inspection items) to the PA 55 Pa.
-- Code Chapter 2600 (personal care homes) / 2800 (assisted living) topic areas a DHS surveyor
-- organizes an inspection around. frequency_weight is a default planning weight -- there is no
-- public BHSL citation-frequency feed to source a live number from, so this is a clearly-labeled
-- estimate (same "configurable default, not legal advice" posture training_types.citation_note
-- already uses), letting the readiness score below emphasize commonly-cited areas without
-- overclaiming a statistical source.
create table public.dhs_citation_topics (
  id uuid primary key default gen_random_uuid(),
  chapter text not null check (chapter in ('2600', '2800', 'both')),
  citation_ref text,
  category text not null unique,
  title text not null,
  frequency_weight numeric not null default 1.0 check (frequency_weight > 0),
  notes text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
alter table public.dhs_citation_topics enable row level security;
create policy dhs_citation_topics_select on public.dhs_citation_topics for select to authenticated using (true);
revoke all on public.dhs_citation_topics from public, anon;
grant select on public.dhs_citation_topics to authenticated;

insert into public.dhs_citation_topics (chapter, citation_ref, category, title, frequency_weight, notes, sort_order) values
  ('both', null, 'Abuse, Neglect, and Exploitation', 'Abuse, Neglect & Exploitation Reporting', 1.4, 'Configurable default weight, not legal advice -- verify against current regulations.', 10),
  ('both', null, 'Administrator Training', 'Administrator Qualification & Continuing Education', 1.0, 'Configurable default weight, not legal advice -- verify against current regulations.', 20),
  ('both', '2600.65 / 2800.69', 'Dementia Care', 'Dementia-Specific Staff Training', 1.1, 'Configurable default weight; section numbers approximate -- verify against current regulations.', 30),
  ('both', '2600.65 / 2800.65', 'Direct Care Staff Training', 'Direct Care Staff Annual Training Hours', 1.3, 'Configurable default weight; section numbers approximate -- verify against current regulations.', 40),
  ('both', null, 'Fire Safety', 'Fire Safety & Life Safety Compliance', 1.5, 'Configurable default weight, not legal advice -- verify against current regulations.', 50),
  ('both', null, 'Infection Control', 'Infection Control Practices', 1.0, 'Configurable default weight, not legal advice -- verify against current regulations.', 60),
  ('2600', '2600.190', 'Medication Administration Tracking', 'Medication Administration Certification', 1.4, 'Configurable default weight; section number approximate -- verify against current regulations.', 70),
  ('2600', null, 'Personal Care Home Orientation', 'New Employee Orientation', 1.0, 'Configurable default weight, not legal advice -- verify against current regulations.', 80),
  ('both', null, 'Resident Rights', 'Resident Rights & Dignity', 1.3, 'Configurable default weight, not legal advice -- verify against current regulations.', 90),
  ('both', null, 'Staff Competency', 'Staff Competency & Trainer Certification', 1.0, 'Configurable default weight, not legal advice -- verify against current regulations.', 100),
  ('both', '2600.51 / 2800.51', 'Background Checks & Health Screening', 'Criminal History, FBI, Child Abuse & Health Clearances', 1.3, 'Configurable default weight; section numbers approximate -- verify against current regulations.', 110),
  ('both', null, 'Professional Licensure & Registry Status', 'RN/LPN Licensure & Nurse Aide Registry Status', 1.1, 'Configurable default weight, not legal advice -- verify against current regulations.', 120),
  ('both', null, 'Life Safety Equipment & Inspections', 'Fire & Life Safety Equipment Inspections', 1.4, 'Configurable default weight, not legal advice -- verify against current regulations.', 130),
  ('both', null, 'Emergency Preparedness Procedures', 'Emergency Preparedness Plan & Drills', 1.2, 'Configurable default weight, not legal advice -- verify against current regulations.', 140),
  ('both', null, 'Incident Reporting & Investigation', 'Reportable Incident Follow-Through', 1.3, 'Configurable default weight, not legal advice -- verify against current regulations. Not FK-linked to a single table -- read from incidents directly.', 150);

alter table public.training_types add column citation_topic_id uuid references public.dhs_citation_topics(id);
alter table public.employee_credentials add column citation_topic_id uuid references public.dhs_citation_topics(id);
alter table public.inspection_items add column citation_topic_id uuid references public.dhs_citation_topics(id);

update public.training_types tt set citation_topic_id = ct.id
from public.dhs_citation_topics ct
where ct.category = tt.category and tt.citation_topic_id is null;

update public.employee_credentials ec set citation_topic_id = ct.id
from public.dhs_citation_topics ct
where ct.category = 'Background Checks & Health Screening'
  and ec.credential_type in ('act34_criminal_history', 'act73_fbi_fingerprint', 'act33_child_abuse', 'tb_screening', 'immunization')
  and ec.citation_topic_id is null;

update public.employee_credentials ec set citation_topic_id = ct.id
from public.dhs_citation_topics ct
where ct.category = 'Professional Licensure & Registry Status'
  and ec.credential_type in ('rn_license', 'lpn_license', 'nurse_aide_registry')
  and ec.citation_topic_id is null;

update public.inspection_items ii set citation_topic_id = ct.id
from public.dhs_citation_topics ct
where ct.category = 'Life Safety Equipment & Inspections' and ii.item_kind = 'equipment' and ii.citation_topic_id is null;

update public.inspection_items ii set citation_topic_id = ct.id
from public.dhs_citation_topics ct
where ct.category = 'Emergency Preparedness Procedures' and ii.item_kind = 'procedural' and ii.citation_topic_id is null;

-- Keep future rows auto-tagged so the readiness score below never silently drops a new training
-- type/credential/inspection item into an "untagged" bucket just because nobody remembered to
-- pick a citation topic on the create form (this product has no such form field -- tagging is
-- entirely derived from category/credential_type/item_kind, mirroring the rulepack engine's
-- own "derive metadata, don't ask the user to re-enter it" convention).
create or replace function public.auto_tag_training_type_citation_topic()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.citation_topic_id is null then
    select id into new.citation_topic_id from public.dhs_citation_topics where category = new.category;
  end if;
  return new;
end;
$$;
revoke all on function public.auto_tag_training_type_citation_topic() from public, anon, authenticated;
create trigger trg_auto_tag_training_type_citation_topic
  before insert on public.training_types
  for each row execute function public.auto_tag_training_type_citation_topic();

create or replace function public.auto_tag_employee_credential_citation_topic()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.citation_topic_id is null then
    if new.credential_type in ('act34_criminal_history', 'act73_fbi_fingerprint', 'act33_child_abuse', 'tb_screening', 'immunization') then
      select id into new.citation_topic_id from public.dhs_citation_topics where category = 'Background Checks & Health Screening';
    elsif new.credential_type in ('rn_license', 'lpn_license', 'nurse_aide_registry') then
      select id into new.citation_topic_id from public.dhs_citation_topics where category = 'Professional Licensure & Registry Status';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.auto_tag_employee_credential_citation_topic() from public, anon, authenticated;
create trigger trg_auto_tag_employee_credential_citation_topic
  before insert on public.employee_credentials
  for each row execute function public.auto_tag_employee_credential_citation_topic();

create or replace function public.auto_tag_inspection_item_citation_topic()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.citation_topic_id is null then
    if new.item_kind = 'equipment' then
      select id into new.citation_topic_id from public.dhs_citation_topics where category = 'Life Safety Equipment & Inspections';
    elsif new.item_kind = 'procedural' then
      select id into new.citation_topic_id from public.dhs_citation_topics where category = 'Emergency Preparedness Procedures';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.auto_tag_inspection_item_citation_topic() from public, anon, authenticated;
create trigger trg_auto_tag_inspection_item_citation_topic
  before insert on public.inspection_items
  for each row execute function public.auto_tag_inspection_item_citation_topic();

-- Per-facility readiness breakdown: security-invoker (the default -- no `security definer`
-- here) so it runs under the CALLER's own RLS-scoped view of employee_training_records/
-- employee_credentials/inspection_items exactly like a direct .select() would, rather than
-- needing to reimplement org/facility-manager scoping the way the service-role edge functions
-- do. not_applicable rows are excluded from both compliant and total so an explicitly-exempted
-- requirement never drags the score down.
create or replace function public.get_facility_readiness_breakdown(p_facility_id uuid)
returns table (
  citation_topic_id uuid,
  chapter text,
  citation_ref text,
  category text,
  title text,
  frequency_weight numeric,
  compliant_count bigint,
  total_count bigint
) language sql stable set search_path to 'public' as $$
  with training as (
    select tt.citation_topic_id,
           count(*) filter (where r.status = 'compliant') as compliant,
           count(*) filter (where r.status <> 'not_applicable') as total
    from public.employee_training_records r
    join public.training_types tt on tt.id = r.training_type_id
    where r.facility_id = p_facility_id
    group by tt.citation_topic_id
  ),
  credentials as (
    select ec.citation_topic_id,
           count(*) filter (where ec.status = 'compliant') as compliant,
           count(*) filter (where ec.status <> 'not_applicable') as total
    from public.employee_credentials ec
    where ec.facility_id = p_facility_id
    group by ec.citation_topic_id
  ),
  inspections as (
    select ii.citation_topic_id,
           count(*) filter (where ii.status = 'compliant') as compliant,
           count(*) filter (where ii.status <> 'not_applicable') as total
    from public.inspection_items ii
    where ii.facility_id = p_facility_id and ii.is_active
    group by ii.citation_topic_id
  ),
  combined as (
    select * from training
    union all select * from credentials
    union all select * from inspections
  ),
  agg as (
    select citation_topic_id, sum(compliant) as compliant_count, sum(total) as total_count
    from combined
    group by citation_topic_id
  )
  select ct.id, ct.chapter, ct.citation_ref, ct.category, ct.title, ct.frequency_weight,
         coalesce(a.compliant_count, 0), coalesce(a.total_count, 0)
  from public.dhs_citation_topics ct
  left join agg a on a.citation_topic_id = ct.id
  order by ct.sort_order;
$$;
revoke all on function public.get_facility_readiness_breakdown(uuid) from public, anon;
grant execute on function public.get_facility_readiness_breakdown(uuid) to authenticated;
