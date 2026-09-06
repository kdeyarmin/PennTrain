import { useState } from "react";
import { AlertTriangle, KeyRound, RefreshCw, Webhook } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { errorText } from "@/lib/errorText";
import { QueryError } from "@/components/QueryState";
import {
  useDeactivateWebhookEndpoint, useIntegrationCredentialRegister, useIntegrationDeadLetters,
  useIntegrationWebhookRegister, useIntegrationWebhookSubscriptions,
  useReactivateWebhookEndpoint, useReplayWebhookDelivery, useRevokeIntegrationCredential,
  useRotateIntegrationCredential, useRotateWebhookSecret, useSetWebhookSubscription,
  type RotatedSecret,
} from "@/hooks/useIntegrationRegister";

const MIN_REASON = 10;

/**
 * What has been issued, and how to take it back (BACKLOG.md G15.2-G15.5).
 *
 * The card above this one could issue an API credential and create a webhook endpoint. Nothing
 * could list either afterwards, and the four functions that revoke, rotate and deactivate them had
 * no caller anywhere -- so a machine credential suspected of leaking could only be left in place,
 * and a webhook kept delivering to whatever URL it was created with.
 *
 * Revoking and deactivating both demand a written reason, because both are answers to an incident
 * and the reason is what the incident record needs. Rotation does not: rotating on a schedule is
 * good practice and should not require an excuse.
 *
 * The second pass adds the three controls the server had and the product did not: replaying a
 * dead-lettered delivery (reachable only from a cron-authenticated dispatcher call before this),
 * switching one event subscription off, and switching an endpoint back on -- which nothing could
 * do at all, so every deactivation, and now every automatic disable, was permanent.
 */
