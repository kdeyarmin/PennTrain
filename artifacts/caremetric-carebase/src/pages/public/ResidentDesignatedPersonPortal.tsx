import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CalendarDays, FileText, Landmark, Loader2, LockKeyhole, MessageSquare, ShieldCheck } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  acceptResidentPortalTerms,
  getResidentPortalSnapshot,
  postResidentPortalMessage,
} from "@/hooks/useResidentPortal";

const SESSION_TOKEN_KEY = "carebase-resident-portal-token";

function loadAccessToken() {
  const queryToken = new URLSearchParams(window.location.search).get("access")?.trim() ?? "";
  if (queryToken) {
    sessionStorage.setItem(SESSION_TOKEN_KEY, queryToken);
    window.history.replaceState(null, "", "/resident-portal");
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
  const snapshot = useQuery({
    queryKey: ["resident-designated-person-portal", token],
    enabled: token.length >= 32,
    queryFn: () => getResidentPortalSnapshot(token),
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

  const data = snapshot.data;
  const invalid = !token || snapshot.isError || data?.accessStatus === "invalid";
  const tabs = [
    data?.permissions?.includes("schedule") ? "schedule" : null,
    data?.permissions?.includes("finance") ? "finance" : null,
    data?.permissions?.includes("documents") ? "documents" : null,
    data?.permissions?.includes("messages") ? "messages" : null,
  ].filter((value): value is string => Boolean(value));

  return (
    <div className="min-h-screen bg-muted/30 px-4 py-10">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="text-center"><LockKeyhole className="mx-auto mb-3 h-10 w-10 text-primary" /><h1 className="text-2xl font-bold">Secure Designated-Person Portal</h1><p className="text-muted-foreground">Expiring, permission-limited access provided by the resident's facility.</p></div>

        {snapshot.isLoading ? <div className="flex justify-center py-16" role="status"><Loader2 className="h-8 w-8 animate-spin" /><span className="sr-only">Loading secure portal</span></div> : invalid ? <Alert variant="destructive"><AlertTitle>Access link unavailable</AlertTitle><AlertDescription>This link is invalid, expired, or revoked. Contact the facility if you still need access. For privacy, close this browser tab.</AlertDescription></Alert> : data?.accessStatus === "terms_required" ? <Card><CardHeader><CardTitle role="heading" aria-level={2}>Review portal terms</CardTitle><CardDescription>Accept the current terms before resident information is displayed.</CardDescription></CardHeader><CardContent className="space-y-4"><Alert><ShieldCheck className="h-4 w-4" /><AlertTitle>Limited and monitored access</AlertTitle><AlertDescription>Use this portal only for your authorized role. Do not share the link. Access and messages are logged, and the facility may revoke access at any time. This portal is not for emergencies or urgent clinical instructions.</AlertDescription></Alert><label className="flex items-start gap-2 text-sm"><Checkbox checked={termsAccepted} onCheckedChange={(checked) => setTermsAccepted(checked === true)} /><span>I agree to use this portal only for the authorized resident and purposes, protect the access link, and contact emergency services or the facility directly for urgent needs.</span></label>{acceptTerms.isError && <p className="text-sm text-destructive">{acceptTerms.error.message}</p>}<Button className="w-full" disabled={!termsAccepted || acceptTerms.isPending} onClick={() => acceptTerms.mutate()}>{acceptTerms.isPending ? "Accepting…" : "Accept and continue"}</Button></CardContent></Card> : data?.accessStatus === "active" ? <>
          <Card><CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle role="heading" aria-level={2}>{data.resident?.displayName}</CardTitle><CardDescription>{data.facility?.name}{data.resident?.room ? ` · Room ${data.resident.room}` : ""}</CardDescription></div><Badge variant="outline">Expires {data.expiresAt ? new Date(data.expiresAt).toLocaleDateString() : "soon"}</Badge></div></CardHeader><CardContent className="text-sm text-muted-foreground"><p>Access issued to {data.designatedPersonName} ({data.relationship}).</p>{data.facility?.phone && <p className="mt-1">Facility phone: {data.facility.phone}</p>}<p className="mt-3 font-medium text-foreground">For emergencies, call 911. Do not use portal messaging for urgent clinical needs.</p></CardContent></Card>

          <Tabs defaultValue={tabs[0]}><TabsList className="flex h-auto flex-wrap justify-start">{tabs.includes("schedule") && <TabsTrigger value="schedule"><CalendarDays className="mr-1 h-4 w-4" />Schedule</TabsTrigger>}{tabs.includes("finance") && <TabsTrigger value="finance"><Landmark className="mr-1 h-4 w-4" />Finance</TabsTrigger>}{tabs.includes("documents") && <TabsTrigger value="documents"><FileText className="mr-1 h-4 w-4" />Documents</TabsTrigger>}{tabs.includes("messages") && <TabsTrigger value="messages"><MessageSquare className="mr-1 h-4 w-4" />Messages</TabsTrigger>}</TabsList>
            <TabsContent value="schedule" className="space-y-3">{data.schedule?.length ? data.schedule.map((event) => <Card key={event.id}><CardContent className="p-4"><p className="font-medium">{event.title}</p><p className="text-sm text-muted-foreground">{new Date(event.startsAt).toLocaleString()} – {new Date(event.endsAt).toLocaleTimeString()}</p>{event.locationName && <p className="mt-1 text-sm">{event.locationName}</p>}{event.preparationInstructions && <p className="mt-2 rounded bg-muted p-2 text-sm">Preparation: {event.preparationInstructions}</p>}</CardContent></Card>) : <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">No upcoming shared schedule items.</CardContent></Card>}</TabsContent>
            <TabsContent value="finance"><Card><CardHeader><CardTitle>Latest statement summary</CardTitle><CardDescription>Contact the facility for statement documents, transaction detail, or payment questions.</CardDescription></CardHeader><CardContent>{data.finance ? <div className="grid gap-3 sm:grid-cols-2"><div><p className="text-xs text-muted-foreground">Statement</p><p className="font-medium">{data.finance.statementNumber}</p></div><div><p className="text-xs text-muted-foreground">Issued</p><p>{new Date(data.finance.issuedOn).toLocaleDateString()}</p></div><div><p className="text-xs text-muted-foreground">Due date</p><p>{new Date(data.finance.dueDate).toLocaleDateString()}</p></div><div><p className="text-xs text-muted-foreground">Balance due</p><p className="font-medium">{money(data.finance.balanceDue)}</p></div></div> : <p className="text-sm text-muted-foreground">No statement summary is available.</p>}</CardContent></Card></TabsContent>
            <TabsContent value="documents" className="space-y-3"><Alert><FileText className="h-4 w-4" /><AlertTitle>Shared document index</AlertTitle><AlertDescription>This list confirms what the facility has shared. Contact the facility through an approved channel to receive document contents.</AlertDescription></Alert>{data.documents?.length ? data.documents.map((document) => <Card key={document.id}><CardContent className="p-4"><p className="font-medium">{document.displayLabel}</p><p className="text-sm text-muted-foreground">{document.fileName} · Shared {new Date(document.sharedAt).toLocaleDateString()}</p></CardContent></Card>) : <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">No documents have been shared with this access grant.</CardContent></Card>}</TabsContent>
            <TabsContent value="messages" className="space-y-4"><Card><CardHeader><CardTitle>Messages</CardTitle><CardDescription>Routine messages only. The facility receives a notification when you send a message.</CardDescription></CardHeader><CardContent className="space-y-3">{data.messages?.length ? data.messages.map((item) => <div key={item.id} className={`rounded-md p-3 text-sm ${item.direction === "designated_person_to_facility" ? "ml-8 bg-primary/10" : "mr-8 bg-muted"}`}><p className="mb-1 text-xs font-medium text-muted-foreground">{item.direction === "designated_person_to_facility" ? "You" : "Facility"} · {new Date(item.createdAt).toLocaleString()}</p><p className="whitespace-pre-wrap">{item.body}</p></div>) : <p className="text-sm text-muted-foreground">No messages yet.</p>}<div className="space-y-2 border-t pt-4"><Label htmlFor="portal-public-message">New routine message</Label><Textarea id="portal-public-message" value={message} onChange={(event) => setMessage(event.target.value)} maxLength={5000} />{sendMessage.isError && <p className="text-sm text-destructive">{sendMessage.error.message}</p>}<Button disabled={sendMessage.isPending || message.trim().length < 1} onClick={() => sendMessage.mutate()}>{sendMessage.isPending ? "Sending…" : "Send message"}</Button></div></CardContent></Card></TabsContent>
          </Tabs>
        </> : null}
        <p className="text-center text-xs text-muted-foreground">CareBase secure portal · Close this tab when finished</p>
      </div>
    </div>
  );
}
