-- Register the notification proof layer in the Phase 1 audit coverage manifest.
-- Attempts are lifecycle rows (started -> accepted/final), so their mutations
-- receive the shared audit trigger. Provider and consent events are append-only
-- ledgers: writes occur only through service-role-only SECURITY DEFINER RPCs and
-- neither table exposes UPDATE/DELETE privileges.

drop trigger if exists audit_log on public.notification_delivery_attempts;
create trigger audit_log
after insert or update or delete on public.notification_delivery_attempts
for each row execute function public.audit_log_trigger();

insert into app_private.audit_entity_manifest (
  table_name,
  audit_mode,
  contains_regulated_data,
  rationale
) values
  (
    'notification_delivery_attempts',
    'row_trigger',
    true,
    'Mutable provider-attempt lifecycle audited on every insert, update, and delete'
  ),
  (
    'notification_provider_events',
    'domain_evidence',
    true,
    'Append-only signed and deduplicated provider callback evidence'
  ),
  (
    'notification_consent_events',
    'domain_evidence',
    true,
    'Append-only opt-in, opt-out, and help evidence using recipient fingerprints'
  )
on conflict (table_name) do update
set audit_mode = excluded.audit_mode,
    contains_regulated_data = excluded.contains_regulated_data,
    rationale = excluded.rationale,
    updated_at = now();
