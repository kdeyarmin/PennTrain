import { useMemo, useState } from "react";
import { Copy, FileCheck2, FileSignature, History, Link2, Plus, RefreshCw, Send, ShieldCheck } from "lucide-react";
import type { ResidentDocument } from "@/hooks/useResidentDocuments";
import {
  useIssueResidentAgreementGuestGrant,
  useMarkResidentAgreementCopyDelivered,
  usePublishResidentAgreementVersion,
  useRecordResidentAgreementOutcome,
  useResidentAgreements,
  useRevokeResidentAgreementGuestGrant,
  type ResidentAgreement,
  type ResidentAgreementSignature,
  type ResidentAgreementVersion,
} from "@/hooks/useResidentAgreements";
import { useToast } from "@/hooks/use-toast";
import { humanize } from "@/lib/utils";
import { toDateTimeLocal } from "@/lib/dateUtils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export const RESIDENT_AGREEMENT_TYPES = [
  "resident_home_contract", "fee_schedule", "service_addendum", "resident_rights",
  "privacy_acknowledgement", "consent_form", "support_plan_acknowledgement",
  "assessment_participation", "personal_property_inventory", "transportation_authorization",
  "photograph_authorization", "emergency_contact_authorization", "financial_responsibility_agreement",
] as const;

const OUTCOMES = ["signed", "refused", "unable_to_sign"];
const SIGNER_ROLES = ["resident", "designated_person", "guardian", "power_of_attorney", "other"];

const blankAgreement = () => ({
  agreementId: "", agreementType: "resident_home_contract", title: "", versionLabel: "1.0",
  contentText: "", effectiveAt: toDateTimeLocal(), documentId: "none",
  residentRequired: true, designatedRequired: false, amendmentReason: "",
});
const blankResponse = () => ({
  versionId: "", outcome: "signed", signerName: "", signerRole: "resident", relationship: "Self",
  legalAuthority: "", authenticationMethod: "staff_session", attestation: "",
  reason: "", witnessName: "", witnessRelationship: "",
});

function statusClass(status: string) {
  if (status === "executed") return "bg-emerald-100 text-emerald-900";
  if (status === "partially_executed") return "bg-amber-100 text-amber-900";
  if (["refused", "unable_to_sign"].includes(status)) return "bg-red-100 text-red-900";
  return "bg-blue-100 text-blue-900";
}

