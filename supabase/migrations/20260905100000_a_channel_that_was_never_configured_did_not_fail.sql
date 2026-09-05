-- A channel that was never configured did not fail; there was nothing to fail with.
--
-- THE FINDING, and why it is block 2's to fix rather than block 1's. Until SendGrid and Twilio
-- secrets are set, `dispatch-notifications` returns `provider_not_configured` from sendEmail and
-- sendSms -- as a NON-RETRYABLE PROVIDER FAILURE. `complete_notification_delivery_attempt` then
-- finalizes the delivery `status = 'failed'`, `final_outcome = 'failed'`, and three things follow
-- that should not:
--
--   1. `enqueue_notification_fallback` fires on exactly that pair and opens a delivery on the
--      alternate channel, stamped `escalation_reason = 'alternate_channel_after_permanent_failure'`
--      -- which is not true. Nothing failed. And the alternate provider is equally unconfigured on
--      a deployment that has set neither, so the escalation fails too: two failed rows and a
--      fabricated escalation for a message that never had a way to be sent.
--   2. Those rows are indistinguishable in the ledger from a real provider rejection. Block 2 ends
--      by sending one real email and one real SMS "and following each row to `delivered`", and that
--      reading is much harder against a ledger already full of failures that were never attempts.
--   3. The failures count toward the dispatch job's failure tally, which is what opens the circuit
--      breaker. A deployment with no providers configured can therefore open its own circuit before
--      the secrets are ever set -- and then the first genuinely sendable message arrives to find it
--      open.
--
-- THE SHAPE THE ANSWER ALREADY HAD. `begin_notification_delivery_attempt` already skips a delivery
-- BEFORE any attempt exists, with a `skip_reason`, for five reasons: an inactive recipient, SMS
-- consent not given, the email channel switched off, no live web-push subscription, and the monthly
-- spend cap. Every one of them is the same statement -- there is no channel here, so this is not a
-- delivery that failed. "The provider is not configured" is the sixth, and it belongs beside them
-- rather than in the vocabulary of provider outcomes.
--
-- It cannot go IN that function, because whether SendGrid has an API key is a fact about the Edge
-- runtime's environment and the database cannot see it. So the worker checks its own environment
-- and calls this, which owns the ledger write. `final_outcome` stays null -- the delivery reached
-- no outcome -- which is exactly what keeps the fallback trigger quiet, with no change to that
-- trigger at all.
--
-- Rollback: drop the function. Deliveries on an unconfigured channel go back to being recorded as
-- permanent failures with fabricated escalations.

create or replace function public.skip_notification_delivery(
  p_delivery_id uuid,
  p_skip_reason text,
  p_error_code text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delivery public.notification_deliveries%rowtype;
begin
  if length(btrim(coalesce(p_skip_reason, ''))) < 3 then
    raise exception 'A skip reason is required' using errcode = '22023';
  end if;

  select * into v_delivery
  from public.notification_deliveries
  where id = p_delivery_id
  for update;
  if v_delivery.id is null then
    raise exception 'Notification delivery not found' using errcode = 'P0002';
  end if;

  -- Only a delivery the dispatcher has claimed. A pending one has not been looked at yet and a
  -- finalized one is already answered; in both cases writing a skip would be inventing history.
  if v_delivery.status <> 'processing' then
    return;
  end if;

  update public.notification_deliveries
  set status = 'skipped',
      skip_reason = left(btrim(p_skip_reason), 500),
      error_code = left(p_error_code, 100),
      finalized_at = now()
  where id = p_delivery_id;
end;
$$;

comment on function public.skip_notification_delivery(uuid, text, text) is
  'Records a claimed delivery as skipped, for a reason the database cannot see for itself (today: the channel provider has no credentials in the Edge runtime). Leaves final_outcome null, so the alternate-channel fallback does not fire.';

revoke all on function public.skip_notification_delivery(uuid, text, text) from public, anon, authenticated;
grant execute on function public.skip_notification_delivery(uuid, text, text) to service_role;
