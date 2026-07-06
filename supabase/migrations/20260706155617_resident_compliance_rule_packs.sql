create table public.resident_compliance_rule_packs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  state text not null default 'PA',
  facility_type text not null check (facility_type in ('PCH', 'ALR')),
  item_type text not null check (item_type in (
    'preadmission_screening', 'initial_assessment_15day', 'support_plan_30day',
    'annual_reassessment', 'medical_evaluation', 'significant_change_reassessment'
  )),
  admission_track text not null default 'standard' check (admission_track in ('standard', 'expedited')),
  offset_basis text not null check (offset_basis in ('before_admission', 'after_admission')),
  offset_days integer not null,
  renewal_interval_days integer,
  grace_period_days integer not null default 0,
  warning_days integer not null default 30,
  citation_ref text,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);
create index resident_compliance_rule_packs_lookup_idx
  on public.resident_compliance_rule_packs(facility_type, admission_track, state) where is_active;

alter table public.resident_compliance_rule_packs enable row level security;
create policy resident_compliance_rule_packs_select on public.resident_compliance_rule_packs for select to authenticated using (true);
revoke all on public.resident_compliance_rule_packs from public, anon;
grant select on public.resident_compliance_rule_packs to authenticated;

alter table public.residents add column admission_track text not null default 'standard' check (admission_track in ('standard', 'expedited'));

insert into public.resident_compliance_rule_packs
  (facility_type, item_type, admission_track, offset_basis, offset_days, renewal_interval_days, grace_period_days, warning_days, citation_ref, notes)
values
  ('PCH', 'preadmission_screening', 'standard', 'before_admission', 0, null, 0, 7, '2600.224',
   'Due by admission (must be completed within the 30 days prior); zero grace, confirmed.'),
  ('PCH', 'initial_assessment_15day', 'standard', 'after_admission', 15, null, 0, 7, '2600.225',
   'Zero grace, confirmed.'),
  ('PCH', 'support_plan_30day', 'standard', 'after_admission', 30, null, 0, 14, '2600.227',
   'Zero grace, confirmed.'),
  ('PCH', 'annual_reassessment', 'standard', 'after_admission', 365, 365, 15, 30, '2600.225',
   '15-day grace confirmed via the 2600 RCG''s general Grace Periods table (12 months + 15 days).'),
  ('PCH', 'medical_evaluation', 'standard', 'after_admission', 30, 365, 0, 30, '2600.141',
   'Initial due date is the outer edge of the 60-before/30-after window. Grace period NOT '
   'confirmed for the PCH-side (2600.141) RCG in this research pass -- left at 0 (conservative) '
   'pending confirmation; see plan Open Items.');

insert into public.dhs_citation_topics (chapter, citation_ref, category, title, frequency_weight, notes, sort_order) values
  ('2800', '2800.224', 'ALR Initial Assessment & Support Plan', 'ALR Initial Assessment & Preliminary Support Plan Deadlines', 1.2,
   'Verified: 55 Pa Code 2800.224 covers both the initial assessment and preliminary support plan together.', 156),
  ('2800', '2800.225', 'ALR Annual & Significant-Change Reassessment', 'ALR Annual & Significant-Change Reassessment', 1.2,
   'Verified: 55 Pa Code 2800.225. Grace period for the annual cycle not yet confirmed -- see plan Open Items.', 161),
  ('2800', '2800.141', 'ALR Medical Evaluations', 'ALR Medical Evaluation Cycle', 1.15,
   'Verified: 55 Pa Code 2800.141/2800.22(a)(1). 15-day annual grace confirmed via the 2800 RCG.', 171);

insert into public.resident_compliance_rule_packs
  (facility_type, item_type, admission_track, offset_basis, offset_days, renewal_interval_days, grace_period_days, warning_days, citation_ref, notes)
values
  ('ALR', 'initial_assessment_15day', 'standard', 'before_admission', 30, null, 0, 14, '2800.224',
   'Normal ALR track: due 30 days before admission (not after, unlike PCH).'),
  ('ALR', 'support_plan_30day', 'standard', 'before_admission', 30, null, 0, 14, '2800.224',
   'Preliminary support plan, same 30-days-before track as the initial assessment.'),
  ('ALR', 'initial_assessment_15day', 'expedited', 'after_admission', 15, null, 0, 7, '2800.224',
   'Only for the 3 named expedited conditions (direct transfer from an acute-care hospital; '
   'escaping an abusive situation; no alternative living arrangement).'),
  ('ALR', 'support_plan_30day', 'expedited', 'after_admission', 15, null, 0, 7, '2800.224',
   'Same expedited-track day-count as the initial assessment -- bundled with it in 2800.224''s '
   'own text; not independently re-verified line-by-line for the support-plan half.'),
  ('ALR', 'annual_reassessment', 'standard', 'after_admission', 365, 365, 0, 30, '2800.225',
   'Grace period NOT confirmed for Ch. 2800''s general Grace Periods table in this research pass '
   '(only the section-specific 2800.225 discussion was checked, which had no grace language) -- '
   'left at 0 (conservative) pending confirmation; see plan Open Items.'),
  ('ALR', 'medical_evaluation', 'standard', 'before_admission', 0, 365, 15, 30, '2800.141',
   'Due by admission (60 days prior window). 15-day annual grace IS confirmed via the 2800 RCG.'),
  ('ALR', 'medical_evaluation', 'expedited', 'after_admission', 15, 365, 15, 14, '2800.141',
   'Expedited track per 2800.22(a)(1), same 3 named conditions as the assessment/support-plan '
   'exception. 15-day annual grace confirmed via the 2800 RCG.');

create or replace function public.instantiate_resident_compliance_items(p_resident_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_res record; v_facility_type text; v_rule record;
begin
  select id, organization_id, facility_id, admission_date, admission_track into v_res
  from public.residents where id = p_resident_id;
  if v_res.id is null then
    return;
  end if;

  select facility_type into v_facility_type from public.facilities where id = v_res.facility_id;

  for v_rule in
    select distinct on (item_type) *
    from public.resident_compliance_rule_packs
    where facility_type = v_facility_type
      and admission_track = v_res.admission_track
      and state = 'PA'
      and is_active
      and (organization_id = v_res.organization_id or organization_id is null)
    order by item_type, organization_id nulls last
  loop
    insert into public.resident_compliance_items
      (organization_id, facility_id, resident_id, item_type, due_date, renewal_interval_days, warning_days, grace_period_days, citation_topic_id)
    values (
      v_res.organization_id, v_res.facility_id, v_res.id, v_rule.item_type,
      case when v_rule.offset_basis = 'before_admission'
        then v_res.admission_date - v_rule.offset_days
        else v_res.admission_date + v_rule.offset_days
      end,
      v_rule.renewal_interval_days, v_rule.warning_days, v_rule.grace_period_days,
      (select id from public.dhs_citation_topics where citation_ref = v_rule.citation_ref)
    );
  end loop;
end;
$$;
revoke all on function public.instantiate_resident_compliance_items(uuid) from public, anon, authenticated;
