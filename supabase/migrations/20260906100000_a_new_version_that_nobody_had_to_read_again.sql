-- A new policy version nobody had to read again, a campaign that enrolled new hires into 2024,
-- and a rotated key that orphaned every source bound to it.
--
-- BACKLOG J7, J8, J55 and J9.
--
-- J7. `publish_policy_document_version` writes the version's status and the document's
-- `current_version_id` pointer, and nothing else. The attestation campaign pinned to the OLD
-- version stays open, its signed rows keep counting, and its still-pending rows stay signable --
-- `attest-policy` checks only that the attestation is pending. So with v1 fully signed and v2
-- published this morning, the policy lifecycle card reads "Lifecycle current -- No immediate
-- action" and the surveyor-facing crosswalk row reads "Inspection-ready", for a version nobody has
-- read. Only a recurring campaign ever re-pins, up to eleven months later.
--
-- J8. `run_policy_campaign_targeting` sweeps every declarative campaign, every day, for ever: no
-- due-date cut-off, no closed state, no notion of which cycle in a series is current. A hire in
-- year three is enrolled into cycle 1 and cycle 2 -- superseded versions, due dates already past
-- -- instantly overdue, notified "due Oct 01, 2026", and reminded every three days for the rest of
-- their employment. The only way to stop it was deleting the campaign, which cascades every signed
-- attestation on it: the evidence is the thing you would have to destroy to stop the noise.
--
-- J55. A manual recurring cycle copies the SERIES PARENT's roster, so every cycle is cycle 1's
-- roster minus terminations and anyone added to a later cycle through its own Assign button is
-- dropped at the next rollover.
--
-- J9. `rotate_integration_api_credential` inserts the replacement and marks the old key `rotated`,
-- and never repoints `fhir_integration_sources.credential_id` or
-- `medication_integration_sources.credential_id`. The old key is refused; the new key's bundles
-- are 202-accepted and then rejected at apply time on a credential mismatch. Both source dialogs
-- are create-only and the unique key refuses a replacement source, so there is no way back --
-- and rotation is what the console itself recommends as the response to a leaked key.

-- ---------------------------------------------------------------------------
-- J7, J8 -- a campaign can end, and a pending signature can go stale
-- ---------------------------------------------------------------------------

alter table public.policy_attestation_campaigns
  add column if not exists closed_at timestamptz,
  add column if not exists closed_reason text;

comment on column public.policy_attestation_campaigns.closed_at is
  'When this campaign stopped accepting new enrolments and stopped counting as outstanding work. '
  'Set by an administrator ending a series, and by publish_policy_document_version when a newer '
  'version of the document supersedes the one this campaign is pinned to. Before BACKLOG J8 the '
  'only way to stop a campaign was to delete it, which cascades every signed attestation on it.';
comment on column public.policy_attestation_campaigns.closed_reason is
  'Why the campaign was closed -- ''superseded_by_version'' when a newer policy version replaced '
  'the one it is pinned to, otherwise an administrator''s own words.';

alter table public.policy_attestations
  add column if not exists superseded_at timestamptz;

comment on column public.policy_attestations.superseded_at is
  'Set when the policy version this attestation is pinned to stopped being current. The row is '
  'kept -- an attested row is evidence and is never destroyed -- but a still-pending one stops '
  'being reminded about, stops counting as outstanding, and can no longer be signed: signing '
  'superseded text is not evidence that anybody read the policy in force. BACKLOG J7.';

create index if not exists policy_attestations_open_idx
  on public.policy_attestations (campaign_id)
  where status = 'pending' and superseded_at is null;

do $do$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'publish_policy_document_version';
  if v_def is null then raise exception 'public.publish_policy_document_version is missing'; end if;

  v_old := '  update public.policy_documents
     set current_version_id = v_version.id
   where id = v_version.policy_document_id;

  return v_version.id;';
  v_new := '  update public.policy_documents
     set current_version_id = v_version.id
   where id = v_version.policy_document_id;

  -- BACKLOG J7. Publishing a new version is the moment every attestation against an older one
  -- stops being evidence that staff have read the policy in force. The signed rows are kept --
  -- they are the record of what was true then -- but they stop counting as current, the pending
  -- ones stop being reminded about and can no longer be signed, and the campaign that issued them
  -- is closed so the daily targeting sweep stops enrolling new hires into superseded text.
  --
  -- Deliberately scoped to campaigns for THIS document pinned to a version that is not the one
  -- just published. A campaign already closed keeps its original reason.
  update public.policy_attestations pa
  set superseded_at = now(), updated_at = now()
  from public.policy_attestation_campaigns c
  where c.id = pa.campaign_id
    and c.policy_document_id = v_version.policy_document_id
    and c.policy_document_version_id <> v_version.id
    and pa.status = ''pending''
    and pa.superseded_at is null;

  update public.policy_attestation_campaigns c
  set closed_at = now(), closed_reason = ''superseded_by_version''
  where c.policy_document_id = v_version.policy_document_id
    and c.policy_document_version_id <> v_version.id
    and c.closed_at is null;

  return v_version.id;';
  if position(v_old in v_def) = 0 then
    raise exception 'publish_policy_document_version no longer contains the pointer update this migration patches';
  end if;
  execute replace(v_def, v_old, v_new);
