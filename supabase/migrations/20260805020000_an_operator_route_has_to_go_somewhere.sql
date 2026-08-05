-- The System Jobs page renders `operator_route` as an "Open" button. The integration webhook
-- dispatch job pointed at `/admin/integrations`, which has never been a route -- so an operator
-- investigating a stalled webhook dispatch clicked Open and landed on Not Found.
--
-- The surface it means is the enterprise control plane: the integration register, credential
-- issue/rotate/revoke and the webhook endpoint controls all live on EnterpriseFoundation, which is
-- `/admin/enterprise`. That is where an operator goes to see why deliveries stopped.
--
-- Found by `check-server-route-links.mjs`, added in the same change: every in-app path the database
-- or an edge function hands a user is now compared against the routes App.tsx declares. Two other
-- links were broken the same way -- `search_workspace` sent platform admins to
-- `/admin/complaints/<id>` and `/admin/violations/<id>`, neither of which existed -- and those are
-- fixed by declaring the routes, since the nine sibling kinds already had theirs.

update app_private.system_job_definitions
set operator_route = '/admin/enterprise'
where job_key = 'integration-webhook-dispatch'
  and operator_route = '/admin/integrations';
