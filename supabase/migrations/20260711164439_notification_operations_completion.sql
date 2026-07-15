-- Phase 1 notification operations completion.
--
-- The provider-evidence migration records attempts and final outcomes. This
-- forward-only layer adds the operational policy that evidence needs:
-- immutable/versioned templates, preview and activation commands, a bounded
-- alternate-channel fallback, configurable estimated-spend alerts, and an
-- administrator read model. Provider message bodies remain outside the
-- evidence ledgers.

-- ---------------------------------------------------------------------------
-- Versioned templates
-- ---------------------------------------------------------------------------

create table public.notification_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  template_key text not null
    check (template_key ~ '^[a-z][a-z0-9_]{1,79}$'),
  channel text not null check (channel in ('email', 'sms')),
  version integer not null check (version > 0),
  status text not null default 'draft'
    check (status in ('draft', 'active', 'retired')),
  subject_template text not null check (length(subject_template) between 1 and 500),
  body_template text not null check (length(body_template) between 1 and 5000),
  allowed_variables text[] not null default '{}'::text[],
  supersedes_id uuid references public.notification_templates(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  activated_by uuid references public.profiles(id) on delete set null,
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (organization_id, template_key, channel, version)
);

create unique index notification_templates_one_active_idx
  on public.notification_templates (
    coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid),
    template_key,
    channel
  ) where status = 'active';
create index notification_templates_scope_idx
  on public.notification_templates (organization_id, template_key, channel, version desc);

create trigger set_updated_at before update on public.notification_templates
for each row execute function public.set_updated_at();

alter table public.notification_templates enable row level security;

create policy notification_templates_select
on public.notification_templates for select to authenticated using (
  (select public.is_platform_admin())
  or (
    (select public.current_role()) = 'org_admin'
    and (
      organization_id = (select public.current_org_id())
      or (organization_id is null and status = 'active')
    )
  )
);

revoke all on table public.notification_templates from anon, authenticated, service_role;
grant select on table public.notification_templates to authenticated, service_role;

create or replace function public.render_notification_template_text(
  p_template text,
  p_allowed_variables text[],
  p_variables jsonb
)
returns text
language plpgsql
immutable
set search_path = pg_catalog
as $function$
declare
  v_result text := p_template;
  v_key text;
begin
  if p_template is null or jsonb_typeof(coalesce(p_variables, '{}'::jsonb)) <> 'object' then
    raise exception 'Template text and an object of preview variables are required'
      using errcode = '22023';
  end if;

  for v_key in select jsonb_object_keys(coalesce(p_variables, '{}'::jsonb)) loop
    if not (v_key = any(coalesce(p_allowed_variables, '{}'::text[]))) then
      raise exception 'Template variable % is not allowed', v_key using errcode = '22023';
    end if;
  end loop;

  foreach v_key in array coalesce(p_allowed_variables, '{}'::text[]) loop
    v_result := replace(v_result, '{{' || v_key || '}}', coalesce(p_variables ->> v_key, ''));
  end loop;

  if v_result like '%{{%' or v_result like '%}}%' then
    raise exception 'Template contains an unknown or malformed placeholder'
      using errcode = '22023';
  end if;
  return v_result;
end;
$function$;

revoke all on function public.render_notification_template_text(text, text[], jsonb)
  from public, anon, authenticated;

create or replace function public.validate_notification_template()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
declare
  v_allowed text[];
  v_examples jsonb;
begin
  select coalesce(array_agg(distinct lower(trim(v)) order by lower(trim(v))), '{}'::text[])
    into v_allowed
  from unnest(coalesce(new.allowed_variables, '{}'::text[])) as vars(v)
  where trim(v) <> '';

  if exists (
    select 1 from unnest(v_allowed) as vars(v)
    where v not in ('title', 'body', 'action_url', 'organization_name')
  ) then
    raise exception 'Unsupported notification template variable'
      using errcode = '22023';
  end if;
  new.allowed_variables := v_allowed;

  select coalesce(jsonb_object_agg(v, 'preview'), '{}'::jsonb)
    into v_examples
  from unnest(v_allowed) as vars(v);

  perform public.render_notification_template_text(new.subject_template, v_allowed, v_examples);
  perform public.render_notification_template_text(new.body_template, v_allowed, v_examples);

  if new.status = 'active' and new.activated_at is null then
    new.activated_at := now();
  end if;
  return new;
end;
$function$;

create trigger validate_notification_template
before insert or update of subject_template, body_template, allowed_variables, status
on public.notification_templates
for each row execute function public.validate_notification_template();

revoke all on function public.validate_notification_template()
  from public, anon, authenticated;

create or replace function public.create_notification_template_version(
  p_organization_id uuid,
  p_template_key text,
  p_channel text,
  p_subject_template text,
  p_body_template text,
  p_allowed_variables text[] default '{}'::text[],
  p_activate boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_id uuid;
  v_version integer;
  v_supersedes uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_organization_id is null then
    if not public.is_platform_admin() then
      raise exception 'Only platform_admin may manage global templates' using errcode = '42501';
    end if;
  elsif not (
    public.is_platform_admin()
    or (
      public.current_role() = 'org_admin'
      and public.current_org_id() = p_organization_id
    )
  ) then
    raise exception 'Template organization is outside the caller scope' using errcode = '42501';
  end if;
  if p_template_key is null or p_channel is null
     or p_channel not in ('email', 'sms')
     or p_template_key !~ '^[a-z][a-z0-9_]{1,79}$' then
    raise exception 'Invalid template key or channel' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    coalesce(p_organization_id::text, 'global') || ':' || p_template_key || ':' || p_channel,
    0
  ));

  select id, version into v_supersedes, v_version
  from public.notification_templates
  where organization_id is not distinct from p_organization_id
    and template_key = p_template_key
    and channel = p_channel
  order by version desc
  limit 1;
  v_version := coalesce(v_version, 0) + 1;

  if p_activate then
    update public.notification_templates
    set status = 'retired'
    where organization_id is not distinct from p_organization_id
      and template_key = p_template_key
      and channel = p_channel
      and status = 'active';
  end if;

  insert into public.notification_templates (
    organization_id, template_key, channel, version, status,
    subject_template, body_template, allowed_variables, supersedes_id,
    created_by, activated_by, activated_at
  ) values (
    p_organization_id, p_template_key, p_channel, v_version,
    case when p_activate then 'active' else 'draft' end,
    p_subject_template, p_body_template, coalesce(p_allowed_variables, '{}'::text[]),
    v_supersedes, auth.uid(), case when p_activate then auth.uid() end,
    case when p_activate then now() end
  ) returning id into v_id;

  return v_id;
end;
$function$;

revoke all on function public.create_notification_template_version(
  uuid, text, text, text, text, text[], boolean
) from public, anon;
grant execute on function public.create_notification_template_version(
  uuid, text, text, text, text, text[], boolean
) to authenticated;

