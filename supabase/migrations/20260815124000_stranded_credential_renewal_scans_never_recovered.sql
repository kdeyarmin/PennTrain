-- A worker crash stranded credential-renewal submissions in 'scanning' forever.
--
-- claim_credential_renewal_submissions flipped rows to 'scanning' with no lease timestamp,
-- and its claim query selected only 'uploaded' -- nothing anywhere ever reset a stale
-- 'scanning' row. The renewal cron claims up to ten submissions and each Anthropic OCR call
-- can run to its 60-second timeout, so a batch can outlive the edge-function wall clock; the
-- isolate is killed mid-batch (a deploy does the same) and every not-yet-recorded submission
-- stayed 'scanning' permanently: never re-claimed, never quarantined, never reaching
-- needs_review, while the queue summary lumped it into the "uploaded" bucket.
--
-- Fix, mirroring claim_organization_export_jobs' stale-processing branch: 'scanning' rows go
-- stale 15 minutes after their claim (updated_at is stamped by the claim) and become
-- claimable again, with a scan_attempts counter so a submission that repeatedly kills the
-- worker lands in the human review queue instead of looping. needs_review is the correct
-- terminal: that queue exists precisely for documents automation could not finish.

alter table public.credential_renewal_submissions
  add column if not exists scan_attempts integer not null default 0;

create or replace function public.claim_credential_renewal_submissions(p_limit integer default 10)
returns table (
  id uuid,
  credential_document_id uuid,
  organization_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max_attempts constant integer := 5;
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise exception 'Only the trusted renewal worker may claim submissions'
      using errcode = '42501';
  end if;

  -- Submissions that burned through their attempts stop cycling and surface to a human.
  update public.credential_renewal_submissions s
  set status = 'needs_review',
      scan_evidence = s.scan_evidence || jsonb_build_object(
        'autoScanExhausted', true,
        'reason', 'OCR worker was interrupted repeatedly; extract the fields manually.'
      ),
      updated_at = now()
  where s.status = 'scanning'
    and s.updated_at < now() - interval '15 minutes'
    and s.scan_attempts >= v_max_attempts;

  return query
  with claimed as (
    update public.credential_renewal_submissions s
    set status = 'scanning', scan_attempts = s.scan_attempts + 1, updated_at = now()
    where s.id in (
      select s2.id from public.credential_renewal_submissions s2
      where (
        s2.status = 'uploaded'
        or (s2.status = 'scanning'
            and s2.updated_at < now() - interval '15 minutes'
            and s2.scan_attempts < v_max_attempts)
      )
      order by s2.created_at
      limit greatest(1, least(coalesce(p_limit, 10), 50))
      for update skip locked
    )
    returning s.id, s.credential_document_id, s.organization_id
  )
  select claimed.id, claimed.credential_document_id, claimed.organization_id from claimed;
end;
$$;

revoke all on function public.claim_credential_renewal_submissions(integer) from public, anon, authenticated;
grant execute on function public.claim_credential_renewal_submissions(integer) to service_role;
