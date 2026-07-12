create extension if not exists pgcrypto with schema extensions;

insert into public.permission_definitions(permission_key, description, risk_level)
values
  ('content.studio.author', 'Author governed tenant content revisions', 'standard'),
  ('content.studio.review', 'Independently review governed content revisions', 'privileged'),
  ('content.studio.publish', 'Publish approved governed content', 'privileged'),
  ('policy.lifecycle.manage', 'Manage targeted policy lifecycle and reassignment', 'privileged')
on conflict (permission_key) do update set description = excluded.description, risk_level = excluded.risk_level;

insert into public.role_template_permissions(role_template_id, permission_key)
select rt.id, p.permission_key
from public.role_templates rt
cross join lateral (
  select unnest(case rt.built_in_role
    when 'platform_admin' then array['content.studio.author','content.studio.review','content.studio.publish','policy.lifecycle.manage']::text[]
    when 'org_admin' then array['content.studio.author','content.studio.review','content.studio.publish','policy.lifecycle.manage']::text[]
    when 'facility_manager' then array['content.studio.author']::text[]
    else array[]::text[] end) permission_key
) p
where rt.built_in_role in ('platform_admin','org_admin','facility_manager')
on conflict (role_template_id, permission_key) do nothing;

create table public.governed_content_assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  asset_type text not null check (asset_type in ('course','assessment','media','document','policy')),
  source_id uuid not null,
  title text not null,
  owner_profile_id uuid references public.profiles(id),
  template_asset_id uuid references public.governed_content_assets(id) on delete restrict,
  platform_owned boolean not null default false,
  current_published_revision_id uuid,
  status text not null default 'active' check (status in ('active','retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (organization_id, asset_type, source_id),
  check ((platform_owned and organization_id is null) or not platform_owned)
);

create table public.governed_content_revisions (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.governed_content_assets(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete cascade,
  revision_number integer not null check (revision_number > 0),
  source_version_id uuid,
  state text not null default 'draft' check (state in ('draft','in_review','changes_requested','approved','published','retired','superseded')),
  change_summary text not null,
  material_change boolean not null default false,
  material_change_action text not null default 'none' check (material_change_action in ('none','reassign','reattest','new_due_date')),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  snapshot_sha256 text not null check (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  validation_results jsonb not null default '[]'::jsonb check (jsonb_typeof(validation_results) = 'array'),
  authored_by uuid not null references public.profiles(id),
  submitted_at timestamptz,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_reason text,
  published_by uuid references public.profiles(id),
  published_at timestamptz,
  supersedes_revision_id uuid references public.governed_content_revisions(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (asset_id, revision_number),
  check (not material_change or material_change_action <> 'none'),
  check (state not in ('approved','published') or reviewed_by is not null and reviewed_at is not null),
  check (state <> 'published' or published_by is not null and published_at is not null)
);
alter table public.governed_content_assets add constraint governed_content_current_revision_fk
foreign key (current_published_revision_id) references public.governed_content_revisions(id) on delete restrict;

create table public.governed_content_review_comments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  revision_id uuid not null references public.governed_content_revisions(id) on delete cascade,
  author_profile_id uuid not null references public.profiles(id),
  body text not null check (length(btrim(body)) between 2 and 5000),
  section_path text,
  resolution_status text not null default 'open' check (resolution_status in ('open','resolved','wont_fix')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id)
);

create table public.governed_content_publication_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  asset_id uuid not null references public.governed_content_assets(id) on delete restrict,
  revision_id uuid not null references public.governed_content_revisions(id) on delete restrict,
  event_type text not null check (event_type in ('submitted','changes_requested','approved','published','retired','superseded')),
  actor_profile_id uuid references public.profiles(id),
  reason text not null,
  evidence jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create table public.policy_audience_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  policy_document_id uuid not null references public.policy_documents(id) on delete cascade,
  target_type text not null check (target_type in ('organization','facility','workforce_profile','job_title','employee')),
  target_id uuid,
  target_value text,
  effective_from timestamptz not null,
  effective_to timestamptz,
  requires_attestation boolean not null default true,
  requires_quiz boolean not null default false,
  reminder_days integer[] not null default array[14,7,1],
  exception_rule jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to > effective_from),
  check ((target_type in ('organization','job_title') and target_value is not null) or (target_type not in ('organization','job_title') and target_id is not null))
);

create table public.policy_version_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  policy_document_version_id uuid not null references public.policy_document_versions(id) on delete cascade,
  link_type text not null check (link_type in ('course','training_type','incident','remediation','report_evidence')),
  linked_record_id uuid not null,
  rationale text not null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (policy_document_version_id, link_type, linked_record_id)
);

