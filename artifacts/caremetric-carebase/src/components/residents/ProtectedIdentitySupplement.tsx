import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { facilityDateTimeLocalToUtcIso, toFacilityDateTimeLocal } from "@/lib/dateUtils";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { readProtectedIdentitySupplement } from "@/lib/residentFaceSheet";

export function ProtectedIdentitySupplement({ residentId, value, canManage }: { residentId: string; value: unknown; canManage: boolean }) {
  const existing = readProtectedIdentitySupplement(value);
  const [editing, setEditing] = useState(false);
  const [reference, setReference] = useState("");
  const [custodian, setCustodian] = useState("");
  const [instructions, setInstructions] = useState("");
  const [verified, setVerified] = useState("");
  const [reason, setReason] = useState("");
  const cache = useQueryClient();
  const { toast } = useToast();
  const save = useMutation({ mutationFn: async () => {
    const { error } = await supabase.rpc("record_protected_identity_supplement" as never, { p_resident_id: residentId, p_external_reference: reference, p_custodian: custodian, p_access_instructions: instructions, p_verified_at: facilityDateTimeLocalToUtcIso(verified), p_reason: reason } as never);
    if (error) throw error;
  }, onSuccess: () => { void cache.invalidateQueries({ queryKey: ["residents"] }); setEditing(false); toast({ title: "Protected supplement reference recorded" }); }, onError: (error: Error) => toast({ title: "Could not record supplement", description: error.message, variant: "destructive" }) });
  return <div className="space-y-2 rounded border p-3 text-sm">
    <strong>Protected identifying-information supplement</strong>
    <p>{existing ? `Reference ${existing.external_reference} · Custodian ${existing.custodian} · Verified ${toFacilityDateTimeLocal(existing.verified_at)}` : "No protected supplement reference has been verified."}</p>
    <p>Keep the Social Security number in the facility's protected external record. Record its location and emergency access procedure here, then send that supplement through the protected transfer process. Do not enter the number or upload it here.</p>
    {canManage && !editing && <Button variant="outline" size="sm" onClick={() => { setReference(existing?.external_reference ?? ""); setCustodian(existing?.custodian ?? ""); setInstructions(existing?.access_instructions ?? ""); setVerified(""); setReason(""); setEditing(true); }}>Verify protected supplement</Button>}
    {canManage && editing && <>
      <Label htmlFor="supplement-reference">External protected record reference *</Label><Input id="supplement-reference" value={reference} onChange={event => setReference(event.target.value)} />
      <Label htmlFor="supplement-custodian">Record custodian *</Label><Input id="supplement-custodian" value={custodian} onChange={event => setCustodian(event.target.value)} />
      <Label htmlFor="supplement-instructions">Emergency access and protected transfer instructions *</Label><Textarea id="supplement-instructions" value={instructions} onChange={event => setInstructions(event.target.value)} />
      <Label htmlFor="supplement-verified">Actual verification time (Pennsylvania time) *</Label><Input id="supplement-verified" type="datetime-local" max={toFacilityDateTimeLocal()} value={verified} onChange={event => setVerified(event.target.value)} />
      <Label htmlFor="supplement-reason">Verification evidence / reason for correction *</Label><Textarea id="supplement-reason" value={reason} onChange={event => setReason(event.target.value)} />
      <Button disabled={save.isPending || reference.trim().length<3 || custodian.trim().length<3 || instructions.trim().length<10 || !verified || reason.trim().length<10} onClick={() => save.mutate()}>Record supplement verification</Button>
    </>}
  </div>;
}
