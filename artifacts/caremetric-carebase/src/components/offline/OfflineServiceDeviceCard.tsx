import { useState } from "react";
import { HardDrive, ShieldCheck, Trash2, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { errorText } from "@/lib/errorText";
import {
  UNRESOLVED_DRAFT_STATES,
  useOfflineServiceDeviceRegistration,
  useRevokeOfflineServiceDevice,
  useUnsyncedServiceDraftEntries,
} from "@/hooks/useOfflineServiceDrafts";
import {
  useUnsyncedObservationDraftEntries,
} from "@/hooks/useOfflineObservationDrafts";
import { UNRESOLVED_OBSERVATION_DRAFT_STATES } from "@/lib/offlineObservationDraftSafety";

/**
 * Ending this device's offline registration (BACKLOG.md G12.6).
 *
 * `register_offline_service_device` was reachable from five places and
 * `revoke_offline_service_device` from none, so a personal phone could be enrolled to document care
 * offline and never un-enrolled -- there was no supported way to say "this device is not mine any
 * more", which is the question that matters when one is lost or an agency shift ends.
 *
 * Revoking is refused while unsynced drafts remain, and that refusal is the point rather than a
 * nicety: the wipe is local and permanent, those drafts are care documentation that never reached
 * the server, and nothing on the server can restore them. So the count is shown and the button is
 * disabled until the work is either synced or explicitly dismissed.
 */
export function OfflineServiceDeviceCard() {
  const { toast } = useToast();
  const registration = useOfflineServiceDeviceRegistration();
  const revoke = useRevokeOfflineServiceDevice();
  const serviceEntries = useUnsyncedServiceDraftEntries();
  const observationEntries = useUnsyncedObservationDraftEntries();
  const [confirming, setConfirming] = useState(false);

  // Nothing registered on this device means nothing to end. Rendering a card about a registration
  // that does not exist would invite somebody to create one by pressing the thing that removes it.
  if (!registration.data) return null;

  const pending =
    (serviceEntries.data ?? []).filter((entry) => (UNRESOLVED_DRAFT_STATES as string[]).includes(entry.syncState)).length
    + (observationEntries.data ?? []).filter((entry) => (UNRESOLVED_OBSERVATION_DRAFT_STATES as string[]).includes(entry.syncState)).length;
  const draftsBusy = serviceEntries.isLoading || serviceEntries.isPending || observationEntries.isLoading || observationEntries.isPending;
  const blocked = draftsBusy || pending > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <HardDrive className="h-5 w-5" />This device
        </CardTitle>
        <CardDescription>
          Registered for offline documentation on{" "}
          {new Date(registration.data.registeredAt).toLocaleDateString()}.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Alert>
          <ShieldCheck className="h-4 w-4" />
          <AlertTitle>What removing it does</AlertTitle>
          <AlertDescription>
            The server stops accepting drafts from this device, and everything cached here is
            wiped. Do this when the device is being handed on, replaced, or lost.
          </AlertDescription>
        </Alert>

        {blocked && (
          <Alert variant="destructive">
            <TriangleAlert className="h-4 w-4" />
            <AlertTitle>
              {pending} item{pending === 1 ? "" : "s"} {pending === 1 ? "has" : "have"} not reached the server
            </AlertTitle>
            <AlertDescription>
              Removing the device wipes them, and nothing on the server can bring them back. Sync or
              dismiss them above first.
            </AlertDescription>
          </Alert>
        )}

        {confirming && !blocked ? (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm">Remove this device and wipe what it holds?</p>
            <Button
              size="sm"
              variant="destructive"
              disabled={revoke.isPending}
              onClick={() => {
                revoke.mutate(undefined, {
                  onSuccess: () => {
                    setConfirming(false);
                    toast({
                      title: "Device removed",
                      description: "This device can no longer document care offline.",
                    });
                  },
                  onError: (error) => toast({
                    title: "Could not remove the device",
                    description: errorText(error),
                    variant: "destructive",
                  }),
                });
              }}
            >
              {revoke.isPending ? "Removing..." : "Yes, remove it"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button>
          </div>
        ) : (
          <Button
            variant="outline"
            disabled={blocked}
            title={draftsBusy ? "Checking for unsynced drafts…" : blocked ? `${pending} unsynced item(s) would be lost.` : undefined}
            onClick={() => setConfirming(true)}
          >
            <Trash2 className="mr-2 h-4 w-4" />Remove this device
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