create table public.policy_delivery_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  policy_document_version_id uuid not null references public.policy_document_versions(id) on delete restrict,
  campaign_id uuid references public.policy_attestation_campaigns(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  audience_rule_id uuid references public.policy_audience_rules(id) on delete restrict,
  event_type text not null check (event_type in ('assigned','reminded','delivered','failed','excepted','reattest_required')),
  idempotency_key text not null unique,
  provider_outcome jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create or replace function app_private.assert_content_permission(p_organization_id uuid, p_permission text)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(auth.jwt()->>'role','') = 'service_role' or public.is_platform_admin() then return; end if;
  if auth.uid() is null or public.current_org_id() is distinct from p_organization_id then
    raise exception 'Content operation is outside caller scope' using errcode = '42501';
  end if;
  perform public.assert_identity_assurance('workforce_admin');
  if public.current_role() = 'org_admin' then return; end if;
  if public.has_effective_permission(p_permission, 'organization', p_organization_id, now()) then return; end if;
  raise exception 'Required content permission is missing: %', p_permission using errcode = '42501';
end; $$;
revoke all on function app_private.assert_content_permission(uuid,text) from public,anon,authenticated,service_role;

create or replace function public.create_governed_content_revision(
  p_asset_id uuid, p_source_version_id uuid, p_change_summary text,
  p_material_change boolean, p_material_change_action text, p_snapshot jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_asset public.governed_content_assets%rowtype; v_id uuid; v_number integer; v_hash text;
begin
  select * into v_asset from public.governed_content_assets where id = p_asset_id;
  if not found then raise exception 'Governed asset not found' using errcode = 'P0002'; end if;
  perform app_private.assert_content_permission(v_asset.organization_id, 'content.studio.author');
  if v_asset.platform_owned and not public.is_platform_admin() then raise exception 'Platform templates cannot be edited by tenants' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_change_summary,''))) < 5 or jsonb_typeof(p_snapshot) <> 'object' then raise exception 'Change summary and object snapshot are required' using errcode = '22023'; end if;
  select coalesce(max(revision_number),0)+1 into v_number from public.governed_content_revisions where asset_id=p_asset_id;
  v_hash := encode(extensions.digest(convert_to(p_snapshot::text,'utf8'),'sha256'),'hex');
  insert into public.governed_content_revisions(asset_id,organization_id,revision_number,source_version_id,change_summary,material_change,material_change_action,snapshot,snapshot_sha256,authored_by,supersedes_revision_id)
  values(v_asset.id,v_asset.organization_id,v_number,p_source_version_id,btrim(p_change_summary),p_material_change,p_material_change_action,p_snapshot,v_hash,auth.uid(),v_asset.current_published_revision_id)
  returning id into v_id;
  return v_id;
end; $$;