create or replace function public.activate_notification_template(p_template_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_template public.notification_templates%rowtype;
begin
  select * into v_template
  from public.notification_templates
  where id = p_template_id;

  if v_template.id is null then
    raise exception 'Notification template not found' using errcode = 'P0002';
  end if;
  if auth.uid() is null or (
    v_template.organization_id is null and not public.is_platform_admin()
  ) or (
    v_template.organization_id is not null
    and not (
      public.is_platform_admin()
      or (
        public.current_role() = 'org_admin'
        and public.current_org_id() = v_template.organization_id
      )
    )
  ) then
    raise exception 'Template is outside the caller scope' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    coalesce(v_template.organization_id::text, 'global') || ':' ||
      v_template.template_key || ':' || v_template.channel,
    0
  ));

  -- Lock only after serializing activations for this scope. Locking distinct
  -- draft rows first can deadlock when two operators activate concurrently.
  select * into v_template
  from public.notification_templates
  where id = p_template_id
  for update;
  if v_template.id is null or auth.uid() is null or (
    v_template.organization_id is null and not public.is_platform_admin()
  ) or (
    v_template.organization_id is not null
    and not (
      public.is_platform_admin()
      or (
        public.current_role() = 'org_admin'
        and public.current_org_id() = v_template.organization_id
      )
    )
  ) then
    raise exception 'Template no longer exists or is outside the caller scope'
      using errcode = '42501';
  end if;
  update public.notification_templates
  set status = 'retired'
  where organization_id is not distinct from v_template.organization_id
    and template_key = v_template.template_key
    and channel = v_template.channel
    and status = 'active'
    and id <> v_template.id;
  update public.notification_templates
  set status = 'active', activated_by = auth.uid(), activated_at = now()
  where id = v_template.id;
end;
$function$;

revoke all on function public.activate_notification_template(uuid) from public, anon;
grant execute on function public.activate_notification_template(uuid) to authenticated;

create or replace function public.preview_notification_template(
  p_template_id uuid,
  p_variables jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  v_template public.notification_templates%rowtype;
begin
  select * into v_template from public.notification_templates where id = p_template_id;
  if v_template.id is null then
    raise exception 'Notification template not found' using errcode = 'P0002';
  end if;
  if auth.uid() is null or not (
    public.is_platform_admin()
    or (
      public.current_role() = 'org_admin'
      and (
        (v_template.organization_id is null and v_template.status = 'active')
        or v_template.organization_id = public.current_org_id()
      )
    )
  ) then
    raise exception 'Template is outside the caller scope' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'templateId', v_template.id,
    'version', v_template.version,
    'subject', public.render_notification_template_text(
      v_template.subject_template, v_template.allowed_variables, p_variables
    ),
    'body', public.render_notification_template_text(
      v_template.body_template, v_template.allowed_variables, p_variables
    )
  );
end;
$function$;

revoke all on function public.preview_notification_template(uuid, jsonb) from public, anon;
grant execute on function public.preview_notification_template(uuid, jsonb) to authenticated;

create or replace function public.preview_notification_template_draft(
  p_subject_template text,
  p_body_template text,
  p_allowed_variables text[],
  p_variables jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
begin
  if auth.uid() is null or not (
    public.is_platform_admin() or public.current_role() = 'org_admin'
  ) then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if exists (
    select 1 from unnest(coalesce(p_allowed_variables, '{}'::text[])) as vars(v)
    where v not in ('title', 'body', 'action_url', 'organization_name')
  ) then
    raise exception 'Unsupported notification template variable' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'subject', public.render_notification_template_text(
      p_subject_template, coalesce(p_allowed_variables, '{}'::text[]), p_variables
    ),
    'body', public.render_notification_template_text(
      p_body_template, coalesce(p_allowed_variables, '{}'::text[]), p_variables
    )
  );
end;
$function$;

revoke all on function public.preview_notification_template_draft(
  text, text, text[], jsonb
) from public, anon;
grant execute on function public.preview_notification_template_draft(
  text, text, text[], jsonb
) to authenticated;

-- Global defaults deliberately avoid interpolating notification free text.
-- Tenant-specific active versions may use only the allow-listed placeholders.
insert into public.notification_templates (
  organization_id, template_key, channel, version, status,
  subject_template, body_template, allowed_variables, activated_at
) values
  (null, 'default', 'email', 1, 'active',
   'CareMetric CareBase notification',
   'A training or compliance item requires attention. Sign in to CareMetric CareBase to review it securely.',
   '{}'::text[], now()),
  (null, 'default', 'sms', 1, 'active',
   'CareMetric CareBase',
   'A training or compliance item requires attention. Sign in to review it securely.',
   '{}'::text[], now()),
  (null, 'support_ticket_update', 'email', 1, 'active',
   'Your CareMetric CareBase support ticket has an update',
   'Sign in to CareMetric CareBase to review the update securely.',
   '{}'::text[], now()),
  (null, 'resident_compliance_due', 'email', 1, 'active',
   'CareMetric CareBase compliance action required',
   'A compliance item requires attention. Sign in to CareMetric CareBase to review it securely.',
   '{}'::text[], now());

-- ---------------------------------------------------------------------------
-- Preference hierarchy and bounded fallback
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column preferred_notification_channel text not null default 'email'
    check (preferred_notification_channel in ('email', 'sms'));
alter table public.profiles
  add constraint profiles_sms_preference_requires_consent_check check (
    preferred_notification_channel <> 'sms'
    or (
      sms_opt_in
      and sms_consent_at is not null
      and nullif(btrim(phone), '') is not null
    )
  );

create or replace function public.update_profile_contact_preferences(
  p_profile_id uuid,
  p_first_name text,
  p_last_name text,
  p_phone text,
  p_sms_opt_in boolean,
  p_preferred_notification_channel text
)
returns setof public.profiles
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_target public.profiles%rowtype;
  v_phone text := nullif(btrim(p_phone), '');
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  select * into v_target from public.profiles where id = p_profile_id for update;
  if v_target.id is null then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;
  if not (
    auth.uid() = v_target.id
    or public.is_platform_admin()
    or (
      public.current_role() = 'org_admin'
      and public.current_org_id() = v_target.organization_id
    )
    or (
      public.current_role() = 'facility_manager'
      and public.current_org_id() = v_target.organization_id
      and exists (
        select 1 from public.employees e
        where e.profile_id = v_target.id
          and e.organization_id = v_target.organization_id
          and public.is_assigned_to_facility(e.facility_id)
      )
    )
  ) then
    raise exception 'Profile is outside the caller scope' using errcode = '42501';
  end if;
  if nullif(btrim(p_first_name), '') is null
     or nullif(btrim(p_last_name), '') is null
     or p_sms_opt_in is null
     or p_preferred_notification_channel is null
     or p_preferred_notification_channel not in ('email', 'sms')
     or (p_sms_opt_in and v_phone is null)
     or (p_preferred_notification_channel = 'sms' and (not p_sms_opt_in or v_phone is null)) then
    raise exception 'Invalid profile contact or notification preference' using errcode = '22023';
  end if;

  return query
  update public.profiles
  set first_name = btrim(p_first_name),
      last_name = btrim(p_last_name),
      phone = v_phone,
      sms_opt_in = p_sms_opt_in,
      sms_consent_at = case
        when p_sms_opt_in and (
          not v_target.sms_opt_in
          or public.notification_phone_key(v_target.phone)
            is distinct from public.notification_phone_key(v_phone)
        ) then now()
        else v_target.sms_consent_at
      end,
      sms_opt_out_at = case
        when p_sms_opt_in then null
        when v_target.sms_opt_in and not p_sms_opt_in then now()
        else v_target.sms_opt_out_at
      end,
      preferred_notification_channel = p_preferred_notification_channel
  where id = p_profile_id
  returning *;
