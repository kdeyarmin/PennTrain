import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PRODUCT_MODULES } from "@/lib/productModules";
import { useToast } from "@/hooks/use-toast";

type Term = { id: string; module_key: string; source: string; reason: string; starts_at: string; ends_at: string | null; revoked_at: string | null };
export function IndependentModuleAccess({ organizationId }: { organizationId: string }) {
  const client = useQueryClient(), { toast } = useToast();
  const [busy, setBusy] = useState(false), [reason, setReason] = useState(""), [module, setModule] = useState("modules.train"), [source, setSource] = useState("complimentary"), [ends, setEnds] = useState("");
  const terms = useQuery({ queryKey: ["module-access-terms", organizationId], queryFn: async () => {
    const { data, error } = await supabase.rpc("list_module_access_terms", { p_organization_id: organizationId });
    if (error) throw error; return data as unknown as Term[];
  } });
  async function change(revokeId?: string) {
    setBusy(true);
    try {
      const { error } = await supabase.rpc("manage_module_access_term", { p_organization_id: organizationId, p_module_key: module, p_source: source,
        p_reason: reason, ...(ends ? { p_ends_at: ends } : {}), ...(revokeId ? { p_revoke_id: revokeId } : {}) });
      if (error) throw error;
      await Promise.all([client.invalidateQueries({ queryKey: ["module-access-terms"] }), client.invalidateQueries({ queryKey: ["product-module-entitlements"] }), client.invalidateQueries({ queryKey: ["organizations"] })]);
      toast({ title: revokeId ? "Module access revoked" : "Independent module access granted" });
    } catch (error) { toast({ title: "Access update failed", description: error instanceof Error ? error.message : String(error), variant: "destructive" }); }
    finally { setBusy(false); }
  }
  return <Card><CardHeader><CardTitle>Independent module access</CardTitle></CardHeader><CardContent className="space-y-4">
    <p className="text-sm">Use complimentary access to give a facility Train without a subscription. Select the CareMetric Train package above for a training-only organization. Other purchased modules remain governed by their package. Suspension and explicit denials still apply.</p>
    <form className="grid md:grid-cols-2 gap-3" onSubmit={e => { e.preventDefault(); void change(); }}>
      <label className="text-sm">Module<select className="w-full border rounded p-2" value={module} onChange={e => setModule(e.target.value)}>{PRODUCT_MODULES.map(m => <option key={m.id} value={m.entitlementKey}>{m.name}</option>)}</select></label>
      <label className="text-sm">Basis<select className="w-full border rounded p-2" value={source} onChange={e => setSource(e.target.value)}><option value="complimentary">Complimentary</option><option value="contract">Separately executed contract</option></select></label>
      <label className="text-sm">Ends at (optional ISO timestamp with offset)<Input value={ends} onChange={e => setEnds(e.target.value)} placeholder="Leave blank for ongoing access" /></label>
      <label className="text-sm">Business reason / contract reference<Input minLength={10} maxLength={1000} required value={reason} onChange={e => setReason(e.target.value)} /></label>
      <Button disabled={busy}>Grant module access</Button>
    </form>
    {terms.isError ? <p role="alert">Could not load access terms. <Button onClick={() => void terms.refetch()}>Retry</Button></p> : terms.data?.map(t => <div key={t.id} className="border-t pt-3 text-sm flex gap-3 justify-between"><p>{t.module_key} · {t.source} · {t.revoked_at ? "revoked" : t.ends_at ? `ends ${t.ends_at}` : "ongoing"}<br />{t.reason}</p>{!t.revoked_at && <Button variant="outline" disabled={busy || reason.trim().length < 10} onClick={() => void change(t.id)}>Revoke</Button>}</div>)}
  </CardContent></Card>;
}