create or replace function public.submit_governed_content_revision(p_revision_id uuid, p_validation_results jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_revision public.governed_content_revisions%rowtype;
begin
  select * into v_revision from public.governed_content_revisions where id=p_revision_id for update;
  if not found then raise exception 'Revision not found' using errcode='P0002'; end if;
  perform app_private.assert_content_permission(v_revision.organization_id,'content.studio.author');
  if v_revision.authored_by <> auth.uid() or v_revision.state not in ('draft','changes_requested') then raise exception 'Only the author may submit an editable revision' using errcode='42501'; end if;
  if jsonb_typeof(p_validation_results) <> 'array' or exists(select 1 from jsonb_array_elements(p_validation_results) e where coalesce(e->>'severity','')='error') then raise exception 'Content validation errors must be resolved before review' using errcode='23514'; end if;
  update public.governed_content_revisions set state='in_review',validation_results=p_validation_results,submitted_at=now() where id=p_revision_id;
  insert into public.governed_content_publication_events(organization_id,asset_id,revision_id,event_type,actor_profile_id,reason) values(v_revision.organization_id,v_revision.asset_id,v_revision.id,'submitted',auth.uid(),'Submitted for independent review');
  return true;
end; $$;

create or replace function public.review_governed_content_revision(p_revision_id uuid,p_decision text,p_reason text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_revision public.governed_content_revisions%rowtype; v_state text;
begin
  select * into v_revision from public.governed_content_revisions where id=p_revision_id for update;
  if not found then raise exception 'Revision not found' using errcode='P0002'; end if;
  perform app_private.assert_content_permission(v_revision.organization_id,'content.studio.review');
  if v_revision.state <> 'in_review' or auth.uid()=v_revision.authored_by or p_decision not in ('approve','request_changes') or length(btrim(coalesce(p_reason,'')))<5 then raise exception 'Independent review decision is invalid' using errcode='42501'; end if;
  v_state := case when p_decision='approve' then 'approved' else 'changes_requested' end;
  update public.governed_content_revisions set state=v_state,reviewed_by=auth.uid(),reviewed_at=now(),review_reason=btrim(p_reason) where id=p_revision_id;
  insert into public.governed_content_publication_events(organization_id,asset_id,revision_id,event_type,actor_profile_id,reason) values(v_revision.organization_id,v_revision.asset_id,v_revision.id,case when p_decision='approve' then 'approved' else 'changes_requested' end,auth.uid(),btrim(p_reason));
  return true;
end; $$;

create or replace function public.publish_governed_content_revision(p_revision_id uuid,p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_revision public.governed_content_revisions%rowtype; v_asset public.governed_content_assets%rowtype; v_prior uuid;
begin
  select * into v_revision from public.governed_content_revisions where id=p_revision_id for update;
  select * into v_asset from public.governed_content_assets where id=v_revision.asset_id for update;
  if not found then raise exception 'Revision not found' using errcode='P0002'; end if;
  perform app_private.assert_content_permission(v_revision.organization_id,'content.studio.publish');
  if v_revision.state <> 'approved' or auth.uid()=v_revision.authored_by or length(btrim(coalesce(p_reason,'')))<5 then raise exception 'Publication requires an approved revision and cannot be performed by its author' using errcode='42501'; end if;
  v_prior := v_asset.current_published_revision_id;
  update public.governed_content_revisions set state='superseded' where id=v_prior and state='published';
  update public.governed_content_revisions set state='published',published_by=auth.uid(),published_at=now() where id=p_revision_id;
  update public.governed_content_assets set current_published_revision_id=p_revision_id,updated_at=now() where id=v_asset.id;
  insert into public.governed_content_publication_events(organization_id,asset_id,revision_id,event_type,actor_profile_id,reason,evidence) values(v_revision.organization_id,v_asset.id,v_revision.id,'published',auth.uid(),btrim(p_reason),jsonb_build_object('priorRevisionId',v_prior,'snapshotSha256',v_revision.snapshot_sha256,'materialChange',v_revision.material_change,'materialChangeAction',v_revision.material_change_action));
  return p_revision_id;
end; $$;

create or replace function app_private.prevent_governed_evidence_mutation()
returns trigger language plpgsql set search_path='' as $$ begin raise exception 'Governed publication evidence is append-only' using errcode='55000'; end; $$;
create trigger prevent_governed_publication_event_mutation before update or delete on public.governed_content_publication_events for each row execute function app_private.prevent_governed_evidence_mutation();
create trigger prevent_policy_delivery_event_mutation before update or delete on public.policy_delivery_events for each row execute function app_private.prevent_governed_evidence_mutation();
create or replace function app_private.lock_published_governed_revision()
returns trigger language plpgsql set search_path='' as $$ begin
  if tg_op='DELETE' and old.state in ('published','superseded','retired') then raise exception 'Published governed revisions are immutable' using errcode='55000'; end if;
  if tg_op='UPDATE' and old.state in ('published','superseded','retired') and (
    new.snapshot is distinct from old.snapshot or new.snapshot_sha256 is distinct from old.snapshot_sha256
    or new.source_version_id is distinct from old.source_version_id or new.authored_by is distinct from old.authored_by
    or new.reviewed_by is distinct from old.reviewed_by or new.published_by is distinct from old.published_by
    or new.state not in ('published','superseded','retired')
  ) then raise exception 'Published governed revisions are immutable' using errcode='55000'; end if;
  return case when tg_op='DELETE' then old else new end;
end; $$;
create trigger lock_published_governed_revision before update or delete on public.governed_content_revisions for each row execute function app_private.lock_published_governed_revision();

do $$ declare t text; begin foreach t in array array['governed_content_assets','governed_content_revisions','governed_content_review_comments','governed_content_publication_events','policy_audience_rules','policy_version_links','policy_delivery_events'] loop execute format('alter table public.%I enable row level security',t); end loop; end $$;

create policy governed_assets_select on public.governed_content_assets for select to authenticated using (platform_owned or (select public.is_platform_admin()) or organization_id=(select public.current_org_id()));
create policy governed_revisions_select on public.governed_content_revisions for select to authenticated using ((select public.is_platform_admin()) or organization_id=(select public.current_org_id()) or organization_id is null and state='published');
create policy governed_comments_select on public.governed_content_review_comments for select to authenticated using ((select public.is_platform_admin()) or organization_id=(select public.current_org_id()));
create policy governed_events_select on public.governed_content_publication_events for select to authenticated using ((select public.is_platform_admin()) or organization_id=(select public.current_org_id()) or organization_id is null);
create policy policy_audience_select on public.policy_audience_rules for select to authenticated using ((select public.is_platform_admin()) or organization_id=(select public.current_org_id()));
create policy policy_links_select on public.policy_version_links for select to authenticated using ((select public.is_platform_admin()) or organization_id=(select public.current_org_id()));
create policy policy_delivery_select on public.policy_delivery_events for select to authenticated using ((select public.is_platform_admin()) or organization_id=(select public.current_org_id()) or employee_id in (select e.id from public.employees e where e.profile_id=(select auth.uid())));

revoke all on table public.governed_content_assets,public.governed_content_revisions,public.governed_content_review_comments,public.governed_content_publication_events,public.policy_audience_rules,public.policy_version_links,public.policy_delivery_events from public,anon,authenticated,service_role;
grant select on table public.governed_content_assets,public.governed_content_revisions,public.governed_content_review_comments,public.governed_content_publication_events,public.policy_audience_rules,public.policy_version_links,public.policy_delivery_events to authenticated;
grant all on table public.governed_content_assets,public.governed_content_revisions,public.governed_content_review_comments,public.governed_content_publication_events,public.policy_audience_rules,public.policy_version_links,public.policy_delivery_events to service_role;

revoke all on function public.create_governed_content_revision(uuid,uuid,text,boolean,text,jsonb),public.submit_governed_content_revision(uuid,jsonb),public.review_governed_content_revision(uuid,text,text),public.publish_governed_content_revision(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.create_governed_content_revision(uuid,uuid,text,boolean,text,jsonb),public.submit_governed_content_revision(uuid,jsonb),public.review_governed_content_revision(uuid,text,text),public.publish_governed_content_revision(uuid,text) to authenticated;

insert into app_private.audit_entity_manifest(table_name,audit_mode,contains_regulated_data,rationale) values
('governed_content_assets','row_trigger',false,'Governed content ownership and lineage'),
('governed_content_revisions','domain_evidence',false,'Immutable approved content snapshots'),
('governed_content_review_comments','row_trigger',false,'Independent review comments'),
('governed_content_publication_events','domain_evidence',false,'Append-only publication decisions'),
('policy_audience_rules','row_trigger',true,'Effective-dated policy audience targeting'),
('policy_version_links','row_trigger',true,'Policy remediation and evidence lineage'),
('policy_delivery_events','domain_evidence',true,'Exact version delivery outcomes')
on conflict(table_name) do update set audit_mode=excluded.audit_mode,contains_regulated_data=excluded.contains_regulated_data,rationale=excluded.rationale,updated_at=now();

do $$ declare t text; begin
  foreach t in array array['governed_content_assets','governed_content_review_comments','policy_audience_rules','policy_version_links'] loop
    execute format('create trigger audit_log after insert or update or delete on public.%I for each row execute function public.audit_log_trigger()',t);
  end loop;
end $$;
