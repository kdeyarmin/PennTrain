alter table public.administrator_profiles drop constraint administrator_profiles_qualification_path_check;
alter table public.administrator_profiles add constraint administrator_profiles_qualification_path_check
 check(qualification_path in ('hundred_hour_course','nha_exemption','legacy_pch','pch_course_supplement'));
alter table public.administrator_profiles
 add column legacy_no_break_over_one_year boolean not null default false,
 add column legacy_training_document_path text,
 add column competency_exemption_basis text not null default 'regulation' check(competency_exemption_basis in ('regulation','rcg_pre_2009')),
 add column competency_exemption_evidence text,
 add column alf_supplement_completed_date date,
 add column alf_supplement_hours numeric check(alf_supplement_hours>=0),
 add column alf_supplement_test_passed boolean not null default false,
 add column alf_supplement_document_path text;
alter table public.administrator_ce_entries add column credit_category text not null default 'general'
 check(credit_category in ('general','medication','resuscitation'));
comment on column public.administrator_profiles.competency_exemption_basis is 'Explicit documented interpretation: regulation cutoff (PCH NHA before October24,2006) or RCG pre-January1,2009 test exemption. Choosing a basis does not fabricate exemption evidence.';