end;
$function$;
revoke all on function public.update_profile_contact_preferences(
  uuid, text, text, text, boolean, text
) from public, anon;
grant execute on function public.update_profile_contact_preferences(
  uuid, text, text, text, boolean, text
) to authenticated;

create table public.notification_channel_policies (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  fallback_enabled boolean not null default false,
  fallback_delay_minutes integer not null default 15
    check (fallback_delay_minutes between 0 and 1440),
  max_fallback_depth smallint not null default 1
    check (max_fallback_depth between 0 and 2),
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.notification_channel_policies (organization_id)
select id from public.organizations
on conflict (organization_id) do nothing;

create trigger set_updated_at before update on public.notification_channel_policies
for each row execute function public.set_updated_at();
alter table public.notification_channel_policies enable row level security;
create policy notification_channel_policies_select
on public.notification_channel_policies for select to authenticated using (
  (select public.is_platform_admin())
  or (
    organization_id = (select public.current_org_id())
    and (select public.current_role()) = 'org_admin'
  )
);
revoke all on table public.notification_channel_policies from anon, authenticated, service_role;
grant select on table public.notification_channel_policies to authenticated, service_role;

create or replace function public.set_notification_channel_policy(
  p_organization_id uuid,
  p_fallback_enabled boolean,
  p_fallback_delay_minutes integer,
  p_max_fallback_depth integer
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if auth.uid() is null or not (
    public.is_platform_admin()
    or (
      public.current_role() = 'org_admin'
      and public.current_org_id() = p_organization_id
    )
  ) then
    raise exception 'Channel policy organization is outside the caller scope' using errcode = '42501';
  end if;
  if p_organization_id is null
     or p_fallback_enabled is null
     or p_fallback_delay_minutes is null
     or p_max_fallback_depth is null
     or p_fallback_delay_minutes not between 0 and 1440
     or p_max_fallback_depth not between 0 and 2 then
    raise exception 'Invalid notification channel policy' using errcode = '22023';
  end if;

  insert into public.notification_channel_policies (
    organization_id, fallback_enabled, fallback_delay_minutes,
    max_fallback_depth, updated_by
  ) values (
    p_organization_id, p_fallback_enabled, p_fallback_delay_minutes,
    p_max_fallback_depth, auth.uid()
  ) on conflict (organization_id) do update set
    fallback_enabled = excluded.fallback_enabled,
    fallback_delay_minutes = excluded.fallback_delay_minutes,
    max_fallback_depth = excluded.max_fallback_depth,
    updated_by = auth.uid();
end;
$function$;
revoke all on function public.set_notification_channel_policy(uuid, boolean, integer, integer)
  from public, anon;
grant execute on function public.set_notification_channel_policy(uuid, boolean, integer, integer)
  to authenticated;

alter table public.notification_deliveries
  add column template_version_id uuid references public.notification_templates(id) on delete set null,
  add column parent_delivery_id uuid references public.notification_deliveries(id) on delete set null,
  add column fallback_group_id uuid,
  add column fallback_sequence smallint not null default 0
    check (fallback_sequence between 0 and 2),
  add column escalation_reason text;

update public.notification_deliveries set fallback_group_id = id
where fallback_group_id is null;
alter table public.notification_deliveries
  alter column fallback_group_id set default gen_random_uuid(),
  alter column fallback_group_id set not null;

create unique index notification_deliveries_fallback_channel_idx
  on public.notification_deliveries (fallback_group_id, channel);
create index notification_deliveries_template_idx
  on public.notification_deliveries (template_version_id);
create index notification_deliveries_parent_idx
  on public.notification_deliveries (parent_delivery_id)
  where parent_delivery_id is not null;

create or replace function public.assign_notification_delivery_template()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_template_key text;
begin
  if new.template_version_id is not null then
    if not exists (
      select 1 from public.notification_templates t
      where t.id = new.template_version_id
        and t.channel = new.channel
        and (t.organization_id is null or t.organization_id = new.organization_id)
    ) then
      raise exception 'Notification template is outside the delivery scope or channel'
        using errcode = '23514';
    end if;
    return new;
  end if;

  select n.notification_type into v_template_key
  from public.notifications n where n.id = new.notification_id;
  v_template_key := coalesce(v_template_key, new.delivery_type, 'default');

  select t.id into new.template_version_id
  from public.notification_templates t
  where t.status = 'active'
    and t.channel = new.channel
    and (t.organization_id = new.organization_id or t.organization_id is null)
    and t.template_key in (v_template_key, 'default')
  order by
    (t.organization_id is not distinct from new.organization_id) desc,
    (t.template_key = v_template_key) desc,
    t.version desc
  limit 1;
  return new;
end;
$function$;

create trigger assign_notification_delivery_template
before insert on public.notification_deliveries
for each row execute function public.assign_notification_delivery_template();
revoke all on function public.assign_notification_delivery_template()
  from public, anon, authenticated;

update public.notification_deliveries d
set template_version_id = (
  select t.id
  from public.notification_templates t
  left join public.notifications n on n.id = d.notification_id
  where t.status = 'active'
    and t.channel = d.channel
    and (t.organization_id = d.organization_id or t.organization_id is null)
    and t.template_key in (coalesce(n.notification_type, d.delivery_type, 'default'), 'default')
  order by
    (t.organization_id is not distinct from d.organization_id) desc,
    (t.template_key = coalesce(n.notification_type, d.delivery_type, 'default')) desc,
    t.version desc
  limit 1
)
where d.template_version_id is null
  and d.status in ('pending', 'processing');

create or replace function public.enqueue_preferred_notification_delivery(
  p_organization_id uuid,
  p_profile_id uuid,
  p_notification_id uuid,
  p_delivery_type text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_profile public.profiles%rowtype;
  v_settings public.organization_settings%rowtype;
  v_channel text;
  v_recipient text;
  v_delivery_id uuid;
begin
  select * into v_profile from public.profiles
  where id = p_profile_id and organization_id = p_organization_id and is_active;
  select * into v_settings from public.organization_settings
  where organization_id = p_organization_id;
  if v_profile.id is null then return null; end if;

  v_channel := v_profile.preferred_notification_channel;
  if v_channel = 'sms' and not (
    coalesce(v_settings.sms_notifications_enabled, false)
    and v_profile.sms_opt_in and v_profile.sms_consent_at is not null
    and v_profile.phone is not null
  ) then
    v_channel := 'email';
  elsif v_channel = 'email' and not (
    coalesce(v_settings.email_notifications_enabled, false)
    and not v_profile.email_opt_out and v_profile.email is not null
  ) then
    v_channel := 'sms';
  end if;

  if v_channel = 'sms' and (
    not coalesce(v_settings.sms_notifications_enabled, false)
    or not v_profile.sms_opt_in or v_profile.sms_consent_at is null
    or v_profile.phone is null
  ) then return null; end if;
  if v_channel = 'email' and (
    not coalesce(v_settings.email_notifications_enabled, false)
    or v_profile.email_opt_out or v_profile.email is null
  ) then return null; end if;

  v_recipient := case when v_channel = 'sms' then v_profile.phone else v_profile.email end;
  insert into public.notification_deliveries (
    organization_id, profile_id, notification_id, channel, delivery_type, recipient
  ) values (
    p_organization_id, p_profile_id, p_notification_id, v_channel,
    p_delivery_type, v_recipient
  ) returning id into v_delivery_id;
  return v_delivery_id;
end;
$function$;
revoke all on function public.enqueue_preferred_notification_delivery(uuid, uuid, uuid, text)
  from public, anon, authenticated;

create or replace function public.queue_notification_delivery()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if new.notification_type in (
    'training_due_soon', 'training_expired', 'policy_attestation_due_soon',
    'course_continuation_reminder', 'resident_compliance_due', 'support_ticket_update'
  ) then
    perform public.enqueue_preferred_notification_delivery(
      new.organization_id, new.profile_id, new.id, 'alert'
    );
  end if;
  return new;
end;
$function$;
revoke all on function public.queue_notification_delivery()
  from public, anon, authenticated;

-- These jobs historically inserted an allow-listed in-app notification (whose
-- trigger queued email/SMS) and then inserted both provider rows again. Keep
-- one preferred-channel row from the central trigger and relabel that exact
-- notification delivery before the transaction commits.
create or replace function public.escalate_unactioned_alerts()
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_alert record;
  v_admin record;
  v_notification_id uuid;
begin
  for v_alert in
    select a.* from public.alerts a
    where a.status = 'open' and a.escalated_at is null
      and a.alert_type in ('due_7', 'overdue')
      and a.created_at < now() - interval '5 days'
  loop
    for v_admin in
      select p.id as profile_id
      from public.profiles p
      where p.organization_id = v_alert.organization_id
        and p.is_active
        and (
          p.role = 'org_admin'
          or (
            p.role = 'facility_manager'
            and v_alert.facility_id is not null
            and exists (
              select 1 from public.facility_assignments fa
              where fa.profile_id = p.id and fa.facility_id = v_alert.facility_id
            )
          )
        )
    loop
      insert into public.notifications (
        organization_id, profile_id, notification_type, title, body, link
      ) values (
        v_alert.organization_id, v_admin.profile_id, 'training_expired',
        'Unresolved: ' || v_alert.title,
        'This alert has been open for 5+ days without resolution: ' || v_alert.message,
        '/app/alerts'
      ) returning id into v_notification_id;

      update public.notification_deliveries
      set delivery_type = 'escalation'
      where notification_id = v_notification_id;
    end loop;
    update public.alerts set escalated_at = now() where id = v_alert.id;
  end loop;
end;
$function$;
revoke all on function public.escalate_unactioned_alerts()
  from public, anon, authenticated;

create or replace function public.send_monday_digest()
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_admin record;
  v_due_soon integer;
  v_expired integer;
  v_critical_alerts integer;
  v_notification_id uuid;
begin
  for v_admin in
    select p.id as profile_id, p.organization_id, p.role
    from public.profiles p
    where p.role in ('org_admin', 'facility_manager') and p.is_active
  loop
    select count(*) filter (where r.status = 'due_soon'),
           count(*) filter (where r.status = 'expired')
      into v_due_soon, v_expired
    from public.employee_training_records r
    where r.organization_id = v_admin.organization_id
      and (
        v_admin.role = 'org_admin'
        or exists (
          select 1 from public.facility_assignments fa
          where fa.profile_id = v_admin.profile_id and fa.facility_id = r.facility_id
        )
      );

    select count(*) into v_critical_alerts
    from public.alerts a
    where a.organization_id = v_admin.organization_id
      and a.status = 'open' and a.severity = 'critical'
      and (
        v_admin.role = 'org_admin'
        or (
          a.facility_id is not null
          and exists (
            select 1 from public.facility_assignments fa
            where fa.profile_id = v_admin.profile_id and fa.facility_id = a.facility_id
          )
        )
      );

    if v_due_soon = 0 and v_expired = 0 and v_critical_alerts = 0 then continue; end if;

    insert into public.notifications (
      organization_id, profile_id, notification_type, title, body, link
    ) values (
      v_admin.organization_id, v_admin.profile_id, 'training_due_soon',
      'Weekly compliance digest',
      v_expired || ' expired, ' || v_due_soon || ' due soon, ' ||
        v_critical_alerts || ' critical alert(s) open.',
      '/app'
    ) returning id into v_notification_id;

    update public.notification_deliveries
    set delivery_type = 'digest'
    where notification_id = v_notification_id;
  end loop;
end;
$function$;
revoke all on function public.send_monday_digest()
  from public, anon, authenticated;

create or replace function public.enqueue_notification_fallback()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_policy public.notification_channel_policies%rowtype;
  v_profile public.profiles%rowtype;
  v_settings public.organization_settings%rowtype;
  v_channel text;
  v_recipient text;
begin
  if new.status <> 'failed' or new.final_outcome <> 'failed'
     or (
       old.status is not distinct from new.status
       and old.final_outcome is not distinct from new.final_outcome
     ) then
    return new;
  end if;

  select * into v_policy from public.notification_channel_policies
  where organization_id = new.organization_id;
  if not coalesce(v_policy.fallback_enabled, false)
     or new.fallback_sequence >= coalesce(v_policy.max_fallback_depth, 1) then
    return new;
  end if;

  v_channel := case when new.channel = 'email' then 'sms' else 'email' end;
  select * into v_profile from public.profiles
  where id = new.profile_id and organization_id = new.organization_id and is_active;
  select * into v_settings from public.organization_settings
  where organization_id = new.organization_id;
  if v_profile.id is null then return new; end if;

  if v_channel = 'sms' then
    if not (
      coalesce(v_settings.sms_notifications_enabled, false)
      and v_profile.sms_opt_in and v_profile.sms_consent_at is not null
      and v_profile.phone is not null
    ) then return new; end if;
    v_recipient := v_profile.phone;
  else
    if not (
      coalesce(v_settings.email_notifications_enabled, false)
      and not v_profile.email_opt_out and v_profile.email is not null
    ) then return new; end if;
    v_recipient := v_profile.email;
  end if;

  -- Do not duplicate a channel that was already fanned out for the same source.
  if exists (
    select 1 from public.notification_deliveries d
    where d.organization_id = new.organization_id
      and d.profile_id = new.profile_id
      and d.channel = v_channel
      and d.delivery_type = new.delivery_type
      and (
        d.fallback_group_id = new.fallback_group_id
        or (new.notification_id is not null and d.notification_id = new.notification_id)
        or (
          new.notification_id is null and d.notification_id is null
          and d.created_at between new.created_at - interval '1 minute'
                               and new.created_at + interval '1 minute'
        )
      )
  ) then return new; end if;

  insert into public.notification_deliveries (
    organization_id, profile_id, notification_id, channel, delivery_type,
    recipient, status, next_attempt_at, parent_delivery_id, fallback_group_id,
    fallback_sequence, escalation_reason
  ) values (
    new.organization_id, new.profile_id, new.notification_id, v_channel,
    new.delivery_type, v_recipient, 'pending',
    now() + make_interval(mins => coalesce(v_policy.fallback_delay_minutes, 15)),
    new.id, new.fallback_group_id, new.fallback_sequence + 1,
    'alternate_channel_after_permanent_failure'
  );
  return new;
end;
$function$;

create trigger enqueue_notification_fallback
after update of status, final_outcome on public.notification_deliveries
for each row execute function public.enqueue_notification_fallback();
revoke all on function public.enqueue_notification_fallback()
  from public, anon, authenticated;

-- SendGrid unsubscribe and suppression events apply to the normalized address,
-- not only to the profile attached to one delivery attempt. The raw address is
-- used only inside this command for matching; the append-only consent ledger
-- continues to retain only its keyed fingerprint.
create or replace function public.record_notification_consent_event(
  p_channel text,
  p_action text,
  p_provider text,
  p_provider_event_id text,
  p_recipient_fingerprint text,
  p_occurred_at timestamptz,
  p_source text,
  p_attempt_id uuid default null,
  p_recipient text default null
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_profile_id uuid;
  v_organization_id uuid;
  v_attempt_channel text;
  v_attempt_recipient text;
  v_event_id uuid;
  v_changed integer := 0;
  v_match_count integer := 0;
  v_recipient_email text := lower(btrim(p_recipient));
begin
  if p_channel is null or p_channel not in ('email', 'sms')
     or p_action is null or p_action not in ('opt_in', 'opt_out', 'help')
     or p_provider is null or p_provider not in ('twilio', 'sendgrid')
     or nullif(btrim(p_provider_event_id), '') is null
     or length(p_provider_event_id) > 512
     or nullif(btrim(p_source), '') is null
     or p_recipient_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid notification consent event' using errcode = '22023';
  end if;
  if p_channel = 'email' and p_recipient is not null
     and (v_recipient_email = '' or position('@' in v_recipient_email) <= 1) then
    raise exception 'Invalid email consent recipient' using errcode = '22023';
  end if;

  if p_attempt_id is not null then
    select d.profile_id, d.organization_id, d.channel, d.recipient
      into v_profile_id, v_organization_id, v_attempt_channel, v_attempt_recipient
    from public.notification_delivery_attempts a
    join public.notification_deliveries d on d.id = a.delivery_id
    where a.id = p_attempt_id;
    if v_profile_id is null or v_attempt_channel <> p_channel then
      raise exception 'Consent event attempt does not match the channel' using errcode = '22023';
    end if;
    if p_channel = 'email' and p_recipient is not null
       and lower(btrim(v_attempt_recipient)) <> v_recipient_email then
      raise exception 'Consent event recipient does not match the delivery attempt'
        using errcode = '22023';
    end if;
    if p_channel = 'sms' and p_recipient is not null
       and public.notification_phone_key(v_attempt_recipient)
         <> public.notification_phone_key(p_recipient) then
      raise exception 'Consent event recipient does not match the delivery attempt'
        using errcode = '22023';
    end if;
  elsif p_channel = 'sms' and p_recipient is not null then
    select count(*)::integer into v_match_count from public.profiles
    where public.notification_phone_key(phone) = public.notification_phone_key(p_recipient)
      and is_active;
    if v_match_count = 1 then
      select id, organization_id into v_profile_id, v_organization_id
      from public.profiles
      where public.notification_phone_key(phone) = public.notification_phone_key(p_recipient)
        and is_active;
    end if;
  elsif p_channel = 'email' and p_recipient is not null then
    select count(*)::integer into v_match_count from public.profiles
    where lower(btrim(email)) = v_recipient_email and is_active;
    if v_match_count = 1 then
      select id, organization_id into v_profile_id, v_organization_id
      from public.profiles
      where lower(btrim(email)) = v_recipient_email and is_active;
    end if;
  end if;

  insert into public.notification_consent_events (
    organization_id, profile_id, attempt_id, channel, action, provider,
    provider_event_id, recipient_fingerprint, source, occurred_at
  ) values (
    v_organization_id, v_profile_id, p_attempt_id, p_channel, p_action, p_provider,
    p_provider_event_id, p_recipient_fingerprint, left(p_source, 100),
    coalesce(p_occurred_at, now())
  )
  on conflict (provider, provider_event_id) do nothing
  returning id into v_event_id;

  if v_event_id is null or p_action = 'help' then return 0; end if;

  -- Provider callbacks can be delivered out of order. Preserve every signed
  -- event, but only the latest provider occurrence may change preference state.
  if exists (
    select 1
    from public.notification_consent_events e
    where e.id <> v_event_id
      and e.channel = p_channel
      and e.recipient_fingerprint = p_recipient_fingerprint
      and e.action in ('opt_in', 'opt_out')
      and (
        e.occurred_at > coalesce(p_occurred_at, now())
        or (
          e.occurred_at = coalesce(p_occurred_at, now())
          and e.received_at > (
            select current_event.received_at
            from public.notification_consent_events current_event
            where current_event.id = v_event_id
          )
        )
      )
  ) then
    return 0;
  end if;

  if p_channel = 'sms' then
    update public.profiles
    set sms_opt_in = (p_action = 'opt_in'),
        sms_consent_at = case
          when p_action = 'opt_in' then coalesce(p_occurred_at, now())
          else sms_consent_at
        end,
        sms_opt_out_at = case
          when p_action = 'opt_out' then coalesce(p_occurred_at, now())
          else null
        end
    where (
      p_recipient is not null
      and public.notification_phone_key(phone) = public.notification_phone_key(p_recipient)
    ) or (p_recipient is null and id = v_profile_id);
  else
    update public.profiles
    set email_opt_out = (p_action = 'opt_out'),
        email_opt_out_at = case
          when p_action = 'opt_out' then coalesce(p_occurred_at, now())
          else null
        end
    where (
      p_recipient is not null and lower(btrim(email)) = v_recipient_email
    ) or (p_recipient is null and id = v_profile_id);
  end if;
  get diagnostics v_changed = row_count;

  if p_action = 'opt_out' then
    update public.notification_deliveries
    set status = 'skipped', skip_reason = upper(p_channel) || ' recipient opted out',
        finalized_at = now()
    where channel = p_channel
      and status in ('pending', 'processing')
      and (
        profile_id = v_profile_id
        or (
          p_channel = 'sms' and p_recipient is not null
          and public.notification_phone_key(recipient) = public.notification_phone_key(p_recipient)
        )
        or (
          p_channel = 'email' and p_recipient is not null
          and lower(btrim(recipient)) = v_recipient_email
        )
      );
  end if;
  return v_changed;
end;
$function$;
revoke all on function public.record_notification_consent_event(
  text, text, text, text, text, timestamptz, text, uuid, text
) from public, anon, authenticated;
grant execute on function public.record_notification_consent_event(
  text, text, text, text, text, timestamptz, text, uuid, text
) to service_role;

-- Delivery proof is monotonic: a delivered/read event from any attempt wins
-- over failed, unknown, or progress evidence and cannot later be downgraded.
-- Every valid callback still lands in the immutable provider-event ledger.
create or replace function public.record_notification_provider_event(
  p_provider text,
  p_provider_event_id text,
  p_attempt_id uuid,
  p_provider_message_id text,
  p_event_type text,
  p_outcome text,
  p_error_code text,
  p_error_detail text,
  p_occurred_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_attempt public.notification_delivery_attempts%rowtype;
  v_delivery public.notification_deliveries%rowtype;
  v_event_id uuid;
  v_event_time timestamptz := coalesce(p_occurred_at, now());
begin
  if p_provider is null or p_provider not in ('twilio', 'sendgrid')
     or nullif(btrim(p_provider_event_id), '') is null
     or length(p_provider_event_id) > 512
     or nullif(btrim(p_event_type), '') is null
     or (p_outcome is not null and p_outcome not in ('delivered', 'failed')) then
    raise exception 'Invalid provider event' using errcode = '22023';
  end if;

  select * into v_attempt
  from public.notification_delivery_attempts
  where id = p_attempt_id
  for update;
  if v_attempt.id is null or v_attempt.provider <> p_provider then return false; end if;

  select * into v_delivery
  from public.notification_deliveries
  where id = v_attempt.delivery_id
  for update;

  insert into public.notification_provider_events (
    attempt_id, delivery_id, organization_id, provider, provider_event_id,
    provider_message_id, event_type, outcome, error_code, error_detail, occurred_at
  ) values (
    v_attempt.id, v_delivery.id, v_delivery.organization_id, p_provider,
    p_provider_event_id, nullif(left(p_provider_message_id, 255), ''),
    left(p_event_type, 100), p_outcome, nullif(left(p_error_code, 100), ''),
    nullif(left(p_error_detail, 500), ''), v_event_time
  ) on conflict (provider, provider_event_id) do nothing
  returning id into v_event_id;
  if v_event_id is null then return false; end if;

  if p_outcome = 'delivered' then
    update public.notification_delivery_attempts
    set provider_message_id = coalesce(provider_message_id, nullif(p_provider_message_id, '')),
        provider_status = left(p_event_type, 100),
        status = 'delivered',
        error_code = null,
        error_detail = null,
        finalized_at = v_event_time
    where id = v_attempt.id;
  elsif p_outcome = 'failed' then
    update public.notification_delivery_attempts
    set provider_message_id = coalesce(provider_message_id, nullif(p_provider_message_id, '')),
        provider_status = left(p_event_type, 100),
        status = 'failed',
        error_code = nullif(left(p_error_code, 100), ''),
        error_detail = nullif(left(p_error_detail, 500), ''),
        finalized_at = v_event_time
    where id = v_attempt.id
      and status <> 'delivered'
      and (
        status = 'unknown' or finalized_at is null or v_event_time >= finalized_at
      );
  else
    update public.notification_delivery_attempts
    set provider_message_id = coalesce(provider_message_id, nullif(p_provider_message_id, '')),
        provider_status = left(p_event_type, 100)
    where id = v_attempt.id and finalized_at is null;
  end if;

  -- Positive proof from an earlier attempt still completes the aggregate
  -- delivery. Failures and progress may affect only the current attempt.
  if p_outcome = 'delivered' then
    update public.notification_deliveries
    set provider_message_id = coalesce(provider_message_id, nullif(p_provider_message_id, '')),
        last_provider_status = left(p_event_type, 100),
        status = 'delivered',
        final_outcome = 'delivered',
        finalized_at = v_event_time,
        delivered_at = coalesce(delivered_at, v_event_time),
        error_code = null,
        error_message = null
    where id = v_delivery.id;
  elsif v_attempt.attempt_number = v_delivery.attempt_count
        and p_outcome = 'failed'
        and v_delivery.final_outcome is distinct from 'delivered'
        and (
          v_delivery.final_outcome = 'unknown'
          or v_delivery.finalized_at is null
          or v_event_time >= v_delivery.finalized_at
        ) then
    update public.notification_deliveries
    set provider_message_id = coalesce(provider_message_id, nullif(p_provider_message_id, '')),
        last_provider_status = left(p_event_type, 100),
        status = 'failed',
        final_outcome = 'failed',
        finalized_at = v_event_time,
        error_code = nullif(left(p_error_code, 100), ''),
        error_message = nullif(left(p_error_detail, 500), '')
    where id = v_delivery.id;
  elsif v_attempt.attempt_number = v_delivery.attempt_count
        and p_outcome is null
        and v_delivery.finalized_at is null then
    update public.notification_deliveries
    set provider_message_id = coalesce(provider_message_id, nullif(p_provider_message_id, '')),
        last_provider_status = left(p_event_type, 100)
    where id = v_delivery.id;
  end if;
  return true;
end;
$function$;
revoke all on function public.record_notification_provider_event(
  text, text, uuid, text, text, text, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.record_notification_provider_event(
  text, text, uuid, text, text, text, text, text, timestamptz
) to service_role;

create or replace function public.cancel_unsent_notification_fallbacks()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if new.final_outcome = 'delivered'
     and old.final_outcome is distinct from new.final_outcome then
    update public.notification_deliveries d
    set status = 'skipped',
        skip_reason = 'Earlier delivery attempt was confirmed delivered',
        finalized_at = now()
    where d.fallback_group_id = new.fallback_group_id
      and d.id <> new.id
      and d.fallback_sequence > new.fallback_sequence
      and (
        d.status = 'pending'
        or (
          d.status = 'processing'
          and not exists (
            select 1 from public.notification_delivery_attempts a
            where a.delivery_id = d.id
          )
        )
      );
  end if;
  return new;
end;
$function$;
create trigger cancel_unsent_notification_fallbacks
after update of final_outcome on public.notification_deliveries
for each row execute function public.cancel_unsent_notification_fallbacks();
revoke all on function public.cancel_unsent_notification_fallbacks()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Estimated provider spend and alerts
-- ---------------------------------------------------------------------------

create table public.notification_spend_policies (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  currency text not null default 'USD' check (currency = 'USD'),
  monthly_budget_micros bigint check (monthly_budget_micros is null or monthly_budget_micros > 0),
  warning_percent smallint not null default 80 check (warning_percent between 1 and 99),
  email_estimate_micros bigint not null default 0 check (email_estimate_micros >= 0),
  sms_estimate_micros bigint not null default 0 check (sms_estimate_micros >= 0),
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger set_updated_at before update on public.notification_spend_policies
for each row execute function public.set_updated_at();

create table public.notification_spend_alerts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  period_start date not null,
  threshold_percent smallint not null check (threshold_percent between 1 and 100),
  estimated_spend_micros bigint not null check (estimated_spend_micros >= 0),
  budget_micros bigint not null check (budget_micros > 0),
  status text not null default 'open' check (status in ('open', 'acknowledged')),
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid references public.profiles(id) on delete set null,
  unique (organization_id, period_start, threshold_percent)
);
create index notification_spend_alerts_open_idx
  on public.notification_spend_alerts (created_at desc) where status = 'open';

alter table public.notification_spend_policies enable row level security;
alter table public.notification_spend_alerts enable row level security;
create policy notification_spend_policies_select
on public.notification_spend_policies for select to authenticated using (
  (select public.is_platform_admin())
  or (
    organization_id = (select public.current_org_id())
    and (select public.current_role()) = 'org_admin'
  )
);
create policy notification_spend_alerts_select
on public.notification_spend_alerts for select to authenticated using (
  (select public.is_platform_admin())
  or (
    organization_id = (select public.current_org_id())
    and (select public.current_role()) = 'org_admin'
  )
);
revoke all on table public.notification_spend_policies from anon, authenticated, service_role;
revoke all on table public.notification_spend_alerts from anon, authenticated, service_role;
grant select on table public.notification_spend_policies to authenticated, service_role;
grant select on table public.notification_spend_alerts to authenticated, service_role;

alter table public.notification_delivery_attempts
  add column estimated_cost_micros bigint not null default 0
    check (estimated_cost_micros >= 0);

create or replace function public.estimate_notification_attempt_cost()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_channel text;
begin
  select d.channel into v_channel from public.notification_deliveries d
  where d.id = new.delivery_id;
  select case v_channel
      when 'sms' then p.sms_estimate_micros
      else p.email_estimate_micros
    end
    into new.estimated_cost_micros
  from public.notification_spend_policies p
  where p.organization_id = new.organization_id;
  new.estimated_cost_micros := coalesce(new.estimated_cost_micros, 0);
  return new;
end;
$function$;
create trigger estimate_notification_attempt_cost
before insert on public.notification_delivery_attempts
for each row execute function public.estimate_notification_attempt_cost();
revoke all on function public.estimate_notification_attempt_cost()
  from public, anon, authenticated;

create or replace function public.raise_notification_spend_alerts()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_policy public.notification_spend_policies%rowtype;
  v_period date := date_trunc('month', new.started_at at time zone 'UTC')::date;
  v_spend bigint;
  v_threshold smallint;
begin
  select * into v_policy from public.notification_spend_policies
  where organization_id = new.organization_id;
  if v_policy.monthly_budget_micros is null then return new; end if;

  select coalesce(sum(a.estimated_cost_micros), 0)::bigint into v_spend
  from public.notification_delivery_attempts a
  where a.organization_id = new.organization_id
    and a.started_at >= (v_period::timestamp at time zone 'UTC')
    and a.started_at < ((v_period::timestamp + interval '1 month') at time zone 'UTC');

  foreach v_threshold in array array[v_policy.warning_percent, 100::smallint] loop
    if v_spend::numeric * 100
       >= v_policy.monthly_budget_micros::numeric * v_threshold::numeric then
      insert into public.notification_spend_alerts (
        organization_id, period_start, threshold_percent,
        estimated_spend_micros, budget_micros
      ) values (
        new.organization_id, v_period, v_threshold, v_spend,
        v_policy.monthly_budget_micros
      ) on conflict (organization_id, period_start, threshold_percent) do update
        set estimated_spend_micros = greatest(
          public.notification_spend_alerts.estimated_spend_micros,
          excluded.estimated_spend_micros
        );
    end if;
  end loop;
  return new;
end;
$function$;
create trigger raise_notification_spend_alerts
after insert on public.notification_delivery_attempts
for each row execute function public.raise_notification_spend_alerts();
revoke all on function public.raise_notification_spend_alerts()
  from public, anon, authenticated;

create or replace function public.set_notification_spend_policy(
  p_organization_id uuid,
  p_monthly_budget_usd numeric,
  p_email_estimate_usd numeric,
  p_sms_estimate_usd numeric,
  p_warning_percent integer default 80
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if auth.uid() is null or not (
    public.is_platform_admin()
    or (
      public.current_role() = 'org_admin'
      and public.current_org_id() = p_organization_id
    )
  ) then
    raise exception 'Spend policy organization is outside the caller scope' using errcode = '42501';
  end if;
  if p_organization_id is null
     or p_email_estimate_usd is null or p_sms_estimate_usd is null
     or (p_monthly_budget_usd is not null and p_monthly_budget_usd <= 0)
     or p_email_estimate_usd < 0 or p_sms_estimate_usd < 0
     or p_warning_percent not between 1 and 99 then
    raise exception 'Invalid notification spend policy' using errcode = '22023';
  end if;

  insert into public.notification_spend_policies (
    organization_id, monthly_budget_micros, email_estimate_micros,
    sms_estimate_micros, warning_percent, updated_by
  ) values (
    p_organization_id,
    case when p_monthly_budget_usd is null then null
      else round(p_monthly_budget_usd * 1000000)::bigint end,
    round(p_email_estimate_usd * 1000000)::bigint,
    round(p_sms_estimate_usd * 1000000)::bigint,
    p_warning_percent, auth.uid()
  ) on conflict (organization_id) do update set
    monthly_budget_micros = excluded.monthly_budget_micros,
    email_estimate_micros = excluded.email_estimate_micros,
    sms_estimate_micros = excluded.sms_estimate_micros,
    warning_percent = excluded.warning_percent,
    updated_by = auth.uid();
end;
$function$;
revoke all on function public.set_notification_spend_policy(uuid, numeric, numeric, numeric, integer)
  from public, anon;
grant execute on function public.set_notification_spend_policy(uuid, numeric, numeric, numeric, integer)
  to authenticated;

create or replace function public.acknowledge_notification_spend_alert(p_alert_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_organization_id uuid;
begin
  select organization_id into v_organization_id
  from public.notification_spend_alerts where id = p_alert_id;
  if v_organization_id is null then
    raise exception 'Notification spend alert not found' using errcode = 'P0002';
  end if;
  if auth.uid() is null or not (
    public.is_platform_admin()
    or (
      public.current_role() = 'org_admin'
      and public.current_org_id() = v_organization_id
    )
  ) then
    raise exception 'Spend alert is outside the caller scope' using errcode = '42501';
  end if;
  update public.notification_spend_alerts
  set status = 'acknowledged', acknowledged_at = now(), acknowledged_by = auth.uid()
  where id = p_alert_id and status = 'open';
end;
$function$;
revoke all on function public.acknowledge_notification_spend_alert(uuid) from public, anon;
grant execute on function public.acknowledge_notification_spend_alert(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Administrator delivery evidence read models
-- ---------------------------------------------------------------------------

create or replace function public.get_notification_delivery_operations(
  p_organization_id uuid default null,
  p_hours integer default 24
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  v_scope uuid := p_organization_id;
  v_since timestamptz;
begin
  if auth.uid() is null or p_hours not between 1 and 744 then
    raise exception 'Invalid notification operations request' using errcode = '22023';
  end if;
  if not public.is_platform_admin() then
    if public.current_role() <> 'org_admin' then
      raise exception 'Administrator access required' using errcode = '42501';
    end if;
    if p_organization_id is not null and p_organization_id <> public.current_org_id() then
      raise exception 'Organization is outside the caller scope' using errcode = '42501';
    end if;
    v_scope := public.current_org_id();
  end if;
  v_since := now() - make_interval(hours => p_hours);

  return jsonb_build_object(
    'summary', (
      select jsonb_build_object(
        'pending', count(*) filter (where d.status = 'pending'),
        'processing', count(*) filter (where d.status = 'processing'),
        'awaitingFinal', count(*) filter (where d.status in ('sent', 'accepted')),
        'delivered', count(*) filter (
          where d.final_outcome = 'delivered' and d.finalized_at >= v_since
        ),
        'failed', count(*) filter (
          where d.final_outcome = 'failed' and d.finalized_at >= v_since
        ),
        'unknown', count(*) filter (where d.final_outcome = 'unknown'),
        'fallbacks', count(*) filter (
          where d.parent_delivery_id is not null and d.created_at >= v_since
        ),
        'fallbackDelivered', count(*) filter (
          where d.parent_delivery_id is not null and d.final_outcome = 'delivered'
            and d.finalized_at >= v_since
        )
      )
      from public.notification_deliveries d
      where v_scope is null or d.organization_id = v_scope
    ),
    'spend', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'organizationId', q.organization_id,
        'organizationName', q.organization_name,
        'estimatedSpendMicros', q.estimated_spend_micros,
        'budgetMicros', q.monthly_budget_micros,
        'warningPercent', q.warning_percent
      ) order by q.estimated_spend_micros desc), '[]'::jsonb)
      from (
        select o.id organization_id, o.name organization_name,
          coalesce(sum(a.estimated_cost_micros), 0)::bigint estimated_spend_micros,
          p.monthly_budget_micros, p.warning_percent
        from public.organizations o
        left join public.notification_spend_policies p on p.organization_id = o.id
        left join public.notification_delivery_attempts a
          on a.organization_id = o.id
           and a.started_at >= (
             date_trunc('month', now() at time zone 'UTC') at time zone 'UTC'
           )
        where v_scope is null or o.id = v_scope
        group by o.id, o.name, p.monthly_budget_micros, p.warning_percent
      ) q
    ),
    'spendAlerts', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', a.id,
        'organizationId', a.organization_id,
        'organizationName', o.name,
        'thresholdPercent', a.threshold_percent,
        'estimatedSpendMicros', a.estimated_spend_micros,
        'budgetMicros', a.budget_micros,
        'createdAt', a.created_at
      ) order by a.created_at desc), '[]'::jsonb)
      from public.notification_spend_alerts a
      join public.organizations o on o.id = a.organization_id
      where a.status = 'open'
        and (v_scope is null or a.organization_id = v_scope)
    ),
    'policies', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'organizationId', o.id,
        'fallbackEnabled', coalesce(c.fallback_enabled, false),
        'fallbackDelayMinutes', coalesce(c.fallback_delay_minutes, 15),
        'maxFallbackDepth', coalesce(c.max_fallback_depth, 1),
        'monthlyBudgetMicros', s.monthly_budget_micros,
        'warningPercent', coalesce(s.warning_percent, 80),
        'emailEstimateMicros', coalesce(s.email_estimate_micros, 0),
        'smsEstimateMicros', coalesce(s.sms_estimate_micros, 0)
      ) order by o.name), '[]'::jsonb)
      from public.organizations o
      left join public.notification_channel_policies c on c.organization_id = o.id
      left join public.notification_spend_policies s on s.organization_id = o.id
      where v_scope is null or o.id = v_scope
    ),
    'templates', (
      select jsonb_build_object(
        'active', count(*) filter (where t.status = 'active'),
        'draft', count(*) filter (where t.status = 'draft'),
        'retired', count(*) filter (where t.status = 'retired')
      )
      from public.notification_templates t
      where (
        public.is_platform_admin()
        and (v_scope is null or t.organization_id is null or t.organization_id = v_scope)
      ) or (
        not public.is_platform_admin()
        and (
          (t.organization_id is null and t.status = 'active')
          or t.organization_id = v_scope
        )
      )
    )
  );
