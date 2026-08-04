-- Governed content: the publication control could not be entered (BACKLOG.md G10).
--
-- WHAT WAS ACTUALLY WRONG. `20260712023821` shipped a four-step publication control over course
-- content: `create_governed_content_revision` authors a snapshot, `submit_` sends it for review,
-- `review_` approves or returns it, `publish_` releases it -- with separation of duties enforced at
-- every step, an immutable snapshot hash, and append-only publication evidence.
--
-- Exactly one of the four had a caller. `GovernedLearning.tsx` dispatched `review_` and nothing
-- else, against a revision ID typed into a text box. So the page reviewed revisions that nothing
-- could create, and an approved revision could never be published. Three of the four steps were
-- reachable only from pgTAP.
--
-- Wiring the three RPCs to buttons is most of the fix, and it is a client change. This migration
-- exists because that alone would not have worked: `governed_content_assets` -- the row every
-- revision hangs off -- has `grant select` to `authenticated` and nothing more. No INSERT grant, no
-- RLS write policy, no RPC. In production the table is empty for every tenant and there is no way
-- to put a row in it, so `create_governed_content_revision` would raise 'Governed asset not found'
-- for every course in the system. Same shape as G8: not a dead end, a missing beginning.
--
-- WHY REGISTRATION IS IDEMPOTENT. Bringing a course under governance is a statement about the
-- course, not an event -- "this content is governed" is either true or it is not. The unique
-- constraint `(organization_id, asset_type, source_id)` already says so. Registering a course that
-- is already registered therefore returns the existing asset rather than raising: a second author
-- clicking the same button is not an error, and forcing the client to distinguish "already governed"
-- from "failed" would invite it to swallow real failures alongside.
--
-- WHY ONLY `course`. `asset_type` allows five values, but only two source tables exist to resolve an
-- organization from, and only courses have an authoring surface that can produce a snapshot. Rather
-- than accept an asset type whose revisions could never be authored, the unsupported types are
-- refused by name. Adding one later is a `when` branch, not a redesign.
--
-- Rollback: drop the function. No schema changes, no data changes.

create or replace function public.register_governed_content_asset(
  p_asset_type text,
  p_source_id uuid,
  p_title text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid;
  v_title text;
  v_asset_id uuid;
begin
  if p_asset_type is null or p_asset_type <> 'course' then
    raise exception 'Only course content can be brought under governance today (asked for %)',
      coalesce(p_asset_type, 'null')
      using errcode = '22023';
  end if;

  select c.organization_id, c.title into v_organization_id, v_title
  from public.courses c
  where c.id = p_source_id;
  if not found then
    raise exception 'Course not found' using errcode = 'P0002';
  end if;

  -- A platform catalogue course carries `organization_id is null`. Governance of those belongs to
  -- the platform, and `create_governed_content_revision` already refuses tenant edits to
  -- `platform_owned` assets -- so registering one from a tenant session would build an asset only to
  -- have every revision on it rejected. Refuse it here, where the reason is legible.
  if v_organization_id is null then
    raise exception 'Platform catalogue courses are governed by the platform, not by a tenant'
      using errcode = '42501';
  end if;

  perform app_private.assert_content_permission(v_organization_id, 'content.studio.author');

  insert into public.governed_content_assets(organization_id, asset_type, source_id, title, owner_profile_id)
  values (v_organization_id, 'course', p_source_id, coalesce(nullif(btrim(p_title), ''), v_title), auth.uid())
  on conflict (organization_id, asset_type, source_id) do update
    set title = excluded.title,
        updated_at = now()
  returning id into v_asset_id;

  return v_asset_id;
end;
$$;

comment on function public.register_governed_content_asset(text, uuid, text) is
  'Brings a course under governed publication control, returning the existing asset if it already is. Idempotent by (organization, asset_type, source).';

revoke all on function public.register_governed_content_asset(text, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.register_governed_content_asset(text, uuid, text) to authenticated;
