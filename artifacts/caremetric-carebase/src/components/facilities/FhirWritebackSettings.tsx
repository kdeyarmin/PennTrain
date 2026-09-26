import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { type FhirSource, useSetFhirSourceWriteback } from "@/hooks/useFhirIntegration";

export function FhirWritebackSettings({ source, canManage }: { source: FhirSource; canManage: boolean }) {
  const [reference, setReference] = useState(source.writeback_contract_reference ?? "");
  const [confirmed, setConfirmed] = useState(false);
  const mutation = useSetFhirSourceWriteback();
  const { toast } = useToast();
  const save = async (enabled: boolean) => {
    try {
      await mutation.mutateAsync({ sourceId: source.id, facilityId: source.facility_id, enabled, contractReference: reference.trim(), conditionalCreateConfirmed: confirmed });
      setConfirmed(false);
      toast({ title: enabled ? "Write-back authorized" : "Write-back disabled", description: enabled
        ? "Delivery also requires matching vendor credentials configured by your platform operator. Resident disclosure consent is checked for every queued delivery."
        : "Pending deliveries for this source have been cancelled." });
    } catch (error) {
      toast({ title: "Could not change write-back authorization", description: error instanceof Error ? error.message : "Retry after verifying your session.", variant: "destructive" });
    }
  };
  return <div className="space-y-3 rounded-md border p-3">
    <p className="font-medium">Outbound observations: {source.writeback_enabled ? "authorized" : "off"}</p>
    <p className="text-xs text-muted-foreground">Your platform operator must configure vendor credentials for this exact connection. Authorization here does not confirm successful delivery.</p>
    {canManage && (source.writeback_enabled
      ? <Button size="sm" variant="outline" disabled={mutation.isPending} onClick={() => void save(false)}>Disable write-back</Button>
      : <>
        <Label htmlFor={`writeback-contract-${source.id}`}>Vendor agreement / approval reference</Label>
        <Input id={`writeback-contract-${source.id}`} value={reference} maxLength={2000} onChange={(event) => setReference(event.target.value)} />
        <label className="flex items-start gap-2 text-xs"><Checkbox checked={confirmed} onCheckedChange={(value) => setConfirmed(value === true)} />
          The vendor has approved observation write-back and confirmed FHIR conditional-create support, so retries cannot create duplicate observations.</label>
        <Button size="sm" disabled={mutation.isPending || source.status !== "active" || !source.fhir_base_url || reference.trim().length < 5 || !confirmed} onClick={() => void save(true)}>Authorize write-back</Button>
      </>)}
  </div>;
}
