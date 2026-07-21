-- Align web-push spend accounting with the enforcement gate.
--
-- The per-attempt cost trigger recorded web-push (and any non-SMS channel) at the email rate,
-- while begin_notification_delivery_attempt counts web-push as zero incremental cost. Web-push
-- (VAPID) has no per-message provider fee, so only email and SMS should carry a cost. Charging
-- web-push at the email rate over-counted the monthly spend ledger and could trip the email/SMS
-- spend cap early. Make the ledger consistent with the gate: web-push and unknown channels cost 0.
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
      when 'email' then p.email_estimate_micros
      else 0
    end
    into new.estimated_cost_micros
  from public.notification_spend_policies p
  where p.organization_id = new.organization_id;
  new.estimated_cost_micros := coalesce(new.estimated_cost_micros, 0);
  return new;
end;
$function$;
