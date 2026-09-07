-- A domain challenge the page could never show again, and a re-registration that invalidated the
-- DNS record the operator had already published.
--
-- BACKLOG J44.
--
-- The verification challenge is minted in the BROWSER: the page generates a token, publishes the
-- plaintext to the operator so they can put it in a DNS TXT record, and sends only its SHA-256 to
-- `register_identity_domain`. So the plaintext exists in React state and nowhere else. Reload the
-- page -- or come back tomorrow, which is how DNS propagation actually works -- and the challenge
-- is gone, with no way to recover it, because the database only ever had a digest.
--
-- The way out that the page offers is to register the domain again, and that makes it worse:
-- registration on an existing pending row OVERWRITES `verification_challenge_sha256`. The record
-- the operator published last night now proves nothing, and the only signal is that verification
-- keeps failing.
--
-- Three changes, and the first one is the point: the challenge is minted on the SERVER and stored,
-- so the product can show it again.
--
-- `verification_challenge` is not a secret. Its entire purpose is to be published in public DNS,
-- where anyone can read it; what it proves is control of the zone, not knowledge of a value. It is
-- still readable only through these RPCs rather than by a table policy, because there is no reason
-- for it to be broadly selectable and the digest column stays the thing verification compares.
--
-- Registration becomes IDEMPOTENT: an existing pending row keeps the challenge already in DNS and
-- hands it back. Rotation is a separate, deliberate act, because sometimes it is genuinely what
-- you want -- a challenge that leaked into a ticket, a zone transferred to someone else.

alter table public.organization_identity_domains
  add column if not exists verification_challenge text;

comment on column public.organization_identity_domains.verification_challenge is
  'The plaintext of the DNS TXT value that proves control of this domain. Minted server-side and '
  'kept so the product can show it again after a reload -- the page used to mint it in the browser '
  'and send only the digest, so the one copy lived in React state and a refresh lost it for good '
  '(BACKLOG J44). Not a secret: it is meant to be published in public DNS. Readable only through '
  'the domain RPCs.';

-- The return type changes from uuid to jsonb: the caller needs the challenge back, and a uuid
-- cannot carry it. Dropped and recreated rather than given a new name, because a second
-- registration function is exactly how a page ends up calling the one that still rotates.
drop function if exists public.register_identity_domain(uuid, text, text);

