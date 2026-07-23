import { useMemo, useState } from "react";
import { Copy, CreditCard, FileText, Link2, MessageSquare, ShieldCheck, UserRoundPlus, XCircle } from "lucide-react";
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
import { QueryError, QueryLoading } from "@/components/QueryState";
import {
  type ResidentPortalGrant,
  useCreateResidentPortalGrant,
  useReplyResidentPortalMessage,
  useResidentPortalManagement,
  useRevokeResidentPortalGrant,
  useSaveResidentPaymentLink,
  useShareResidentPortalDocument,
} from "@/hooks/useResidentPortal";
import { toLocalIsoDate } from "@/lib/dateUtils";
import { useToast } from "@/hooks/use-toast";

const PERMISSION_OPTIONS = [
  { value: "schedule", label: "Upcoming schedule" },
  { value: "finance", label: "Latest statement summary" },
  { value: "documents", label: "Explicitly shared document downloads" },
  { value: "messages", label: "Secure messages" },
  { value: "requests", label: "Routine requests and facility responses" },
  { value: "payments", label: "Facility-approved secure payment link" },
] as const;

function defaultExpiry() {
  const date = new Date();
  date.setDate(date.getDate() + 30);
  return toLocalIsoDate(date);
}

function grantStatus(grant: ResidentPortalGrant) {
  if (grant.revoked_at) return "Revoked";
  if (new Date(grant.expires_at).getTime() <= Date.now()) return "Expired";
  if (!grant.accepted_terms_at) return "Awaiting terms";
  return "Active";
}