end;
$function$;
revoke all on function public.get_notification_delivery_operations(uuid, integer)
  from public, anon;
grant execute on function public.get_notification_delivery_operations(uuid, integer)
  to authenticated;

create or replace function public.get_notification_template_library(
  p_organization_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  v_scope uuid := p_organization_id;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not public.is_platform_admin() then
    if public.current_role() <> 'org_admin' then
      raise exception 'Administrator access required' using errcode = '42501';
    end if;
    if p_organization_id is not null and p_organization_id <> public.current_org_id() then
      raise exception 'Organization is outside the caller scope' using errcode = '42501';
    end if;
    v_scope := public.current_org_id();
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', t.id,
      'organizationId', t.organization_id,
      'templateKey', t.template_key,
      'channel', t.channel,
      'version', t.version,
      'status', t.status,
      'subjectTemplate', t.subject_template,
      'bodyTemplate', t.body_template,
      'allowedVariables', to_jsonb(t.allowed_variables),
      'activatedAt', t.activated_at,
      'createdAt', t.created_at
    ) order by t.template_key, t.channel, t.version desc)
    from public.notification_templates t
    where (
      public.is_platform_admin()
      and (v_scope is null or t.organization_id is null or t.organization_id = v_scope)
    ) or (
      not public.is_platform_admin()
      and (
        (t.organization_id is null and t.status = 'active')
        or t.organization_id = v_scope
      )
    )
  ), '[]'::jsonb);