export function ResidentAgreementWorkspace({
  residentId,
  documents,
  canManage,
}: {
  residentId: string;
  documents: ResidentDocument[];
  canManage: boolean;
}) {
  const { toast } = useToast();
  const query = useResidentAgreements(residentId);
  const publish = usePublishResidentAgreementVersion();
  const record = useRecordResidentAgreementOutcome();
  const issueGrant = useIssueResidentAgreementGuestGrant();
  const revokeGrant = useRevokeResidentAgreementGuestGrant();
  const markCopy = useMarkResidentAgreementCopyDelivered();
  const [agreementOpen, setAgreementOpen] = useState(false);
  const [responseOpen, setResponseOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [copySignature, setCopySignature] = useState<ResidentAgreementSignature | null>(null);
  const [agreementForm, setAgreementForm] = useState(blankAgreement);
  const [responseForm, setResponseForm] = useState(blankResponse);
  const [guestLabel, setGuestLabel] = useState("Designated person");
  const [guestVersionIds, setGuestVersionIds] = useState<string[]>([]);
  const [guestDays, setGuestDays] = useState("7");
  const [issuedLink, setIssuedLink] = useState("");
  const [deliveryMethod, setDeliveryMethod] = useState("email");

  const versionsById = useMemo(() => new Map((query.data?.versions ?? []).map(version => [version.id, version])), [query.data?.versions]);
  const signaturesByVersion = (versionId: string) => (query.data?.signatures ?? []).filter(signature => signature.agreement_version_id === versionId);
  const activeVersions = (query.data?.agreements ?? []).map(agreement => versionsById.get(agreement.current_version_id ?? "")).filter(Boolean) as ResidentAgreementVersion[];

  const openAmendment = (agreement: ResidentAgreement) => {
    const version = versionsById.get(agreement.current_version_id ?? "");
    if (!version) return;
    setAgreementForm({
      agreementId: agreement.id, agreementType: agreement.agreement_type, title: agreement.title,
      versionLabel: `${version.version_number + 1}.0`, contentText: version.content_text,
      effectiveAt: toDateTimeLocal(), documentId: version.document_id ?? "none",
      residentRequired: version.required_signer_roles.includes("resident"),
      designatedRequired: version.required_signer_roles.includes("designated_person"), amendmentReason: "",
    });
    setAgreementOpen(true);
  };

  const saveAgreement = () => {
    const roles = [agreementForm.residentRequired ? "resident" : null, agreementForm.designatedRequired ? "designated_person" : null].filter(Boolean) as string[];
    publish.mutate({
      residentId, agreementId: agreementForm.agreementId || undefined,
      agreementType: agreementForm.agreementType, title: agreementForm.title,
      versionLabel: agreementForm.versionLabel, contentText: agreementForm.contentText,
      effectiveAt: new Date(agreementForm.effectiveAt).toISOString(), requiredSignerRoles: roles,
      documentId: agreementForm.documentId === "none" ? undefined : agreementForm.documentId,
      amendmentReason: agreementForm.amendmentReason || undefined,
    }, {
      onSuccess: () => { setAgreementOpen(false); setAgreementForm(blankAgreement()); toast({ title: agreementForm.agreementId ? "Agreement amendment published" : "Resident agreement published" }); },
      onError: (error: Error) => toast({ title: "Couldn't publish agreement", description: error.message, variant: "destructive" }),
    });
  };

  const openResponse = (versionId: string) => {
    setResponseForm({ ...blankResponse(), versionId });
    setResponseOpen(true);
  };
  const saveResponse = () => record.mutate({ residentId, ...responseForm }, {
    onSuccess: () => { setResponseOpen(false); setResponseForm(blankResponse()); toast({ title: "Agreement response recorded" }); },
    onError: (error: Error) => toast({ title: "Couldn't record response", description: error.message, variant: "destructive" }),
  });

  const createLink = () => issueGrant.mutate({
    residentId, guestLabel, versionIds: guestVersionIds,
    expiresAt: new Date(Date.now() + Number(guestDays) * 86_400_000).toISOString(),
  }, {
    onSuccess: result => {
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      setIssuedLink(`${window.location.origin}${base}/resident-agreement-access/${result.token}`);
      setShareOpen(false);
      setGuestVersionIds([]);
      toast({ title: "External signing link created" });
    },
    onError: (error: Error) => toast({ title: "Couldn't create signing link", description: error.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><CardTitle className="flex items-center gap-2"><FileSignature className="h-5 w-5" /> Resident agreements & e-signatures</CardTitle><CardDescription className="mt-1">Exact document versions, signer authority, refusals, witnesses, copy delivery, and amendments—not employee policy attestations.</CardDescription></div>
          {canManage && <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setShareOpen(true)}><Link2 className="mr-2 h-4 w-4" />External link</Button><Button size="sm" onClick={() => { setAgreementForm(blankAgreement()); setAgreementOpen(true); }}><Plus className="mr-2 h-4 w-4" />New agreement</Button></div>}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {issuedLink && <div className="flex gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-2"><Input readOnly value={issuedLink} /><Button size="icon" variant="outline" onClick={() => navigator.clipboard.writeText(issuedLink)} aria-label="Copy signing link"><Copy className="h-4 w-4" /></Button></div>}
        {query.isLoading ? <p className="text-sm text-muted-foreground">Loading resident agreements…</p> : query.isError ? <p className="text-sm text-destructive">{query.error.message}</p> : !query.data?.agreements.length ? <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">No resident agreements have been published.</p> : query.data.agreements.map(agreement => {
          const version = versionsById.get(agreement.current_version_id ?? "");
          const signatures = version ? signaturesByVersion(version.id) : [];
          return <div key={agreement.id} className="rounded-lg border p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{agreement.title}</p><Badge className={statusClass(agreement.status)}>{humanize(agreement.status)}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{humanize(agreement.agreement_type)} · Version {version?.version_label} · effective {version ? new Date(version.effective_at).toLocaleDateString() : "—"}</p>{version && <p className="mt-1 font-mono text-[11px] text-muted-foreground">SHA-256 {version.content_sha256}</p>}</div>
              {canManage && version && <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => openAmendment(agreement)}><RefreshCw className="mr-1 h-3.5 w-3.5" />Amend</Button><Button size="sm" onClick={() => openResponse(version.id)}><FileCheck2 className="mr-1 h-3.5 w-3.5" />Record response</Button></div>}
            </div>
            {version && <div className="mt-3 rounded-md bg-muted/40 p-3 text-sm whitespace-pre-wrap">{version.content_text}</div>}
            <div className="mt-3 space-y-2">{!signatures.length ? <p className="text-xs text-muted-foreground">Required: {version?.required_signer_roles.map(humanize).join(" + ")}. No responses yet.</p> : signatures.map(signature => <div key={signature.id} className="flex flex-wrap items-center justify-between gap-2 border-t pt-2 text-sm"><div><p className="font-medium">{signature.signer_name} · {humanize(signature.outcome)}</p><p className="text-xs text-muted-foreground">{humanize(signature.signer_role)} · {signature.relationship} · {humanize(signature.authentication_method)} · {new Date(signature.signed_at).toLocaleString()}</p>{signature.reason && <p className="text-xs text-muted-foreground">Reason: {signature.reason}</p>}{signature.witness_name && <p className="text-xs text-muted-foreground">Witness: {signature.witness_name}</p>}</div>{signature.copy_delivered_at ? <Badge variant="outline"><Send className="mr-1 h-3 w-3" />Copy {humanize(signature.copy_delivery_method ?? "delivered")}</Badge> : canManage && <Button size="sm" variant="ghost" onClick={() => setCopySignature(signature)}>Record copy delivery</Button>}</div>)}</div>
          </div>;
        })}

        {!!query.data?.guestGrants.length && <div><h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="h-4 w-4" />External access</h3><div className="space-y-2">{query.data.guestGrants.map(grant => <div key={grant.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"><div><p className="font-medium">{grant.guest_label}</p><p className="text-xs text-muted-foreground">{grant.allowed_version_ids.length} agreement(s) · expires {new Date(grant.expires_at).toLocaleString()}</p></div><Badge variant="outline">{grant.revoked_at ? "Revoked" : new Date(grant.expires_at) <= new Date() ? "Expired" : grant.accepted_at ? "Accepted" : "Issued"}</Badge>{canManage && !grant.revoked_at && <Button size="sm" variant="outline" onClick={() => revokeGrant.mutate({ residentId, grantId: grant.id, reason: "Facility revoked external agreement access" })}>Revoke</Button>}</div>)}</div></div>}
        {!!query.data?.history.length && <details><summary className="cursor-pointer text-sm font-semibold"><History className="mr-2 inline h-4 w-4" />Agreement history</summary><div className="mt-3 space-y-2">{query.data.history.slice(0, 15).map(event => <div key={event.id} className="flex justify-between gap-3 border-b pb-2 text-xs"><div><p className="font-medium">{humanize(event.event_type)}</p><p className="text-muted-foreground">{event.summary}</p></div><span className="shrink-0 text-muted-foreground">{new Date(event.occurred_at).toLocaleString()}</span></div>)}</div></details>}
      </CardContent>

      <Dialog open={agreementOpen} onOpenChange={setAgreementOpen}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{agreementForm.agreementId ? "Publish agreement amendment" : "Publish resident agreement"}</DialogTitle><DialogDescription>The canonical text and optional resident document are hashed into an immutable version.</DialogDescription></DialogHeader><div className="grid gap-3 sm:grid-cols-2">
        <div><Label>Agreement type</Label><Select disabled={!!agreementForm.agreementId} value={agreementForm.agreementType} onValueChange={value => setAgreementForm(current => ({ ...current, agreementType: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{RESIDENT_AGREEMENT_TYPES.map(type => <SelectItem key={type} value={type}>{humanize(type)}</SelectItem>)}</SelectContent></Select></div>
        <div><Label>Version label</Label><Input value={agreementForm.versionLabel} onChange={event => setAgreementForm(current => ({ ...current, versionLabel: event.target.value }))} /></div>
        <div className="sm:col-span-2"><Label>Title</Label><Input value={agreementForm.title} onChange={event => setAgreementForm(current => ({ ...current, title: event.target.value }))} /></div>
        <div className="sm:col-span-2"><Label>Canonical agreement text</Label><Textarea className="min-h-40" value={agreementForm.contentText} onChange={event => setAgreementForm(current => ({ ...current, contentText: event.target.value }))} /></div>
        <div><Label>Effective date and time</Label><Input type="datetime-local" value={agreementForm.effectiveAt} onChange={event => setAgreementForm(current => ({ ...current, effectiveAt: event.target.value }))} /></div>
        <div><Label>Linked resident document</Label><Select value={agreementForm.documentId} onValueChange={value => setAgreementForm(current => ({ ...current, documentId: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">No linked document</SelectItem>{documents.map(document => <SelectItem key={document.id} value={document.id}>{document.document_label ?? document.file_name}</SelectItem>)}</SelectContent></Select></div>
        <div className="sm:col-span-2"><Label>Required signers</Label><div className="mt-2 flex gap-5"><label className="flex items-center gap-2 text-sm"><Checkbox checked={agreementForm.residentRequired} onCheckedChange={checked => setAgreementForm(current => ({ ...current, residentRequired: checked === true }))} />Resident</label><label className="flex items-center gap-2 text-sm"><Checkbox checked={agreementForm.designatedRequired} onCheckedChange={checked => setAgreementForm(current => ({ ...current, designatedRequired: checked === true }))} />Designated person / legal representative</label></div></div>
        {agreementForm.agreementId && <div className="sm:col-span-2"><Label>Amendment reason *</Label><Textarea value={agreementForm.amendmentReason} onChange={event => setAgreementForm(current => ({ ...current, amendmentReason: event.target.value }))} /></div>}
      </div><DialogFooter><Button variant="outline" onClick={() => setAgreementOpen(false)}>Cancel</Button><Button disabled={publish.isPending || !agreementForm.title.trim() || agreementForm.contentText.trim().length < 10 || (!agreementForm.residentRequired && !agreementForm.designatedRequired) || (!!agreementForm.agreementId && agreementForm.amendmentReason.trim().length < 5)} onClick={saveAgreement}>{publish.isPending ? "Publishing…" : "Publish immutable version"}</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={responseOpen} onOpenChange={setResponseOpen}><DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>Record resident agreement response</DialogTitle><DialogDescription>Use this for staff-assisted signing, resident portal authentication, or imported wet-signature evidence.</DialogDescription></DialogHeader><div className="grid gap-3 sm:grid-cols-2">
        <div><Label>Outcome</Label><Select value={responseForm.outcome} onValueChange={value => setResponseForm(current => ({ ...current, outcome: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{OUTCOMES.map(value => <SelectItem key={value} value={value}>{humanize(value)}</SelectItem>)}</SelectContent></Select></div>
        <div><Label>Authentication method</Label><Select value={responseForm.authenticationMethod} onValueChange={value => setResponseForm(current => ({ ...current, authenticationMethod: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["staff_session","resident_portal","wet_signature_import"].map(value => <SelectItem key={value} value={value}>{humanize(value)}</SelectItem>)}</SelectContent></Select></div>
        <div><Label>Signer name</Label><Input value={responseForm.signerName} onChange={event => setResponseForm(current => ({ ...current, signerName: event.target.value }))} /></div>
        <div><Label>Signer role</Label><Select value={responseForm.signerRole} onValueChange={value => setResponseForm(current => ({ ...current, signerRole: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{SIGNER_ROLES.map(value => <SelectItem key={value} value={value}>{humanize(value)}</SelectItem>)}</SelectContent></Select></div>
        <div><Label>Relationship</Label><Input value={responseForm.relationship} onChange={event => setResponseForm(current => ({ ...current, relationship: event.target.value }))} /></div>
        <div><Label>Legal authority</Label><Input value={responseForm.legalAuthority} onChange={event => setResponseForm(current => ({ ...current, legalAuthority: event.target.value }))} /></div>
        <div className="sm:col-span-2"><Label>Attestation</Label><Textarea value={responseForm.attestation} onChange={event => setResponseForm(current => ({ ...current, attestation: event.target.value }))} /></div>
        {responseForm.outcome !== "signed" && <div className="sm:col-span-2"><Label>Reason *</Label><Textarea value={responseForm.reason} onChange={event => setResponseForm(current => ({ ...current, reason: event.target.value }))} /></div>}
        <div><Label>Witness name</Label><Input value={responseForm.witnessName} onChange={event => setResponseForm(current => ({ ...current, witnessName: event.target.value }))} /></div>
        <div><Label>Witness relationship</Label><Input value={responseForm.witnessRelationship} onChange={event => setResponseForm(current => ({ ...current, witnessRelationship: event.target.value }))} /></div>
      </div><DialogFooter><Button variant="outline" onClick={() => setResponseOpen(false)}>Cancel</Button><Button disabled={record.isPending || responseForm.signerName.trim().length < 2 || responseForm.relationship.trim().length < 2 || responseForm.attestation.trim().length < 5 || (responseForm.outcome !== "signed" && responseForm.reason.trim().length < 5)} onClick={saveResponse}>{record.isPending ? "Recording…" : "Record response"}</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={shareOpen} onOpenChange={setShareOpen}><DialogContent><DialogHeader><DialogTitle>Create external signing link</DialogTitle><DialogDescription>Select exact current versions. The link expires, requires terms acceptance, and records device evidence.</DialogDescription></DialogHeader><div className="space-y-3"><div><Label>Guest label</Label><Input value={guestLabel} onChange={event => setGuestLabel(event.target.value)} /></div><div><Label>Agreement versions</Label><div className="mt-2 space-y-2">{activeVersions.map(version => { const agreement = query.data?.agreements.find(item => item.id === version.agreement_id); return <label key={version.id} className="flex items-start gap-2 rounded-md border p-2 text-sm"><Checkbox checked={guestVersionIds.includes(version.id)} onCheckedChange={checked => setGuestVersionIds(current => checked ? [...current, version.id] : current.filter(id => id !== version.id))} /><span>{agreement?.title}<span className="block text-xs text-muted-foreground">Version {version.version_label} · {version.required_signer_roles.map(humanize).join(" + ")}</span></span></label>; })}</div></div><div><Label>Expires in days</Label><Input type="number" min={1} max={30} value={guestDays} onChange={event => setGuestDays(event.target.value)} /></div></div><DialogFooter><Button variant="outline" onClick={() => setShareOpen(false)}>Cancel</Button><Button disabled={issueGrant.isPending || !guestLabel.trim() || !guestVersionIds.length} onClick={createLink}>{issueGrant.isPending ? "Creating…" : "Create secure link"}</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={!!copySignature} onOpenChange={open => !open && setCopySignature(null)}><DialogContent><DialogHeader><DialogTitle>Record copy delivery</DialogTitle><DialogDescription>This can be recorded once and becomes part of the immutable signature evidence.</DialogDescription></DialogHeader><div><Label>Delivery method</Label><Select value={deliveryMethod} onValueChange={setDeliveryMethod}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["email","portal","printed","mail","in_person","other"].map(value => <SelectItem key={value} value={value}>{humanize(value)}</SelectItem>)}</SelectContent></Select></div><DialogFooter><Button variant="outline" onClick={() => setCopySignature(null)}>Cancel</Button><Button disabled={markCopy.isPending} onClick={() => copySignature && markCopy.mutate({ residentId, signatureId: copySignature.id, deliveredAt: new Date().toISOString(), deliveryMethod }, { onSuccess: () => { setCopySignature(null); toast({ title: "Copy delivery recorded" }); } })}>Record delivery now</Button></DialogFooter></DialogContent></Dialog>
    </Card>
  );
}
