import { useAuth } from "@/lib/auth";
import { useInviteUser } from "@/hooks/useProfiles";
import { absoluteAppUrl } from "@/lib/appUrl";
import { trainingActionError } from "@/lib/trainingWorkspace";
import { trainingAdministratorInviteHref } from "@/lib/trainingOnboarding";
import { useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useSelectTrainingStarterKit, useTrainingStarterKits } from "@/hooks/useTrainingStarterKits";

type ProvisioningReceipt = { requestId: string; organization: string; facility: string; type: string; created: string;
  administrator: { firstName: string; lastName: string; email: string }; invitationSent: boolean;
  facilityId?: string; starterKitId?: string; starterKitSelected?: boolean };
function readReceipt(key: string): ProvisioningReceipt | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || "null");
    return value && typeof value.requestId === "string" && typeof value.created === "string"
      && typeof value.organization === "string" && typeof value.facility === "string"
      && typeof value.administrator?.email === "string" && typeof value.administrator.firstName === "string"
      && typeof value.administrator.lastName === "string" ? value : null;
  } catch { return null; }
}
export function CreateTrainingFacility() {
  const { user } = useAuth();
  const receiptKey = `train-provisioning:${user?.id}`;
  const [saved, setSaved] = useState(() => readReceipt(receiptKey));
  const [open, setOpen] = useState(!!saved), [busy, setBusy] = useState(false), [created, setCreated] = useState(saved?.created || "");
  const invite = useInviteUser();
  const [administrator, setAdministrator] = useState(saved?.administrator || { firstName: "", lastName: "", email: "" });
  const [invitationSent, setInvitationSent] = useState(saved?.invitationSent === true);
  const [requestId, setRequestId] = useState(() => saved?.requestId || crypto.randomUUID());
  const [starterKitId, setStarterKitId] = useState(saved?.starterKitId || "");
  const starterKits = useTrainingStarterKits(open);
  const selectStarterKit = useSelectTrainingStarterKit();
  const { toast } = useToast(), client = useQueryClient();
  function saveReceipt(value: ProvisioningReceipt) {
    setSaved(value);
    try { sessionStorage.setItem(receiptKey, JSON.stringify(value)); }
    catch { toast({ title: "Keep this setup page open", description: "This browser could not save the recovery receipt. The facility remains available in your organization list." }); }
  }
  async function sendAdministratorInvitation(organizationId: string) {
    await invite.mutateAsync({ ...administrator, role: "org_admin", organizationId, redirectTo: absoluteAppUrl("/reset-password") });
    setInvitationSent(true);
    await client.invalidateQueries({ queryKey: ["organizations"] });
    if (saved) saveReceipt({ ...saved, created: organizationId, administrator, invitationSent: true });
    toast({ title: "Facility ready; administrator invitation sent" });
  }
  return <div className="space-y-3">
    <Button variant="outline" onClick={() => setOpen(!open)}>Create complimentary training facility</Button>
    {open && !created && <form className="grid gap-3 rounded-lg border p-4 max-w-xl" onSubmit={async e => {
      e.preventDefault(); const form = e.currentTarget, fields = new FormData(form); setBusy(true);
      const receipt: ProvisioningReceipt = { requestId, organization: String(fields.get("organization")), facility: String(fields.get("facility")), type: String(fields.get("type")), administrator, created: "", invitationSent: false, starterKitId };
      saveReceipt(receipt);
      try {
        const { data, error } = await supabase.rpc("provision_training_facility", { p_request_id: requestId,
          p_organization_name: String(fields.get("organization")), p_facility_name: String(fields.get("facility")), p_facility_type: String(fields.get("type")) });
        if (error) throw error;
        const { organization_id: organizationId, facility_id: facilityId } = data as { organization_id: string; facility_id: string };
        receipt.facilityId = facilityId; receipt.created = organizationId;
        setCreated(organizationId);
        saveReceipt(receipt);
        await Promise.all([client.invalidateQueries({ queryKey: ["organizations"] }), client.invalidateQueries({ queryKey: ["facilities"] })]);
        if (starterKitId) {
          try { await selectStarterKit.mutateAsync({ facilityId, kitId: starterKitId }); receipt.starterKitSelected = true; saveReceipt({ ...receipt }); }
          catch (error) { toast({ title: "Starter kit needs attention", description: trainingActionError(error), variant: "destructive" }); }
        }
        await sendAdministratorInvitation(organizationId);
        saveReceipt({ ...receipt, created: organizationId, invitationSent: true });
      } catch (error) { toast({ title: "Facility setup needs attention", description: trainingActionError(error), variant: "destructive" }); }
      finally { setBusy(false); }
    }}>
      <p className="text-sm">Complimentary partner — Training only. Creates the organization, facility and ongoing access, then invites its administrator. No card or paid subscription is created. Other modules require their own commercial access.</p>
      <label className="text-sm">Organization name<Input name="organization" defaultValue={saved?.organization} required minLength={2} maxLength={200} /></label>
      <label className="text-sm">Facility name<Input name="facility" defaultValue={saved?.facility} required minLength={2} maxLength={200} /></label>
      <label className="text-sm">License type<select name="type" defaultValue={saved?.type || "PCH"} className="w-full border rounded p-2"><option value="PCH">Pennsylvania personal care home</option><option value="ALR">Pennsylvania Assisted Living Facility (ALF)</option></select></label>
      <label className="text-sm">Optional starter learning kit<select className="w-full border rounded p-2" value={starterKitId} disabled={starterKits.isLoading || starterKits.isError} onChange={event => setStarterKitId(event.target.value)}><option value="">Administrator builds their own plan</option>{starterKits.data?.filter(kit => kit.is_published).map(kit => <option key={kit.id} value={kit.id}>{kit.name}</option>)}</select></label>
      <p className="text-xs text-muted-foreground">A selected kit is ready for the administrator to review in Learning Plans. They enter their own completion deadline before creating the plan.</p>
      {starterKits.isError && <p role="alert" className="text-xs">Starter kits could not load. You can add a kit from the partner facility list after setup.</p>}
      <fieldset className="grid gap-3 border-t pt-3"><legend className="font-medium">Facility administrator</legend>
        <label className="text-sm">Administrator first name<Input required maxLength={100} value={administrator.firstName} onChange={event => setAdministrator(current => ({ ...current, firstName: event.target.value }))} /></label>
        <label className="text-sm">Administrator last name<Input required maxLength={100} value={administrator.lastName} onChange={event => setAdministrator(current => ({ ...current, lastName: event.target.value }))} /></label>
        <label className="text-sm">Administrator email<Input type="email" required maxLength={254} value={administrator.email} onChange={event => setAdministrator(current => ({ ...current, email: event.target.value }))} /></label>
        <p className="text-xs text-muted-foreground">This administrator manages the organization and any facilities subsequently added to it. They set their own password and complete administrator security.</p>
      </fieldset>
      <Button disabled={busy}>{busy ? "Creating facility and inviting administrator…" : "Create free Train access"}</Button>
    </form>}
    {created && <div role="status" className="rounded-lg border p-4 space-y-2">
      <p className="font-medium">Training-only facility created. {invitationSent ? "Administrator invitation sent." : busy || invite.isPending ? "Administrator invitation is being sent…" : "Administrator invitation needs attention."}</p>
      <p className="text-sm">Administrator: {administrator.email}. They will set their own password, sign in, complete account security, and follow the facility setup checklist. Retrying the invitation uses this saved facility.</p>
      {saved?.starterKitId && <p className="text-sm">Starter kit: {saved.starterKitSelected ? "Ready for the facility administrator’s review." : "Needs attention; facility access is ready."}</p>}
      {saved?.starterKitId && saved.facilityId && !saved.starterKitSelected && <Button variant="outline" disabled={busy || selectStarterKit.isPending} onClick={async () => { try {
        await selectStarterKit.mutateAsync({ facilityId: saved.facilityId!, kitId: saved.starterKitId! }); saveReceipt({ ...saved, starterKitSelected: true });
      } catch (error) { toast({ title: "Starter kit needs attention", description: trainingActionError(error), variant: "destructive" }); } }}>Retry starter kit selection</Button>}
      {!invitationSent && <Button disabled={busy || invite.isPending} onClick={async () => { try { await sendAdministratorInvitation(created); } catch (error) { toast({ title: "Invitation needs attention", description: trainingActionError(error), variant: "destructive" }); } }}>Retry administrator invitation</Button>}
      <div className="flex flex-wrap gap-3"><Link href={trainingAdministratorInviteHref(created)} className="underline">Review / change administrator invitation</Link><Link href={`/admin/organizations/${created}`} className="underline">Open organization</Link></div>
      <Link href={`/app/invitations?search=${encodeURIComponent(administrator.email)}`} className="underline text-sm">Check invitation delivery and activation</Link>
      <Button variant="outline" disabled={busy || invite.isPending || selectStarterKit.isPending} onClick={() => { try { sessionStorage.removeItem(receiptKey); } catch { /* No persisted receipt in this browser. */ } setSaved(null); setStarterKitId(""); setAdministrator({ firstName: "", lastName: "", email: "" }); setCreated(""); setInvitationSent(false); setRequestId(crypto.randomUUID()); setOpen(true); }}>Create another complimentary facility</Button>
    </div>}
  </div>;
}