end;
$function$;
revoke all on function public.get_notification_template_library(uuid) from public, anon;
grant execute on function public.get_notification_template_library(uuid) to authenticated;

create or replace function public.get_notification_delivery_evidence(p_delivery_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  v_delivery public.notification_deliveries%rowtype;
begin
  select * into v_delivery from public.notification_deliveries where id = p_delivery_id;
  if v_delivery.id is null then
    raise exception 'Notification delivery not found' using errcode = 'P0002';
  end if;
  if auth.uid() is null or not (
    public.is_platform_admin()
    or (
      public.current_role() = 'org_admin'
      and public.current_org_id() = v_delivery.organization_id
    )
    or (
      public.current_role() = 'facility_manager'
      and public.current_org_id() = v_delivery.organization_id
      and exists (
        select 1 from public.employees e
        where e.profile_id = v_delivery.profile_id
          and e.organization_id = v_delivery.organization_id
          and public.is_assigned_to_facility(e.facility_id)
      )
    )
  ) then
    raise exception 'Delivery is outside the caller scope' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'delivery', to_jsonb(v_delivery),
    'template', (
      select jsonb_build_object(
        'id', t.id, 'key', t.template_key, 'channel', t.channel,
        'version', t.version, 'status', t.status
      ) from public.notification_templates t where t.id = v_delivery.template_version_id
    ),
    'attempts', (
      select coalesce(jsonb_agg(to_jsonb(a) order by a.attempt_number), '[]'::jsonb)
      from public.notification_delivery_attempts a where a.delivery_id = v_delivery.id
    ),
    'events', (
      select coalesce(jsonb_agg(to_jsonb(e) order by e.occurred_at), '[]'::jsonb)
      from public.notification_provider_events e where e.delivery_id = v_delivery.id
    )
  );