end;
$do$;

comment on function public.publish_policy_document_version(uuid, uuid) is
  'Publishes a draft policy version and repoints the document at it. Publishing also supersedes '
  'every campaign for the document pinned to an older version and marks their still-pending '
  'attestations superseded, so the lifecycle card and the regulatory crosswalk stop reading '
  '"inspection-ready" off signatures against text nobody is required to follow any more, and the '
  'daily targeting sweep stops enrolling new hires into it. Signed rows are never touched. '
  'BACKLOG J7.';

-- The daily declarative sweep. Three things now stop it, none of which existed: a closed campaign,
-- a due date already past, and a newer cycle in the same series.
create or replace function public.run_policy_campaign_targeting()
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_campaign_id uuid;
  v_total integer := 0;
begin
  if auth.uid() is not null and coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise exception 'Service role is required' using errcode = '42501';
  end if;

  for v_campaign_id in
    select c.id from public.policy_attestation_campaigns c
    join public.organizations o on o.id = c.organization_id
    where c.targeting_mode = 'declarative'
      and o.subscription_status not in ('suspended', 'canceled')
      -- BACKLOG J8. An administrator has ended this series.
      and c.closed_at is null
      -- A cycle whose deadline has passed is finished. Enrolling somebody into it produces an
      -- attestation that is overdue the instant it exists, notified with a due date in the past
      -- and reminded about every three days for the rest of their employment.
      and (c.due_date is null or c.due_date >= public.pa_today())
      -- And only the CURRENT cycle of a series enrols. `coalesce(recurrence_parent_id, id)` is the
      -- series key: a parent with children, and every superseded child, both fall out here.
      and not exists (
        select 1 from public.policy_attestation_campaigns newer
        where coalesce(newer.recurrence_parent_id, newer.id)
              = coalesce(c.recurrence_parent_id, c.id)
          and newer.id <> c.id
          and newer.created_at > c.created_at
      )
    order by c.created_at
  loop
    v_total := v_total + public.materialize_policy_campaign_targets(v_campaign_id);
  end loop;
  return v_total;
end;
$function$;

comment on function public.run_policy_campaign_targeting() is
  'Daily re-evaluation of every declarative campaign''s roster. Only an open campaign, still '
  'inside its due date, that is the current cycle of its series, enrols anybody. Before BACKLOG J8 '
  'this swept every declarative campaign ever created, so a hire in year three was enrolled into '
  'cycle 1 and cycle 2 -- superseded versions, deadlines already past -- instantly overdue and '
  'reminded every three days for the rest of their employment.';

revoke all on function public.run_policy_campaign_targeting()
  from public, anon, authenticated, service_role;
grant execute on function public.run_policy_campaign_targeting() to service_role;

-- Reminders follow the same two rules.
do $do$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'send_policy_attestation_reminders';
  if v_def is null then raise exception 'public.send_policy_attestation_reminders is missing'; end if;

  v_old := '    where pa.status = ''pending''';
  v_new := '    where pa.status = ''pending''
      -- BACKLOG J7/J8: not a signature that has gone stale, and not one on a closed campaign.
      and pa.superseded_at is null
      and c.closed_at is null';
  if position(v_old in v_def) = 0 then
    raise exception 'send_policy_attestation_reminders no longer contains the pending predicate this migration patches';
  end if;
  execute replace(v_def, v_old, v_new);
end;
$do$;

-- ---------------------------------------------------------------------------
-- J55 -- the roster the cycle actually had
-- ---------------------------------------------------------------------------

