-- Schedules the (not-yet-deployed) poll-heygen-video-statuses Edge Function every 5 minutes, so
-- HeyGen avatar-video generation status flips from "processing" to "completed" without requiring
-- a manual "check status" click per block. Mirrors the exact cron.schedule + net.http_post pattern
-- used by 20260705061816_notification_delivery_engine.sql's dispatch-notification-deliveries job
-- and 20260705160732_schedule_exclusion_screening.sql's monthly-exclusion-screening job: a
-- hardcoded project URL (no vault secret / auth header -- these functions are cron-invoked with
-- verify_jwt=false and use a service-role client internally, matching the dispatch-notifications
-- convention), Content-Type: application/json, empty JSON body.
--
-- The target function does not exist yet -- that is expected; deploying it is a later phase of
-- this plan. Creating the schedule now is harmless: it will just fail to reach anything (404) on
-- every tick until the function is deployed.
select cron.schedule(
  'poll-heygen-video-statuses',
  '*/5 * * * *',
  $$ select net.http_post(
       url := 'https://xsqobvvreaovwibxwyvv.supabase.co/functions/v1/poll-heygen-video-statuses',
       headers := jsonb_build_object('Content-Type', 'application/json'),
       body := '{}'::jsonb
     ); $$
);