create or replace function public.register_identity_domain(
  p_organization_id uuid,
  p_domain text,
  p_verification_challenge_sha256 text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_domain public.organization_identity_domains%rowtype;
  v_token text;
  v_normalized text := lower(btrim(coalesce(p_domain, '')));
begin
  perform public.require_identity_administrator(p_organization_id, 'identity_admin');
  if v_normalized !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
     or length(v_normalized) > 253 then
    raise exception 'That is not a domain name' using errcode = '22023';
  end if;

  select * into v_domain
  from public.organization_identity_domains
  where domain = v_normalized
  for update;

  if v_domain.id is not null then
    if v_domain.organization_id <> p_organization_id then
      raise exception 'identity domain is unavailable' using errcode = '23505';
    end if;
    if v_domain.verification_status = 'verified' then
      raise exception 'identity domain is already verified' using errcode = '55000';
    end if;

    -- BACKLOG J44. Idempotent. A pending registration keeps the challenge that is already in the
    -- operator's DNS; re-registering used to mint a new one and silently invalidate the record
    -- they published last night. Rotation is rotate_identity_domain_challenge, on purpose.
    if v_domain.verification_challenge is not null and v_domain.revoked_at is null then
      return jsonb_build_object(
        'domainId', v_domain.id,
        'domain', v_domain.domain,
        'challenge', v_domain.verification_challenge,
        'status', v_domain.verification_status,
        'rotated', false
      );
    end if;

    -- A revoked domain, or one registered before the challenge was stored, starts a fresh proof.
    v_token := 'cmt-verify-' || encode(extensions.gen_random_bytes(24), 'hex');
    update public.organization_identity_domains
    set verification_challenge = v_token,
        verification_challenge_sha256 = encode(extensions.digest(convert_to(v_token, 'UTF8'), 'sha256'), 'hex'),
        verification_status = 'pending',
        verified_at = null,
        verified_by = null,
        revoked_at = null,
        revoked_by = null,
        revocation_reason = null,
        created_by = auth.uid()
    where id = v_domain.id
    returning * into v_domain;
    return jsonb_build_object(
      'domainId', v_domain.id, 'domain', v_domain.domain,
      'challenge', v_token, 'status', v_domain.verification_status, 'rotated', true
    );
  end if;

  v_token := 'cmt-verify-' || encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.organization_identity_domains (
    organization_id, domain, verification_challenge, verification_challenge_sha256, created_by
  ) values (
    p_organization_id, v_normalized, v_token,
    encode(extensions.digest(convert_to(v_token, 'UTF8'), 'sha256'), 'hex'), auth.uid()
  ) returning * into v_domain;

  return jsonb_build_object(
    'domainId', v_domain.id, 'domain', v_domain.domain,
    'challenge', v_token, 'status', v_domain.verification_status, 'rotated', true
  );
end;
$function$;

comment on function public.register_identity_domain(uuid, text, text) is
  'Registers a domain for identity verification and returns the DNS challenge to publish. '
  'Idempotent: registering a domain that is already pending returns the challenge already in the '
  'operator''s DNS rather than minting a new one, which is what used to invalidate the record they '
  'had published (BACKLOG J44). p_verification_challenge_sha256 is accepted and ignored -- the '
  'challenge is minted server-side now, so a reload can show it again -- and is kept in the '
  'signature so an older client does not fail on an unknown argument.';

revoke all on function public.register_identity_domain(uuid, text, text) from public, anon;
grant execute on function public.register_identity_domain(uuid, text, text) to authenticated;

create or replace function public.rotate_identity_domain_challenge(p_domain_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_domain public.organization_identity_domains%rowtype;
  v_token text;
begin
  select * into v_domain from public.organization_identity_domains where id = p_domain_id for update;
  if not found then
    raise exception 'identity domain not found' using errcode = 'P0002';
  end if;
  perform public.require_identity_administrator(v_domain.organization_id, 'identity_admin');
  if v_domain.verification_status = 'verified' then
    raise exception 'identity domain is already verified' using errcode = '55000';
  end if;

  v_token := 'cmt-verify-' || encode(extensions.gen_random_bytes(24), 'hex');
  update public.organization_identity_domains
  set verification_challenge = v_token,
      verification_challenge_sha256 = encode(extensions.digest(convert_to(v_token, 'UTF8'), 'sha256'), 'hex'),
      verification_status = 'pending',
      verified_at = null,
      verified_by = null,
      created_by = auth.uid()
  where id = v_domain.id
  returning * into v_domain;

  return jsonb_build_object(
    'domainId', v_domain.id, 'domain', v_domain.domain,
    'challenge', v_token, 'status', v_domain.verification_status, 'rotated', true
  );
end;
$function$;

comment on function public.rotate_identity_domain_challenge(uuid) is
  'Issues a NEW DNS challenge for a domain, invalidating whatever is currently published. This is '
  'the deliberate form of what re-registration used to do by accident (BACKLOG J44) -- for a '
  'challenge that leaked into a ticket, or a zone that has changed hands.';

revoke all on function public.rotate_identity_domain_challenge(uuid) from public, anon;
grant execute on function public.rotate_identity_domain_challenge(uuid) to authenticated;

create or replace function public.get_organization_identity_domains(p_organization_id uuid)
returns table (
  id uuid,
  domain text,
  verification_status text,
  verification_challenge text,
  verified_at timestamptz,
  revoked_at timestamptz,
  revocation_reason text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  perform public.require_identity_administrator(p_organization_id, 'identity_admin');
  return query
  select d.id, d.domain, d.verification_status,
    -- The outstanding proof, so a reload can show it. Not returned once the domain is verified:
    -- at that point the TXT record has done its job and there is nothing to publish.
    case when d.verification_status = 'verified' then null else d.verification_challenge end,
    d.verified_at, d.revoked_at, d.revocation_reason, d.created_at
  from public.organization_identity_domains d
  where d.organization_id = p_organization_id
  order by d.created_at desc, d.id;
end;
$function$;

comment on function public.get_organization_identity_domains(uuid) is
  'Every identity domain this organization has registered, with the outstanding DNS challenge for '
  'the ones still pending -- which is what lets the page show a challenge again after a reload '
  'instead of dead-ending (BACKLOG J44).';

revoke all on function public.get_organization_identity_domains(uuid) from public, anon;
grant execute on function public.get_organization_identity_domains(uuid) to authenticated;
