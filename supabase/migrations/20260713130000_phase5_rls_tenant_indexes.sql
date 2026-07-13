-- Phase 5 tables shipped with RLS policies that filter every row on
-- organization_id (and often facility_id) plus parent-record foreign keys, but
-- without matching indexes those policy predicates and child-row lookups become
-- sequential scans as data grows. Add the missing tenant/scope and FK indexes.
-- Tables whose unique constraints already lead with the relevant column
-- (e.g. work_item_watchers(work_item_id, profile_id)) are intentionally skipped.

-- 20260712035922_phase5_work_items_confidential_incidents_moveins.sql
create index if not exists work_item_templates_org_idx on public.work_item_templates(organization_id);
create index if not exists work_item_comments_work_item_idx on public.work_item_comments(work_item_id);
create index if not exists work_item_comments_org_idx on public.work_item_comments(organization_id);
create index if not exists work_item_evidence_work_item_idx on public.work_item_evidence(work_item_id);
create index if not exists work_item_evidence_org_fac_idx on public.work_item_evidence(organization_id, facility_id);
create index if not exists work_item_history_work_item_idx on public.work_item_history(work_item_id);
create index if not exists work_item_history_org_fac_idx on public.work_item_history(organization_id, facility_id);
create index if not exists work_item_dependencies_depends_on_idx on public.work_item_dependencies(depends_on_work_item_id);
create index if not exists confidential_incident_intakes_org_idx on public.confidential_incident_intakes(organization_id);
create index if not exists confidential_incident_details_org_idx on public.confidential_incident_details(organization_id);
create index if not exists confidential_reporter_identities_org_idx on public.confidential_reporter_identities(organization_id);
create index if not exists confidential_incident_access_events_intake_idx on public.confidential_incident_access_events(intake_id);
create index if not exists confidential_incident_access_events_org_idx on public.confidential_incident_access_events(organization_id);
create index if not exists move_in_workspaces_org_fac_idx on public.move_in_workspaces(organization_id, facility_id);
create index if not exists move_in_workspaces_template_idx on public.move_in_workspaces(template_id);
create index if not exists move_in_tasks_org_fac_idx on public.move_in_tasks(organization_id, facility_id);
create index if not exists move_in_guest_grants_workspace_idx on public.move_in_guest_grants(workspace_id);
create index if not exists move_in_guest_grants_org_idx on public.move_in_guest_grants(organization_id);
create index if not exists move_in_guest_access_events_grant_idx on public.move_in_guest_access_events(guest_grant_id);
create index if not exists move_in_guest_access_events_workspace_idx on public.move_in_guest_access_events(workspace_id);
create index if not exists move_in_guest_access_events_org_idx on public.move_in_guest_access_events(organization_id);

-- 20260712035925_phase5_historical_reports_and_evidence_room.sql
create index if not exists saved_report_definitions_org_idx on public.saved_report_definitions(organization_id);
create index if not exists saved_report_versions_org_idx on public.saved_report_versions(organization_id);
create index if not exists report_schedules_org_idx on public.report_schedules(organization_id);
create index if not exists report_schedules_definition_idx on public.report_schedules(report_definition_id);
create index if not exists report_schedules_version_idx on public.report_schedules(report_version_id);
create index if not exists report_snapshots_org_idx on public.report_snapshots(organization_id);
create index if not exists report_snapshots_definition_idx on public.report_snapshots(report_definition_id);
create index if not exists report_snapshot_artifacts_org_idx on public.report_snapshot_artifacts(organization_id);
create index if not exists historical_metric_snapshots_source_snapshot_idx on public.historical_metric_snapshots(source_snapshot_id);
create index if not exists evidence_collections_org_fac_idx on public.evidence_collections(organization_id, facility_id);
create index if not exists evidence_collection_artifacts_org_idx on public.evidence_collection_artifacts(organization_id);
create index if not exists evidence_collection_artifacts_snapshot_artifact_idx on public.evidence_collection_artifacts(snapshot_artifact_id);
create index if not exists evidence_guest_grants_collection_idx on public.evidence_guest_grants(collection_id);
create index if not exists evidence_guest_grants_org_idx on public.evidence_guest_grants(organization_id);
create index if not exists evidence_guest_access_events_collection_idx on public.evidence_guest_access_events(collection_id);
create index if not exists evidence_guest_access_events_grant_idx on public.evidence_guest_access_events(guest_grant_id);
create index if not exists evidence_guest_access_events_org_idx on public.evidence_guest_access_events(organization_id);
create index if not exists evidence_guest_comments_collection_idx on public.evidence_guest_comments(collection_id);
create index if not exists evidence_guest_comments_grant_idx on public.evidence_guest_comments(guest_grant_id);
create index if not exists evidence_guest_comments_org_idx on public.evidence_guest_comments(organization_id);