create or replace function app_private.copy_policy_campaign_roster(
  p_parent_campaign_id uuid,
  p_child_campaign_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_child public.policy_attestation_campaigns%rowtype;
  v_source_id uuid;
  v_inserted integer;
begin
  select * into v_child
  from public.policy_attestation_campaigns
  where id = p_child_campaign_id;
  if not found then
    raise exception 'Policy campaign not found' using errcode = 'P0002';
  end if;

  -- BACKLOG J55. The roster the series MOST RECENTLY had, not cycle 1's. Copying from the parent
  -- meant every cycle was cycle 1's roster minus terminations: anybody added to cycle 2 through
  -- its own Assign button was silently dropped when cycle 3 opened, and the person who added them
  -- had no way to see that had happened.
  select c.id into v_source_id
  from public.policy_attestation_campaigns c
  where (c.id = p_parent_campaign_id or c.recurrence_parent_id = p_parent_campaign_id)
    and c.id <> p_child_campaign_id
    and exists (select 1 from public.policy_attestations pa where pa.campaign_id = c.id)
  order by c.created_at desc, c.id
  limit 1;
  v_source_id := coalesce(v_source_id, p_parent_campaign_id);

  -- Re-checked against employees rather than copied verbatim: someone enrolled a year ago may have
  -- been terminated since, and a permanently pending obligation on a terminated employee is
  -- exactly what materialize_policy_campaign_targets' own comment refuses to create.
  --
  -- organization_id, facility_id, policy_document_version_id and due_date are all assigned by the
  -- BEFORE INSERT trigger from the campaign (20260716221235); they are supplied here only because
  -- the columns are NOT NULL and the trigger runs after the row is formed.
  insert into public.policy_attestations (
    organization_id, facility_id, employee_id, campaign_id, policy_document_version_id
  )
  select distinct
    e.organization_id, e.facility_id, e.id, v_child.id, v_child.policy_document_version_id
  from public.policy_attestations prior
  join public.employees e on e.id = prior.employee_id
  where prior.campaign_id = v_source_id
    and e.status = 'active'
    and e.organization_id = v_child.organization_id
  on conflict on constraint policy_attestations_campaign_employee_uk do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$function$;

comment on function app_private.copy_policy_campaign_roster(uuid, uuid) is
  'Carries a manual recurring campaign''s roster into its next cycle, from the most recent cycle '
  'in the series that has one rather than from the series parent -- so somebody added to cycle 2 '
  'is still on cycle 3 (BACKLOG J55). Terminated employees are dropped on the way through.';

revoke all on function app_private.copy_policy_campaign_roster(uuid, uuid)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- J9 -- rotation carries its sources with it
-- ---------------------------------------------------------------------------

do $do$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'rotate_integration_api_credential';
  if v_def is null then raise exception 'public.rotate_integration_api_credential is missing'; end if;

  v_old := '  update public.integration_api_credentials
  set status = ''rotated'', replaced_by_id = v_new_id, updated_at = now()
  where id = v_old.id;';
  v_new := '  update public.integration_api_credentials
  set status = ''rotated'', replaced_by_id = v_new_id, updated_at = now()
  where id = v_old.id;

  -- BACKLOG J9. Rotation left every FHIR and eMAR source still pointing at the key it had just
  -- retired. The old key was refused at the door; the new key''s bundles were 202-accepted and
  -- then rejected at apply time on a credential mismatch, with no exception row, because the
  -- apply handlers only file one when the source lookup succeeds. Both source dialogs are
  -- create-only and the unique key refuses a replacement, so there was no way to rebind -- and
  -- rotation is what the console recommends as the response to a leaked key.
  -- Aliased: this function RETURNS TABLE (credential_id uuid, ...), so an unqualified
  -- `credential_id` in the WHERE resolves against the output column and is ambiguous.
  update public.fhir_integration_sources fs
  set credential_id = v_new_id, updated_at = now()
  where fs.credential_id = v_old.id;

  update public.medication_integration_sources ms
  set credential_id = v_new_id, updated_at = now()
  where ms.credential_id = v_old.id;';
  if position(v_old in v_def) = 0 then
    raise exception 'rotate_integration_api_credential no longer contains the status update this migration patches';
  end if;
  execute replace(v_def, v_old, v_new);
end;
$do$;

comment on function public.rotate_integration_api_credential(uuid, timestamptz) is
  'Issues a replacement integration API key, retires the old one, and repoints every FHIR and '
  'eMAR source bound to it. Without the repoint the sources kept the retired credential, so the '
  'new key''s bundles were accepted and then silently rejected at apply time and nothing in the '
  'product could rebind them (BACKLOG J9).';
