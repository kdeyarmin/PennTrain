-- Companion fix, required by the dispatch-notifications code change for the confirmed concurrency
-- finding (two overlapping cron-fired invocations could both pick up and send the same pending
-- notification_deliveries row): the fix atomically claims a batch with
-- `update ... set status = 'processing' where status = 'pending' ... returning ...` instead of a
-- plain select, so a second overlapping invocation's own `where status = 'pending'` no longer
-- matches rows already claimed. notification_deliveries.status's check constraint
-- (20260705061816_notification_delivery_engine.sql) only allows
-- ('pending','sent','failed','skipped') -- without 'processing' in that list, every dispatch run
-- would now fail outright with a check-constraint violation instead of the original (less severe)
-- duplicate-send bug.
alter table public.notification_deliveries
  drop constraint notification_deliveries_status_check,
  add constraint notification_deliveries_status_check
    check (status in ('pending', 'processing', 'sent', 'failed', 'skipped'));
