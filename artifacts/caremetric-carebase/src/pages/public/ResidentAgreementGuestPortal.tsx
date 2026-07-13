import { useState } from "react";
import { useParams } from "wouter";
import { CheckCircle2, FileSignature, Fingerprint, Loader2, LockKeyhole, ShieldCheck } from "lucide-react";
import {
  useAcceptResidentAgreementGuestTerms,
  useResidentAgreementGuestWorkspace,
  useRespondToResidentAgreementGuest,
  type ResidentAgreementGuestWorkspace,
} from "@/hooks/useResidentAgreements";
import { humanize } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type Agreement = ResidentAgreementGuestWorkspace["agreements"][number];

const blankResponse = () => ({
  outcome: "signed", signerName: "", signerRole: "designated_person", relationship: "",
  legalAuthority: "", attestation: "", reason: "", witnessName: "", witnessRelationship: "",
});

export default function ResidentAgreementGuestPortal() {
  const { token } = useParams<{ token: string }>();
  const workspace = useResidentAgreementGuestWorkspace(token);
  const accept = useAcceptResidentAgreementGuestTerms();
  const respond = useRespondToResidentAgreementGuest();
  const [termsChecked, setTermsChecked] = useState(false);
  const [acceptedLocally, setAcceptedLocally] = useState(false);
  const [selected, setSelected] = useState<Agreement | null>(null);
  const [response, setResponse] = useState(blankResponse);

  const acceptTerms = () => token && accept.mutate(token, { onSuccess: () => setAcceptedLocally(true) });
  const submit = () => {
    if (!token || !selected) return;
    respond.mutate({ token, versionId: selected.versionId, ...response }, {
      onSuccess: () => { setSelected(null); setResponse(blankResponse()); },
    });
  };
  const needsTerms = !acceptedLocally && workspace.isError && !accept.isError;

  return <div className="min-h-screen bg-muted/30 px-4 py-10"><div className="mx-auto max-w-3xl space-y-6">
    <div className="text-center"><LockKeyhole className="mx-auto mb-3 h-10 w-10 text-primary" /><h1 className="text-2xl font-bold">Secure resident agreement review</h1><p className="text-muted-foreground">This expiring link exposes only the exact agreement versions selected for you.</p></div>
    {needsTerms ? <Card><CardHeader><CardTitle>Review electronic-signature terms</CardTitle><CardDescription>Accept the terms before agreement content is disclosed.</CardDescription></CardHeader><CardContent className="space-y-4"><Alert><ShieldCheck className="h-4 w-4" /><AlertTitle>Scoped and attributable access</AlertTitle><AlertDescription>Your terms acceptance, device evidence, agreement views, and response are recorded. Your response is bound to the displayed version and SHA-256 digest.</AlertDescription></Alert><label className="flex items-start gap-2 text-sm"><Checkbox checked={termsChecked} onCheckedChange={checked => setTermsChecked(checked === true)} /><span>I consent to conduct this transaction electronically and understand that typing my name and submitting a response creates an attributable electronic record.</span></label><Button className="w-full" disabled={!termsChecked || accept.isPending} onClick={acceptTerms}>{accept.isPending ? "Accepting…" : "Accept terms and review agreements"}</Button>{accept.isError && <p className="text-sm text-destructive">{accept.error.message}</p>}</CardContent></Card>
    : workspace.isLoading ? <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin" /></div>
    : workspace.isError || !workspace.data ? <Alert variant="destructive"><AlertTitle>Agreement link unavailable</AlertTitle><AlertDescription>This link is invalid, expired, revoked, or has not accepted the current terms.</AlertDescription></Alert>
    : <><Card><CardHeader><CardTitle>{workspace.data.residentName} agreements</CardTitle><CardDescription>Access for {workspace.data.guestLabel} expires {new Date(workspace.data.expiresAt).toLocaleString()}.</CardDescription></CardHeader><CardContent className="space-y-4">{workspace.data.agreements.map(agreement => <div key={agreement.versionId} className="rounded-lg border p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold">{agreement.title}</p><p className="text-xs text-muted-foreground">{humanize(agreement.agreementType)} · Version {agreement.versionLabel} · effective {new Date(agreement.effectiveAt).toLocaleDateString()}</p></div>{agreement.responded ? <Badge className="bg-emerald-100 text-emerald-900"><CheckCircle2 className="mr-1 h-3 w-3" />Response recorded</Badge> : <Button size="sm" onClick={() => { setSelected(agreement); setResponse(blankResponse()); }}><FileSignature className="mr-2 h-4 w-4" />Respond</Button>}</div><div className="mt-4 whitespace-pre-wrap rounded-md bg-muted/50 p-4 text-sm">{agreement.contentText}</div>{agreement.documentLabel && <p className="mt-2 text-xs text-muted-foreground">Linked source document: {agreement.documentLabel}</p>}<p className="mt-2 break-all font-mono text-[11px] text-muted-foreground"><Fingerprint className="mr-1 inline h-3 w-3" />SHA-256 {agreement.contentSha256}</p><p className="mt-1 text-xs text-muted-foreground">Requested signer role(s): {agreement.requiredSignerRoles.map(humanize).join(" + ")}</p></div>)}</CardContent></Card><p className="text-center text-xs text-muted-foreground">CareBase resident e-signature · Terms {workspace.data.termsVersion}</p></>}
  </div>

  <Dialog open={!!selected} onOpenChange={open => !open && setSelected(null)}><DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>Respond to {selected?.title}</DialogTitle><DialogDescription>Your response will be permanently bound to version {selected?.versionLabel} and its displayed content digest.</DialogDescription></DialogHeader><div className="grid gap-3 sm:grid-cols-2">
    <div><Label>Response</Label><Select value={response.outcome} onValueChange={value => setResponse(current => ({ ...current, outcome: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["signed","refused","unable_to_sign"].map(value => <SelectItem key={value} value={value}>{humanize(value)}</SelectItem>)}</SelectContent></Select></div>
    <div><Label>Signer role</Label><Select value={response.signerRole} onValueChange={value => setResponse(current => ({ ...current, signerRole: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["resident","designated_person","guardian","power_of_attorney","other"].map(value => <SelectItem key={value} value={value}>{humanize(value)}</SelectItem>)}</SelectContent></Select></div>
    <div><Label>Full legal name *</Label><Input value={response.signerName} onChange={event => setResponse(current => ({ ...current, signerName: event.target.value }))} /></div>
    <div><Label>Relationship *</Label><Input value={response.relationship} onChange={event => setResponse(current => ({ ...current, relationship: event.target.value }))} /></div>
    <div className="sm:col-span-2"><Label>Legal authority</Label><Input value={response.legalAuthority} onChange={event => setResponse(current => ({ ...current, legalAuthority: event.target.value }))} placeholder="Designated person, guardian order, power of attorney, or other authority" /></div>
    <div className="sm:col-span-2"><Label>Attestation *</Label><Textarea value={response.attestation} onChange={event => setResponse(current => ({ ...current, attestation: event.target.value }))} placeholder={response.outcome === "signed" ? "I reviewed and electronically sign this exact agreement version." : "I confirm this response accurately records the signer’s decision."} /></div>
    {response.outcome !== "signed" && <div className="sm:col-span-2"><Label>Reason *</Label><Textarea value={response.reason} onChange={event => setResponse(current => ({ ...current, reason: event.target.value }))} /></div>}
    <div><Label>Witness name</Label><Input value={response.witnessName} onChange={event => setResponse(current => ({ ...current, witnessName: event.target.value }))} /></div>
    <div><Label>Witness relationship</Label><Input value={response.witnessRelationship} onChange={event => setResponse(current => ({ ...current, witnessRelationship: event.target.value }))} /></div>
    <Alert className="sm:col-span-2"><Fingerprint className="h-4 w-4" /><AlertTitle>Authentication evidence</AlertTitle><AlertDescription>This response uses the accepted expiring link as its authentication method. Device evidence is hashed before storage; raw device text is not retained.</AlertDescription></Alert>
    {respond.isError && <p className="text-sm text-destructive sm:col-span-2">{respond.error.message}</p>}
  </div><DialogFooter><Button variant="outline" onClick={() => setSelected(null)}>Cancel</Button><Button disabled={respond.isPending || response.signerName.trim().length < 2 || response.relationship.trim().length < 2 || response.attestation.trim().length < 5 || (response.outcome !== "signed" && response.reason.trim().length < 5)} onClick={submit}>{respond.isPending ? "Recording…" : response.outcome === "signed" ? "Sign electronically" : "Record response"}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
