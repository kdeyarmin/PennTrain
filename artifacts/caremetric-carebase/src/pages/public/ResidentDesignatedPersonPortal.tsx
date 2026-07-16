import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CalendarDays, CreditCard, Download, FileText, Landmark, Loader2, LockKeyhole, MessageSquare, Send, ShieldCheck } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  acceptResidentPortalTerms, getResidentPortalDocumentDownload, getResidentPortalExperience,
  postResidentPortalMessage, postResidentPortalRequest, respondResidentPortalSchedule,
} from "@/hooks/useResidentPortal";

const SESSION_TOKEN_KEY = "carebase-resident-portal-token";

function loadAccessToken() {
  const url = new URL(window.location.href);
  const queryToken = url.searchParams.get("access")?.trim() ?? "";
  if (queryToken) {
    sessionStorage.setItem(SESSION_TOKEN_KEY, queryToken);
    url.searchParams.delete("access");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    return queryToken;
  }
  return sessionStorage.getItem(SESSION_TOKEN_KEY) ?? "";
}

function money(value: number) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(Number(value));
}

export default function ResidentDesignatedPersonPortal() {
  const [token] = useState(loadAccessToken);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [message, setMessage] = useState("");
  const [requestType, setRequestType] = useState("general");
  const [requestSubject, setRequestSubject] = useState("");
  const [requestDetail, setRequestDetail] = useState("");
  const snapshot = useQuery({
    queryKey: ["resident-designated-person-portal", token],
    enabled: token.length >= 32,
    queryFn: () => getResidentPortalExperience(token),
    retry: false,
  });
  const acceptTerms = useMutation({
    mutationFn: async () => {
      if (!snapshot.data?.termsVersion) throw new Error("Portal terms are unavailable.");
      const accepted = await acceptResidentPortalTerms(token, snapshot.data.termsVersion);
      if (!accepted) throw new Error("This access link is no longer available.");
    },
    onSuccess: () => void snapshot.refetch(),
  });
  const sendMessage = useMutation({
    mutationFn: async () => {
      const sent = await postResidentPortalMessage(token, message.trim());
      if (!sent) throw new Error("Messaging is not available for this access link.");
    },
    onSuccess: () => { setMessage(""); void snapshot.refetch(); },
  });
  const sendRequest = useMutation({
    mutationFn: () => postResidentPortalRequest(token, requestType, requestSubject.trim(), requestDetail.trim()),
    onSuccess: () => { setRequestSubject(""); setRequestDetail(""); void snapshot.refetch(); },
  });
  const respondToSchedule = useMutation({
    mutationFn: ({ eventId, response }: { eventId: string; response: string }) => respondResidentPortalSchedule(token, eventId, response),
    onSuccess: () => void snapshot.refetch(),
  });
  const downloadDocument = useMutation({
    mutationFn: async (sharedDocumentId: string) => {
      const result = await getResidentPortalDocumentDownload(token, sharedDocumentId);
      window.location.assign(result.url);
    },
  });

  const data = snapshot.data;
  const invalid = !token || snapshot.isError || data?.accessStatus === "invalid";
  const tabs = ["schedule", "finance", "documents", "messages", "requests", "payments"]
    .filter((permission) => data?.permissions?.includes(permission));

  return <div className="min-h-screen bg-muted/30 px-4 py-10"><div className="mx-auto max-w-4xl space-y-6">
    <div className="text-center"><LockKeyhole className="mx-auto mb-3 h-10 w-10 text-primary" /><h1 className="text-2xl font-bold">Secure Designated-Person Portal</h1><p className="text-muted-foreground">Expiring, permission-limited access provided by the resident&apos;s facility.</p></div>

    {snapshot.isLoading ? <div className="flex justify-center py-16" role="status"><Loader2 className="h-8 w-8 animate-spin" /><span className="sr-only">Loading secure portal</span></div>
      : invalid ? <Alert variant="destructive"><AlertTitle>Access link unavailable</AlertTitle><AlertDescription>This link is invalid, expired, or revoked. Contact the facility if you still need access. For privacy, close this browser tab.</AlertDescription></Alert>
      : data?.accessStatus === "terms_required" ? <Card><CardHeader><CardTitle>Review portal terms</CardTitle><CardDescription>Accept the current terms before resident information is displayed.</CardDescription></CardHeader><CardContent className="space-y-4"><Alert><ShieldCheck className="h-4 w-4" /><AlertTitle>Limited and monitored access</AlertTitle><AlertDescription>Use this portal only for your authorized role. Do not share the link. Access, messages, requests, schedule responses, and downloads are logged. This portal is not for emergencies.</AlertDescription></Alert><label className="flex items-start gap-2 text-sm"><Checkbox checked={termsAccepted} onCheckedChange={(checked) => setTermsAccepted(checked === true)} /><span>I agree to use this portal only for the authorized resident and purposes, protect the access link, and contact emergency services or the facility directly for urgent needs.</span></label>{acceptTerms.isError && <p className="text-sm text-destructive">{acceptTerms.error.message}</p>}<Button className="w-full" disabled={!termsAccepted || acceptTerms.isPending} onClick={() => acceptTerms.mutate()}>{acceptTerms.isPending ? "Accepting…" : "Accept and continue"}</Button></CardContent></Card>
      : data?.accessStatus === "active" ? <>
        <Card><CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle>{data.resident?.displayName}</CardTitle><CardDescription>{data.facility?.name}{data.resident?.room ? ` · Room ${data.resident.room}` : ""}</CardDescription></div><Badge variant="outline">Expires {data.expiresAt ? new Date(data.expiresAt).toLocaleDateString() : "soon"}</Badge></div></CardHeader><CardContent className="text-sm text-muted-foreground"><p>Access issued to {data.designatedPersonName} ({data.relationship}).</p>{data.facility?.phone && <p className="mt-1">Facility phone: {data.facility.phone}</p>}<p className="mt-3 font-medium text-foreground">For emergencies, call 911. Do not use portal workflows for urgent clinical needs.</p></CardContent></Card>
        <Tabs defaultValue={tabs[0]}><TabsList className="flex h-auto flex-wrap justify-start">
          {tabs.includes("schedule") && <TabsTrigger value="schedule"><CalendarDays className="mr-1 h-4 w-4" />Schedule</TabsTrigger>}
          {tabs.includes("finance") && <TabsTrigger value="finance"><Landmark className="mr-1 h-4 w-4" />Finance</TabsTrigger>}
          {tabs.includes("documents") && <TabsTrigger value="documents"><FileText className="mr-1 h-4 w-4" />Documents</TabsTrigger>}
          {tabs.includes("messages") && <TabsTrigger value="messages"><MessageSquare className="mr-1 h-4 w-4" />Messages</TabsTrigger>}
          {tabs.includes("requests") && <TabsTrigger value="requests"><Send className="mr-1 h-4 w-4" />Requests</TabsTrigger>}
          {tabs.includes("payments") && <TabsTrigger value="payments"><CreditCard className="mr-1 h-4 w-4" />Payment</TabsTrigger>}
        </TabsList>

          <TabsContent value="schedule" className="space-y-3">{data.schedule?.length ? data.schedule.map((event) => <Card key={event.id}><CardContent className="p-4"><p className="font-medium">{event.title}</p><p className="text-sm text-muted-foreground">{new Date(event.startsAt).toLocaleString()} – {new Date(event.endsAt).toLocaleTimeString()}</p>{event.locationName && <p className="mt-1 text-sm">{event.locationName}</p>}{event.preparationInstructions && <p className="mt-2 rounded bg-muted p-2 text-sm">Preparation: {event.preparationInstructions}</p>}<div className="mt-3 flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={respondToSchedule.isPending} onClick={() => respondToSchedule.mutate({ eventId: event.id, response: "confirmed" })}>Confirm</Button><Button size="sm" variant="outline" disabled={respondToSchedule.isPending} onClick={() => respondToSchedule.mutate({ eventId: event.id, response: "needs_change" })}>Request change</Button><Button size="sm" variant="outline" disabled={respondToSchedule.isPending} onClick={() => respondToSchedule.mutate({ eventId: event.id, response: "cannot_attend" })}>Cannot attend</Button></div></CardContent></Card>) : <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">No upcoming shared schedule items.</CardContent></Card>}</TabsContent>

          <TabsContent value="finance"><Card><CardHeader><CardTitle>Latest statement summary</CardTitle><CardDescription>Contact the facility for statement documents or transaction detail.</CardDescription></CardHeader><CardContent>{data.finance ? <div className="grid gap-3 sm:grid-cols-2"><div><p className="text-xs text-muted-foreground">Statement</p><p className="font-medium">{data.finance.statementNumber}</p></div><div><p className="text-xs text-muted-foreground">Due date</p><p>{new Date(data.finance.dueDate).toLocaleDateString()}</p></div><div><p className="text-xs text-muted-foreground">Balance due</p><p className="font-medium">{money(data.finance.balanceDue)}</p></div><div><p className="text-xs text-muted-foreground">Delinquent</p><p>{money(data.finance.delinquentAmount)}</p></div></div> : <p className="text-sm text-muted-foreground">No statement summary is available.</p>}</CardContent></Card></TabsContent>

          <TabsContent value="documents" className="space-y-3"><Alert><FileText className="h-4 w-4" /><AlertTitle>Secure shared documents</AlertTitle><AlertDescription>Each download is reauthorized, logged, and delivered through a five-minute signed link. Do not save documents to a shared device.</AlertDescription></Alert>{data.documents?.length ? data.documents.map((document) => <Card key={document.id}><CardContent className="flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="font-medium">{document.displayLabel}</p><p className="text-sm text-muted-foreground">{document.fileName} · Shared {new Date(document.sharedAt).toLocaleDateString()}</p></div><Button size="sm" variant="outline" disabled={downloadDocument.isPending} onClick={() => downloadDocument.mutate(document.id)}>{downloadDocument.isPending && downloadDocument.variables === document.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}Download</Button></CardContent></Card>) : <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">No documents have been shared with this grant.</CardContent></Card>}{downloadDocument.isError && <p className="text-sm text-destructive">{downloadDocument.error.message}</p>}</TabsContent>

          <TabsContent value="messages"><Card><CardHeader><CardTitle>Messages</CardTitle><CardDescription>Routine messages only. The facility receives a notification.</CardDescription></CardHeader><CardContent className="space-y-3">{data.messages?.map((item) => <div key={item.id} className={`rounded-md p-3 text-sm ${item.direction === "designated_person_to_facility" ? "ml-8 bg-primary/10" : "mr-8 bg-muted"}`}><p className="mb-1 text-xs font-medium text-muted-foreground">{item.direction === "designated_person_to_facility" ? "You" : "Facility"} · {new Date(item.createdAt).toLocaleString()}</p><p className="whitespace-pre-wrap">{item.body}</p></div>)}<div className="space-y-2 border-t pt-4"><Label htmlFor="portal-message">New routine message</Label><Textarea id="portal-message" value={message} onChange={(event) => setMessage(event.target.value)} maxLength={5000} />{sendMessage.isError && <p className="text-sm text-destructive">{sendMessage.error.message}</p>}<Button disabled={sendMessage.isPending || !message.trim()} onClick={() => sendMessage.mutate()}>{sendMessage.isPending ? "Sending…" : "Send message"}</Button></div></CardContent></Card></TabsContent>

          <TabsContent value="requests" className="space-y-4"><Card><CardHeader><CardTitle>Routine facility request</CardTitle><CardDescription>Request a document, ask a billing question, or propose a schedule change.</CardDescription></CardHeader><CardContent className="space-y-3"><Select value={requestType} onValueChange={setRequestType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["general","service_request","document_request","payment_question","schedule_change"].map((item) => <SelectItem key={item} value={item}>{item.replaceAll("_", " ")}</SelectItem>)}</SelectContent></Select><Input value={requestSubject} maxLength={200} onChange={(event) => setRequestSubject(event.target.value)} placeholder="Request subject" /><Textarea value={requestDetail} maxLength={5000} onChange={(event) => setRequestDetail(event.target.value)} placeholder="What does the facility need to know?" />{sendRequest.isError && <p className="text-sm text-destructive">{sendRequest.error.message}</p>}<Button disabled={sendRequest.isPending || requestSubject.trim().length < 3 || requestDetail.trim().length < 3} onClick={() => sendRequest.mutate()}>{sendRequest.isPending ? "Sending…" : "Submit request"}</Button></CardContent></Card>{data.requests?.map((item) => <Card key={item.id}><CardContent className="p-4"><div className="flex justify-between gap-2"><p className="font-medium">{item.subject}</p><Badge variant="outline">{item.status.replaceAll("_", " ")}</Badge></div><p className="mt-1 text-sm text-muted-foreground">{item.detail}</p>{item.facilityResponse && <p className="mt-3 rounded bg-muted p-3 text-sm"><strong>Facility response:</strong> {item.facilityResponse}</p>}</CardContent></Card>)}</TabsContent>

          <TabsContent value="payments"><Card><CardHeader><CardTitle>Secure payment</CardTitle><CardDescription>The facility controls the approved payment provider. CareBase does not collect or store card or bank details.</CardDescription></CardHeader><CardContent>{data.payment ? <div className="space-y-4"><div><p className="text-sm text-muted-foreground">Amount due</p><p className="text-3xl font-bold">{money(data.payment.amountDue)}</p><p className="text-xs text-muted-foreground">Link expires {new Date(data.payment.expiresAt).toLocaleString()}</p></div><Button asChild><a href={data.payment.secureUrl} target="_blank" rel="noreferrer">Continue to {data.payment.providerName}</a></Button></div> : <p className="text-sm text-muted-foreground">No active payment link is available. Contact the facility with billing questions.</p>}</CardContent></Card></TabsContent>
        </Tabs>
      </> : null}
    <p className="text-center text-xs text-muted-foreground">CareBase secure portal · Close this tab when finished</p>
  </div></div>;
}
