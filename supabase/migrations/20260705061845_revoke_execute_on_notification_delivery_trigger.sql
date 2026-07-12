-- queue_notification_delivery() is a trigger function only (fires via AFTER INSERT ON
-- notifications, runs as the table owner regardless of grants) -- it has no legitimate direct-RPC
-- caller, so close the anon/authenticated RPC-exposure lint warning the same way
-- revoke_public_grant_on_privileged_functions.sql already did for other trigger functions.
revoke all on function public.queue_notification_delivery() from public, anon, authenticated;