end;
$function$;
revoke all on function public.get_notification_delivery_evidence(uuid) from public, anon;
grant execute on function public.get_notification_delivery_evidence(uuid) to authenticated;

-- Register the mutable policy/configuration rows with the shared audit system.
insert into app_private.audit_entity_manifest (
  table_name, audit_mode, contains_regulated_data, rationale
) values
  ('notification_templates', 'row_trigger', false,
   'Versioned provider copy and activation changes require administrator evidence'),
  ('notification_channel_policies', 'row_trigger', false,
   'Alternate-channel escalation controls affect delivery behavior'),
  ('notification_spend_policies', 'row_trigger', false,
   'Provider cost estimates and budget thresholds affect operational alerts'),
  ('notification_spend_alerts', 'row_trigger', false,
   'Spend threshold detection and acknowledgement are operator evidence')
on conflict (table_name) do update set
  audit_mode = excluded.audit_mode,
  contains_regulated_data = excluded.contains_regulated_data,
  rationale = excluded.rationale,
  updated_at = now();

create trigger audit_log after insert or update or delete on public.notification_templates
for each row execute function public.audit_log_trigger();
create trigger audit_log after insert or update or delete on public.notification_channel_policies
for each row execute function public.audit_log_trigger();
create trigger audit_log after insert or update or delete on public.notification_spend_policies
for each row execute function public.audit_log_trigger();
create trigger audit_log after insert or update or delete on public.notification_spend_alerts
for each row execute function public.audit_log_trigger();
