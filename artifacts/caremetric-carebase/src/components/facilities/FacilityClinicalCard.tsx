/**
 * The per-facility clinical switch (BACKLOG.md G11).
 *
 * `20260725160000` added `facilities.clinical_enabled`, defaulting to true, and made it a real gate:
 * `assert_clinical_contributor` refuses native charting at a facility where it is false, and the
 * clinical-integration scope check does the same. `set_facility_clinical_enabled` is the only thing
 * that can change it, and it had no caller -- so the column could only ever hold its default. An
 * organization running clinical charting at some facilities and not others had no way to say so, and
 * a facility switched off by a direct database write could never be switched back on.
 *
 * Turning it off is deliberately worded as scoped rather than destructive, because that is what the
 * migration says it is: existing records stay readable, only new charting is blocked.
 */
import { useState } from "react";
import { Stethoscope } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface RpcResult { data: unknown; error: { message: string } | null }
interface RpcClient { rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<RpcResult> }

export function useSetFacilityClinicalEnabled() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { facilityId: string; enabled: boolean }) => {
      const { data, error } = await (supabase as unknown as RpcClient).rpc(
        "set_facility_clinical_enabled",
        { p_facility_id: input.facilityId, p_enabled: input.enabled },
      );
      if (error) throw new Error(error.message);
      return data as boolean;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["facilities"] });
    },
  });
}

export function FacilityClinicalCard({
  facilityId,
  facilityName,
  clinicalEnabled,
  canManage,
}: {
  facilityId: string;
  facilityName: string;
  clinicalEnabled: boolean;
  canManage: boolean;
}) {
  const setEnabled = useSetFacilityClinicalEnabled();
  const { toast } = useToast();
  const [confirmingDisable, setConfirmingDisable] = useState(false);

  const apply = async (enabled: boolean) => {
    try {
      await setEnabled.mutateAsync({ facilityId, enabled });
      toast({
        title: enabled ? "Clinical charting enabled" : "Clinical charting disabled",
        description: enabled
          ? `Staff can chart natively at ${facilityName} again.`
          : `New charting at ${facilityName} is blocked. Existing records stay readable.`,
      });
    } catch (error) {
      toast({
        title: "Could not change clinical capability",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    } finally {
      setConfirmingDisable(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Stethoscope className="h-4 w-4 text-muted-foreground" /> Clinical capability
          <Badge variant={clinicalEnabled ? "default" : "secondary"}>
            {clinicalEnabled ? "Enabled" : "Disabled"}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {clinicalEnabled
            ? "Staff can record native clinical charting here, and clinical integrations can be configured for this facility."
            : "Native clinical charting and clinical-integration configuration are blocked at this facility. Records captured before it was disabled remain readable."}
        </p>
        {canManage ? (
          <Button
            variant={clinicalEnabled ? "outline" : "default"}
            disabled={setEnabled.isPending}
            onClick={() => (clinicalEnabled ? setConfirmingDisable(true) : void apply(true))}
          >
            {clinicalEnabled ? "Disable clinical charting" : "Enable clinical charting"}
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">
            Only an organization administrator can change this.
          </p>
        )}
      </CardContent>

      <AlertDialog open={confirmingDisable} onOpenChange={setConfirmingDisable}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disable clinical charting at {facilityName}?</AlertDialogTitle>
            <AlertDialogDescription>
              Staff at this facility will no longer be able to record observations, vitals or other native
              clinical documentation, and clinical integrations cannot be configured here. Nothing already
              recorded is deleted or hidden — it stays readable. You can enable it again at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it enabled</AlertDialogCancel>
            <AlertDialogAction onClick={() => void apply(false)}>Disable</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
