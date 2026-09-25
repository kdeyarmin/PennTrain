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

type ProvisioningReceipt = { requestId: string; organization: string; facility: string; type: string; created: string;
  administrator: { firstName: string; lastName: string; email: string }; invitationSent: boolean };
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
  const { toast } = useToast(), client = useQueryClient();
  function saveReceipt(value: ProvisioningReceipt) {
    setSaved(value);
    try { sessionStorage.setItem(receiptKey, JSON.stringify(value)); }
    catch { toast({ title: "Keep this setup page open", description: "This browser could not save the recovery receipt. The facility remains available in your organization list." }); }
  }
  async function sendAdministratorInvitation(organizationId: string) {
    await invite.mutateAsync({ ...administrator, role: "org_admin", organizationId, redirectTo: absoluteAppUrl("/reset-password") });
    setInvitationSent(true);
    if (saved) saveReceipt({ ...saved, created: organizationId, administrator, invitationSent: true });
    toast({ title: "Facility ready; administrator invitation sent" });
  }
  return <div className="space-y-3">
    <Button variant="outline" onClick={() => setOpen(!open)}>Create complimentary training facility</Button>
    {open && !created && <form className="grid gap-3 rounded-lg border p-4 max-w-xl" onSubmit={async e => {
      e.preventDefault(); const form = e.currentTarget, fields = new FormData(form); setBusy(true);
      const receipt: ProvisioningReceipt = { requestId, organization: String(fields.get("organization")), facility: String(fields.get("facility")), type: String(fields.get("type")), administrator, created: "", invitationSent: false };
      saveReceipt(receipt);
      try {
        const { data, error } = await supabase.rpc("provision_training_facility", { p_request_id: requestId,
          p_organization_name: String(fields.get("organization")), p_facility_name: String(fields.get("facility")), p_facility_type: String(fields.get("type")) });
        if (error) throw error;
        const organizationId = (data as { organization_id: string }).organization_id;
        setCreated(organizationId);
        saveReceipt({ ...receipt, created: organizationId });
        await Promise.all([client.invalidateQueries({ queryKey: ["organizations"] }), client.invalidateQueries({ queryKey: ["facilities"] })]);
        await sendAdministratorInvitation(organizationId);
        saveReceipt({ ...receipt, created: organizationId, invitationSent: true });
      } catch (error) { toast({ title: "Facility setup needs attention", description: trainingActionError(error), variant: "destructive" }); }
      finally { setBusy(false); }
    }}>
      <p className="text-sm">Complimentary partner — Training only. Creates the organization, facility and ongoing access, then invites its administrator. No card or paid subscription is created. Other modules require their own commercial access.</p>
      <label className="text-sm">Organization name<Input name="organization" defaultValue={saved?.organization} required minLength={2} maxLength={200} /></label>
      <label className="text-sm">Facility name<Input name="facility" defaultValue={saved?.facility} required minLength={2} maxLength={200} /></label>
      <label className="text-sm">License type<select name="type" defaultValue={saved?.type || "PCH"} className="w-full border rounded p-2"><option value="PCH">Pennsylvania personal care home</option><option value="ALR">Pennsylvania Assisted Living Facility (ALF)</option></select></label>
      <fieldset className="grid gap-3 border-t pt-3"><legend className="font-medium">Facility administrator</legend>
        <label className="text-sm">Administrator first name<Input required maxLength={100} value={administrator.firstName} onChange={event => setAdministrator(current => ({ ...current, firstName: event.target.value }))} /></label>
        <label className="text-sm">Administrator last name<Input required maxLength={100} value={administrator.lastName} onChange={event => setAdministrator(current => ({ ...current, lastName: event.target.value }))} /></label>
        <label className="text-sm">Administrator email<Input type="email" required maxLength={254} value={administrator.email} onChange={event => setAdministrator(current => ({ ...current, email: event.target.value }))} /></label>
        <p className="text-xs text-muted-foreground">This administrator manages the organization and any facilities subsequently added to it. They set their own password and complete administrator security.</p>
      </fieldset>
      <Button disabled={busy}>{busy ? "Creating facility and inviting administrator…" : "Create free Train access"}</Button>
    </form>}
    {created && <div role="status" className="rounded-lg border p-4 space-y-2">
      <p className="font-medium">Training-only facility created. {invitationSent ? "Administrator invitation sent." : "Administrator invitation needs attention."}</p>
      <p className="text-sm">Administrator: {administrator.email}. They will set their own password, sign in, complete account security, and follow the facility setup checklist. Retrying the invitation uses this saved facility.</p>
      {!invitationSent && <Button disabled={busy || invite.isPending} onClick={async () => { try { await sendAdministratorInvitation(created); } catch (error) { toast({ title: "Invitation needs attention", description: trainingActionError(error), variant: "destructive" }); } }}>Retry administrator invitation</Button>}
      <div className="flex flex-wrap gap-3"><Link href={trainingAdministratorInviteHref(created)} className="underline">Review / change administrator invitation</Link><Link href={`/admin/organizations/${created}`} className="underline">Open organization</Link></div>
      <Link href={`/app/invitations?search=${encodeURIComponent(administrator.email)}`} className="underline text-sm">Check invitation delivery and activation</Link>
      <Button variant="outline" disabled={busy || invite.isPending} onClick={() => { try { sessionStorage.removeItem(receiptKey); } catch { /* No persisted receipt in this browser. */ } setSaved(null); setAdministrator({ firstName: "", lastName: "", email: "" }); setCreated(""); setInvitationSent(false); setRequestId(crypto.randomUUID()); setOpen(true); }}>Create another complimentary facility</Button>
    </div>}
  </div>;
}