export function ResidentPortalWorkspace({ residentId }: { residentId: string }) {
  const workspace = useResidentPortalManagement(residentId);
  const createGrant = useCreateResidentPortalGrant();
  const revokeGrant = useRevokeResidentPortalGrant();
  const shareDocument = useShareResidentPortalDocument();
  const reply = useReplyResidentPortalMessage();
  const savePaymentLink = useSaveResidentPaymentLink();
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [relationship, setRelationship] = useState("");
  const [email, setEmail] = useState("");
  const [expiresOn, setExpiresOn] = useState(defaultExpiry);
  const [permissions, setPermissions] = useState<string[]>(["schedule", "messages"]);
  const [generatedLink, setGeneratedLink] = useState("");
  const [revokeTarget, setRevokeTarget] = useState<ResidentPortalGrant | null>(null);
  const [revokeReason, setRevokeReason] = useState("");
  const [shareTarget, setShareTarget] = useState<ResidentPortalGrant | null>(null);
  const [documentId, setDocumentId] = useState("");
  const [documentLabel, setDocumentLabel] = useState("");
  const [replyTarget, setReplyTarget] = useState<ResidentPortalGrant | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentProvider, setPaymentProvider] = useState("");
  const [paymentUrl, setPaymentUrl] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentExpires, setPaymentExpires] = useState(defaultExpiry);

  const messagesByGrant = useMemo(() => {
    const grouped = new Map<string, NonNullable<typeof workspace.data>["messages"]>();
    for (const message of workspace.data?.messages ?? []) {
      grouped.set(message.grant_id, [...(grouped.get(message.grant_id) ?? []), message]);
    }
    return grouped;
  }, [workspace.data]);

  const submitCreate = async () => {
    try {
      const result = await createGrant.mutateAsync({
        residentId,
        designatedPersonName: name.trim(),
        relationshipLabel: relationship.trim(),
        contactEmail: email.trim() || undefined,
        permissions,
        expiresAt: new Date(`${expiresOn}T23:59:59`).toISOString(),
      });
      const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
      const link = `${window.location.origin}${basePath}/resident-portal?access=${encodeURIComponent(result.access_token)}`;
      setGeneratedLink(link);
      toast({ title: "Designated-person access created", description: "Copy the one-time link before closing this dialog." });
    } catch (error) {
      toast({ title: "Access could not be created", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    }
  };

  const resetCreate = () => {
    setCreateOpen(false); setGeneratedLink(""); setName(""); setRelationship(""); setEmail("");
    setExpiresOn(defaultExpiry()); setPermissions(["schedule", "messages"]);
  };

  const submitRevoke = async () => {
    if (!revokeTarget) return;
    try {
      await revokeGrant.mutateAsync({ grantId: revokeTarget.id, residentId, reason: revokeReason.trim() });
      setRevokeTarget(null); setRevokeReason(""); toast({ title: "Portal access revoked" });
    } catch (error) {
      toast({ title: "Access could not be revoked", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    }
  };

  const submitShare = async () => {
    if (!shareTarget || !documentId) return;
    const document = workspace.data?.residentDocuments.find((item) => item.id === documentId);
    try {
      await shareDocument.mutateAsync({ grantId: shareTarget.id, residentId, documentId, displayLabel: documentLabel.trim() || document?.document_label || document?.file_name || "Shared document", share: true });
      setShareTarget(null); setDocumentId(""); setDocumentLabel(""); toast({ title: "Document added to portal list" });
    } catch (error) {
      toast({ title: "Document could not be shared", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    }
  };

  const submitReply = async () => {
    if (!replyTarget || replyBody.trim().length < 1) return;
    try {
      await reply.mutateAsync({ grantId: replyTarget.id, residentId, body: replyBody.trim() });
      setReplyTarget(null); setReplyBody(""); toast({ title: "Portal reply sent" });
    } catch (error) {
      toast({ title: "Reply could not be sent", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    }
  };

  const submitPaymentLink = async () => {
    try {
      await savePaymentLink.mutateAsync({ residentId, providerName: paymentProvider.trim(), secureUrl: paymentUrl.trim(), amountDue: Number(paymentAmount), expiresAt: new Date(`${paymentExpires}T23:59:59`).toISOString() });
      setPaymentOpen(false); setPaymentProvider(""); setPaymentUrl(""); setPaymentAmount(""); setPaymentExpires(defaultExpiry());
      toast({ title: "Secure resident payment link saved" });
    } catch (error) {
      toast({ title: "Payment link could not be saved", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    }
  };

  if (workspace.isLoading) return <QueryLoading what="designated-person portal" />;
  if (workspace.isError) return <QueryError what="designated-person portal" error={workspace.error} onRetry={() => workspace.refetch()} />;
  if (!workspace.data) return null;
  const portalData = workspace.data;

  return (
    <Card>
      <CardHeader><div className="flex flex-wrap items-start justify-between gap-4"><div><CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5" />Designated-Person Portal</CardTitle><CardDescription>Issue expiring, consent-gated access to selected resident summaries. Every access, request, response, and download is logged.</CardDescription></div><div className="flex gap-2"><Button variant="outline" onClick={() => setPaymentOpen(true)}><CreditCard className="mr-2 h-4 w-4" />Payment link</Button><Button onClick={() => setCreateOpen(true)}><UserRoundPlus className="mr-2 h-4 w-4" />Create access</Button></div></div></CardHeader>
      <CardContent className="space-y-4">
        <Alert><Link2 className="h-4 w-4" /><AlertTitle>Least-privilege sharing</AlertTitle><AlertDescription>Choose only the categories this person needs. Document access is explicit per grant, and the generated link is shown once.</AlertDescription></Alert>
        {portalData.grants.length === 0 ? <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">No designated-person access has been issued.</div> : portalData.grants.map((grant) => {
          const status = grantStatus(grant);
          const active = status === "Active" || status === "Awaiting terms";
          const messages = messagesByGrant.get(grant.id) ?? [];
          const unread = messages.filter((message) => message.direction === "designated_person_to_facility" && !message.read_at).length;
          const shared = portalData.sharedDocuments.filter((item) => item.grant_id === grant.id && !item.withdrawn_at).length;
          return <div key={grant.id} className="rounded-md border p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-medium">{grant.designated_person_name}</p><p className="text-sm text-muted-foreground">{grant.relationship_label}{grant.contact_email ? ` · ${grant.contact_email}` : ""}</p><div className="mt-2 flex flex-wrap gap-1">{grant.permissions.map((permission) => <Badge key={permission} variant="outline">{permission}</Badge>)}</div></div><Badge variant={status === "Active" ? "outline" : active ? "secondary" : "destructive"}>{status}</Badge></div><div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3"><span>Expires {new Date(grant.expires_at).toLocaleString()}</span><span>{shared} shared document{shared === 1 ? "" : "s"}</span><span>{unread} unread message{unread === 1 ? "" : "s"}</span></div>{active && <div className="mt-3 flex flex-wrap gap-2">{grant.permissions.includes("documents") && <Button size="sm" variant="outline" onClick={() => setShareTarget(grant)}><FileText className="mr-1 h-4 w-4" />Share document</Button>}{grant.permissions.includes("messages") && <Button size="sm" variant="outline" onClick={() => setReplyTarget(grant)}><MessageSquare className="mr-1 h-4 w-4" />Reply</Button>}<Button size="sm" variant="outline" onClick={() => setRevokeTarget(grant)}><XCircle className="mr-1 h-4 w-4" />Revoke</Button></div>}{messages[0] && <p className="mt-3 rounded bg-muted p-2 text-sm"><span className="font-medium">Latest message:</span> {messages[0].body}</p>}</div>;
        })}
      </CardContent>

      <Dialog open={createOpen} onOpenChange={(open) => open ? setCreateOpen(true) : resetCreate()}><DialogContent><DialogHeader><DialogTitle>Create designated-person access</DialogTitle><DialogDescription>The person must accept the current portal terms before any resident information appears.</DialogDescription></DialogHeader>{generatedLink ? <div className="space-y-3"><Alert><ShieldCheck className="h-4 w-4" /><AlertTitle>One-time access link</AlertTitle><AlertDescription>This raw token is not stored. Copy it now and send it through an approved secure channel.</AlertDescription></Alert><div className="flex gap-2"><Input aria-label="Generated portal link" readOnly value={generatedLink} /><Button type="button" size="icon" variant="outline" aria-label="Copy portal link" onClick={() => { void navigator.clipboard.writeText(generatedLink); toast({ title: "Portal link copied" }); }}><Copy className="h-4 w-4" /></Button></div></div> : <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="portal-name">Designated person</Label><Input id="portal-name" value={name} onChange={(event) => setName(event.target.value)} /></div><div className="space-y-2"><Label htmlFor="portal-relationship">Relationship / authority</Label><Input id="portal-relationship" value={relationship} onChange={(event) => setRelationship(event.target.value)} /></div><div className="space-y-2"><Label htmlFor="portal-email">Email (reference only)</Label><Input id="portal-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></div><div className="space-y-2"><Label htmlFor="portal-expiry">Expires on</Label><Input id="portal-expiry" type="date" value={expiresOn} onChange={(event) => setExpiresOn(event.target.value)} /></div><fieldset className="space-y-2 sm:col-span-2"><legend className="text-sm font-medium">Allowed information</legend>{PERMISSION_OPTIONS.map((option) => <label key={option.value} className="flex items-center gap-2 text-sm"><Checkbox checked={permissions.includes(option.value)} onCheckedChange={(checked) => setPermissions((current) => checked === true ? [...current, option.value] : current.filter((value) => value !== option.value))} /><span>{option.label}</span></label>)}</fieldset></div>}<DialogFooter><Button variant="outline" onClick={resetCreate}>{generatedLink ? "Done" : "Cancel"}</Button>{!generatedLink && <Button disabled={createGrant.isPending || name.trim().length < 2 || relationship.trim().length < 2 || permissions.length === 0 || !expiresOn} onClick={() => void submitCreate()}>{createGrant.isPending ? "Creating…" : "Create access"}</Button>}</DialogFooter></DialogContent></Dialog>

      <Dialog open={!!revokeTarget} onOpenChange={(open) => !open && setRevokeTarget(null)}><DialogContent><DialogHeader><DialogTitle>Revoke portal access</DialogTitle><DialogDescription>The link will stop working immediately. Existing access documentation remains append-only.</DialogDescription></DialogHeader><div className="space-y-2"><Label htmlFor="portal-revoke-reason">Reason</Label><Textarea id="portal-revoke-reason" value={revokeReason} onChange={(event) => setRevokeReason(event.target.value)} /></div><DialogFooter><Button variant="outline" onClick={() => setRevokeTarget(null)}>Cancel</Button><Button variant="destructive" disabled={revokeGrant.isPending || revokeReason.trim().length < 5} onClick={() => void submitRevoke()}>Revoke access</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={!!shareTarget} onOpenChange={(open) => !open && setShareTarget(null)}><DialogContent><DialogHeader><DialogTitle>Share document listing</DialogTitle><DialogDescription>The portal will show the selected document metadata only. Do not use this for documents that require a different disclosure workflow.</DialogDescription></DialogHeader><div className="space-y-4"><div className="space-y-2"><Label>Resident document</Label><Select value={documentId} onValueChange={(value) => { setDocumentId(value); const document = portalData.residentDocuments.find((item) => item.id === value); setDocumentLabel(document?.document_label || document?.file_name || ""); }}><SelectTrigger><SelectValue placeholder="Select document" /></SelectTrigger><SelectContent>{portalData.residentDocuments.map((document) => <SelectItem key={document.id} value={document.id}>{document.document_label || document.file_name}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label htmlFor="portal-document-label">Portal label</Label><Input id="portal-document-label" value={documentLabel} onChange={(event) => setDocumentLabel(event.target.value)} /></div></div><DialogFooter><Button variant="outline" onClick={() => setShareTarget(null)}>Cancel</Button><Button disabled={shareDocument.isPending || !documentId || documentLabel.trim().length < 2} onClick={() => void submitShare()}>Share listing</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={!!replyTarget} onOpenChange={(open) => !open && setReplyTarget(null)}><DialogContent><DialogHeader><DialogTitle>Reply in portal</DialogTitle><DialogDescription>This message will be visible only through the active, consented portal grant.</DialogDescription></DialogHeader><div className="space-y-2"><Label htmlFor="portal-reply">Message</Label><Textarea id="portal-reply" value={replyBody} onChange={(event) => setReplyBody(event.target.value)} /></div><DialogFooter><Button variant="outline" onClick={() => setReplyTarget(null)}>Cancel</Button><Button disabled={reply.isPending || replyBody.trim().length < 1} onClick={() => void submitReply()}>Send reply</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={paymentOpen} onOpenChange={setPaymentOpen}><DialogContent><DialogHeader><DialogTitle>Secure resident payment link</DialogTitle><DialogDescription>Use only a facility-approved HTTPS payment provider. CareBase displays the link but never handles card or bank details.</DialogDescription></DialogHeader><div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="portal-payment-provider">Provider</Label><Input id="portal-payment-provider" value={paymentProvider} onChange={(event) => setPaymentProvider(event.target.value)} placeholder="Approved payment portal" /></div><div className="space-y-2"><Label htmlFor="portal-payment-amount">Amount due</Label><Input id="portal-payment-amount" type="number" min="0" step="0.01" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} /></div><div className="space-y-2 sm:col-span-2"><Label htmlFor="portal-payment-url">Secure HTTPS URL</Label><Input id="portal-payment-url" type="url" value={paymentUrl} onChange={(event) => setPaymentUrl(event.target.value)} placeholder="https://payments.example.com/..." /></div><div className="space-y-2"><Label htmlFor="portal-payment-expiry">Expires on</Label><Input id="portal-payment-expiry" type="date" value={paymentExpires} onChange={(event) => setPaymentExpires(event.target.value)} /></div></div><DialogFooter><Button variant="outline" onClick={() => setPaymentOpen(false)}>Cancel</Button><Button disabled={savePaymentLink.isPending || paymentProvider.trim().length < 2 || !paymentUrl.startsWith("https://") || Number(paymentAmount) < 0 || !paymentExpires} onClick={() => void submitPaymentLink()}>{savePaymentLink.isPending ? "Saving…" : "Save payment link"}</Button></DialogFooter></DialogContent></Dialog>
    </Card>
  );
}
