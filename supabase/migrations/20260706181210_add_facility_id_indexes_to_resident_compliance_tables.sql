-- Forward-fix (review finding): resident_compliance_items, resident_documents,
-- resident_assessment_forms, and resident_informal_supports all index organization_id and
-- resident_id but none of them index facility_id -- even though facility_id is the exact column
-- every one of their RLS SELECT/INSERT/UPDATE policies filters on via is_assigned_to_facility
-- (facility_id) for the facility_manager branch. As these tables grow (many orgs, many residents,
-- several compliance items per resident), every facility_manager-role query forces a sequential
-- scan (or a much less selective organization_id-only index scan) to evaluate that predicate,
-- unlike the sibling `residents` table which already has `residents_facility_idx`.
create index resident_compliance_items_facility_idx on public.resident_compliance_items(facility_id);
create index resident_documents_facility_idx on public.resident_documents(facility_id);
create index resident_assessment_forms_facility_idx on public.resident_assessment_forms(facility_id);
create index resident_informal_supports_facility_idx on public.resident_informal_supports(facility_id);