export function IntegrationRegisterCard({ organizationId }: { organizationId: string }) {
  const { toast } = useToast();
  const credentials = useIntegrationCredentialRegister(organizationId);
  const webhooks = useIntegrationWebhookRegister(organizationId);
  const subscriptions = useIntegrationWebhookSubscriptions(organizationId);
  const deadLetters = useIntegrationDeadLetters(organizationId);
  const revokeCredential = useRevokeIntegrationCredential();
  const rotateCredential = useRotateIntegrationCredential();
  const rotateSecret = useRotateWebhookSecret();
  const deactivateEndpoint = useDeactivateWebhookEndpoint();
  const reactivateEndpoint = useReactivateWebhookEndpoint();
  const setSubscription = useSetWebhookSubscription();
  const replayDelivery = useReplayWebhookDelivery();

  const [reasonFor, setReasonFor] = useState<{ kind: "credential" | "endpoint" | "replay"; id: string } | null>(null);
  const [reason, setReason] = useState("");
  const [shown, setShown] = useState<RotatedSecret | null>(null);

  const busy = revokeCredential.isPending || rotateCredential.isPending
    || rotateSecret.isPending || deactivateEndpoint.isPending
    || reactivateEndpoint.isPending || setSubscription.isPending || replayDelivery.isPending;
  const reasonTooShort = reason.trim().length < MIN_REASON;

  const showSecret = (secret: RotatedSecret) => {
    setShown(secret);
    void navigator.clipboard?.writeText(secret.value).catch(() => undefined);
  };

  const submitReason = () => {
    if (!reasonFor) return;
    const done = () => { setReasonFor(null); setReason(""); };
    const onError = (error: unknown) => toast({
      title: "Blocked", description: errorText(error), variant: "destructive",
    });
    if (reasonFor.kind === "credential") {
      revokeCredential.mutate({ credentialId: reasonFor.id, reason: reason.trim() }, {
        onSuccess: () => { done(); toast({ title: "Credential revoked", description: "It stops authenticating immediately." }); },
        onError,
      });
    } else if (reasonFor.kind === "replay") {
      replayDelivery.mutate({ deliveryId: reasonFor.id, reason: reason.trim() }, {
        onSuccess: () => { done(); toast({ title: "Delivery re-queued", description: "The event is queued again for the next dispatch run." }); },
        onError,
      });
    } else {
      deactivateEndpoint.mutate({ endpointId: reasonFor.id, reason: reason.trim() }, {
        onSuccess: () => { done(); toast({ title: "Endpoint deactivated", description: "No further deliveries are attempted." }); },
        onError,
      });
    }
  };

  const toggleSubscription = (endpointId: string, eventType: string, isActive: boolean) =>
    setSubscription.mutate({ endpointId, eventType, isActive: !isActive }, {
      onSuccess: () => toast({
        title: isActive ? "Subscription switched off" : "Subscription switched on",
        description: `${eventType} on this endpoint.`,
      }),
      onError: (error: unknown) => toast({ title: "Blocked", description: errorText(error), variant: "destructive" }),
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="h-5 w-5" />Issued integrations
        </CardTitle>
        <CardDescription>
          Everything provisioned for this organization, and the controls for taking it back. A
          credential that cannot be revoked is a credential you keep whether you want it or not.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {shown && (
          <Alert>
            <AlertTitle>{shown.label}</AlertTitle>
            <AlertDescription className="space-y-2">
              <code className="block break-all rounded bg-muted p-2 font-mono text-xs">{shown.value}</code>
              <p className="text-xs">{shown.note} Copied to your clipboard.</p>
              <Button size="sm" variant="outline" onClick={() => setShown(null)}>I have saved it</Button>
            </AlertDescription>
          </Alert>
        )}

        {reasonFor && (
          <div className="space-y-2 rounded-md border p-3">
            <Label htmlFor="integration-reason">
              Why this {reasonFor.kind === "credential"
                ? "credential is being revoked"
                : reasonFor.kind === "replay"
                ? "delivery is being replayed"
                : "endpoint is being switched off"}
            </Label>
            <Input
              id="integration-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Key appeared in a vendor support ticket; replaced under INC-2043."
            />
            {reasonTooShort && (
              <p className="text-xs text-muted-foreground">
                At least {MIN_REASON} characters — this is what the incident record will say.
              </p>
            )}
            <div className="flex gap-2">
              <Button size="sm" variant="destructive" disabled={busy || reasonTooShort} onClick={submitReason}>
                Confirm
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setReasonFor(null); setReason(""); }}>Cancel</Button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">API credentials</p>
          {credentials.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading credentials…</p>
          ) : credentials.isError ? (
            <QueryError what="API credentials" error={credentials.error} onRetry={() => void credentials.refetch()} />
          ) : (credentials.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">None issued for this organization.</p>
          ) : null}
          {!credentials.isLoading && !credentials.isError && (credentials.data ?? []).map((credential) => {
            const revoked = credential.status !== "active";
            return (
              <div key={credential.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {credential.name} <span className="font-mono text-xs text-muted-foreground">{credential.key_prefix}…</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {credential.scopes.join(", ")} · expires {new Date(credential.expires_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant={revoked ? "outline" : "secondary"}>{credential.status}</Badge>
                  {!revoked && (
                    <>
                      <Button
                        size="sm" variant="outline" disabled={busy}
                        onClick={() => rotateCredential.mutate({ credentialId: credential.id }, {
                          onSuccess: showSecret,
                          onError: (error) => toast({ title: "Rotation blocked", description: errorText(error), variant: "destructive" }),
                        })}
                      >
                        <RefreshCw className="mr-1 h-3.5 w-3.5" />Rotate
                      </Button>
                      <Button
                        size="sm" variant="ghost" className="text-destructive hover:text-destructive"
                        disabled={busy}
                        onClick={() => { setReasonFor({ kind: "credential", id: credential.id }); setReason(""); }}
                      >
                        Revoke
                      </Button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="space-y-2">
          <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <Webhook className="h-3.5 w-3.5" />Webhook endpoints
          </p>
          {(webhooks.isLoading) ? (
            <p className="text-sm text-muted-foreground">Loading webhook endpoints…</p>
          ) : webhooks.isError ? (
            <QueryError what="webhook endpoints" error={webhooks.error} onRetry={() => void webhooks.refetch()} />
          ) : (webhooks.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">None created for this organization.</p>
          ) : null}
          {!webhooks.isLoading && !webhooks.isError && (webhooks.data ?? []).map((endpoint) => {
            const off = endpoint.status !== "active";
            const endpointSubscriptions = (subscriptions.data ?? []).filter(
              (subscription) => subscription.endpoint_id === endpoint.id,
            );
            return (
              <div key={endpoint.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{endpoint.name}</p>
                  <p className="break-all text-xs text-muted-foreground">{endpoint.destination_url}</p>
                  <p className="text-xs text-muted-foreground">
                    secret v{endpoint.secret_version}
                    {endpoint.consecutive_failures > 0 && ` · ${endpoint.consecutive_failures} consecutive failures`}
                    {off && endpoint.disable_reason && ` · ${endpoint.disable_reason}`}
                  </p>
                  {endpointSubscriptions.length > 0 && (
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      {endpointSubscriptions.map((subscription) => (
                        <Button
                          key={subscription.id}
                          size="sm"
                          variant={subscription.is_active ? "secondary" : "outline"}
                          className="h-6 px-2 font-mono text-[11px]"
                          disabled={busy}
                          title={subscription.is_active
                            ? `Stop sending ${subscription.event_type} to this endpoint`
                            : `Send ${subscription.event_type} to this endpoint again`}
                          onClick={() => toggleSubscription(endpoint.id, subscription.event_type, subscription.is_active)}
                        >
                          {subscription.event_type}
                          <span className="ml-1 text-muted-foreground">{subscription.is_active ? "on" : "off"}</span>
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant={off ? "outline" : "secondary"}>{endpoint.status}</Badge>
                  {!off && (
                    <>
                      <Button
                        size="sm" variant="outline" disabled={busy}
                        onClick={() => rotateSecret.mutate({ endpointId: endpoint.id }, {
                          onSuccess: showSecret,
                          onError: (error) => toast({ title: "Rotation blocked", description: errorText(error), variant: "destructive" }),
                        })}
                      >
                        <RefreshCw className="mr-1 h-3.5 w-3.5" />Rotate secret
                      </Button>
                      <Button
                        size="sm" variant="ghost" className="text-destructive hover:text-destructive"
                        disabled={busy}
                        onClick={() => { setReasonFor({ kind: "endpoint", id: endpoint.id }); setReason(""); }}
                      >
                        Switch off
                      </Button>
                    </>
                  )}
                  {off && (
                    <Button
                      size="sm" variant="outline" disabled={busy}
                      onClick={() => reactivateEndpoint.mutate({ endpointId: endpoint.id }, {
                        onSuccess: () => toast({ title: "Endpoint switched back on", description: "The failure count is cleared and queued deliveries resume." }),
                        onError: (error) => toast({ title: "Blocked", description: errorText(error), variant: "destructive" }),
                      })}
                    >
                      Switch back on
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="space-y-2">
          <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <AlertTriangle className="h-3.5 w-3.5" />Dead-lettered deliveries
          </p>
          {deadLetters.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading dead-lettered deliveries…</p>
          ) : deadLetters.isError ? (
            <QueryError what="dead-lettered deliveries" error={deadLetters.error} onRetry={() => void deadLetters.refetch()} />
          ) : (deadLetters.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              None. A delivery lands here after it exhausts its attempts; replaying re-queues the
              same event rather than editing the record of the failure.
            </p>
          ) : null}
          {!deadLetters.isLoading && !deadLetters.isError && (deadLetters.data ?? []).map((delivery) => (
            <div key={delivery.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2">
              <div className="min-w-0">
                <p className="font-mono text-sm">{delivery.event_type}</p>
                <p className="text-xs text-muted-foreground">
                  {delivery.attempt_count} attempts
                  {delivery.last_http_status !== null && ` · HTTP ${delivery.last_http_status}`}
                  {delivery.last_error_code && ` · ${delivery.last_error_code}`}
                  {delivery.replay_count > 0 && ` · replay ${delivery.replay_count}`}
                  {delivery.dead_lettered_at && ` · ${new Date(delivery.dead_lettered_at).toLocaleString()}`}
                </p>
                {delivery.last_error_message && (
                  <p className="break-all text-xs text-muted-foreground">{delivery.last_error_message}</p>
                )}
              </div>
              <Button
                size="sm" variant="outline" disabled={busy}
                onClick={() => { setReasonFor({ kind: "replay", id: delivery.id }); setReason(""); }}
              >
                <RefreshCw className="mr-1 h-3.5 w-3.5" />Replay
              </Button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
