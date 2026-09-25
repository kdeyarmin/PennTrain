import { trainingActionError } from "@/lib/trainingWorkspace";
import { trainingAdministratorInviteHref } from "@/lib/trainingOnboarding";
import { useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

export function CreateTrainingFacility() {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [created, setCreated] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const { toast } = useToast(), client = useQueryClient();
  return <div className="space-y-3">
    <Button variant="outline" onClick={() => setOpen(!open)}>Create complimentary training facility</Button>
    {open && <form className="grid gap-3 rounded-lg border p-4 max-w-xl" onSubmit={async e => {
      e.preventDefault(); const form = e.currentTarget, fields = new FormData(form); setBusy(true);
      try {
        const { data, error } = await supabase.rpc("provision_training_facility", { p_request_id: requestId,
          p_organization_name: String(fields.get("organization")), p_facility_name: String(fields.get("facility")), p_facility_type: String(fields.get("type")) });
        if (error) throw error;
        setCreated((data as { organization_id: string }).organization_id); setRequestId(crypto.randomUUID()); form.reset();
        await Promise.all([client.invalidateQueries({ queryKey: ["organizations"] }), client.invalidateQueries({ queryKey: ["facilities"] })]);
        toast({ title: "Complimentary training facility created" });
      } catch (error) { toast({ title: "Facility setup failed", description: trainingActionError(error), variant: "destructive" }); }
      finally { setBusy(false); }
    }}>
      <p className="text-sm">Creates the organization, facility, Train-only package and ongoing complimentary access together. Then invite its administrator from Users. No payment card is needed.</p>
      <label className="text-sm">Organization name<Input name="organization" required minLength={2} maxLength={200} /></label>
      <label className="text-sm">Facility name<Input name="facility" required minLength={2} maxLength={200} /></label>
      <label className="text-sm">License type<select name="type" className="w-full border rounded p-2"><option value="PCH">Pennsylvania personal care home</option><option value="ALR">Pennsylvania Assisted Living Facility (ALF)</option></select></label>
      <Button disabled={busy}>Create free Train access</Button>
    </form>}
    {created && <div role="status" className="rounded-lg border p-4 space-y-2">
      <p className="font-medium">Training facility created. Next, invite its administrator.</p>
      <p className="text-sm">The invitation will be set to this organization and the organization administrator role. They will set their own password, complete account security, and open the training workspace.</p>
      <div className="flex flex-wrap gap-3"><Link href={trainingAdministratorInviteHref(created)} className="underline">Invite facility administrator</Link><Link href={`/admin/organizations/${created}`} className="underline">Open organization</Link></div>
    </div>}
  </div>;
}
