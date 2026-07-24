import { useEffect, useState } from "react";
import { useParams } from "wouter";
import { CheckCircle2, FileSignature, Loader2, LockKeyhole } from "lucide-react";
import {
  useAcceptMoveInGuestTerms,
  useMoveInGuestWorkspace,
  useSignMoveInGuestTask,
} from "@/hooks/useAdmissions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { clearStoredPublicAccessToken, consumePublicAccessToken } from "@/lib/publicAccessToken";

const SESSION_TOKEN_KEY = "carebase-move-in-guest-token";

export default function MoveInGuestPortal() {
  const { token: routeToken } = useParams<{ token?: string }>();
  const [token] = useState(() => consumePublicAccessToken(
    routeToken,
    SESSION_TOKEN_KEY,
    "/move-in-access",
  ));
  const workspace = useMoveInGuestWorkspace(token);
  const accept = useAcceptMoveInGuestTerms();
  const sign = useSignMoveInGuestTask();
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [acceptedLocally, setAcceptedLocally] = useState(false);
  const [taskId, setTaskId] = useState("");
  const [signerName, setSignerName] = useState("");
  const [relationship, setRelationship] = useState("");
  const [attestation, setAttestation] = useState("");

  const acceptTerms = () => {
    if (!token) return;
    accept.mutate(token, { onSuccess: () => setAcceptedLocally(true) });
  };

  const signTask = () => {
    if (!token || !taskId) return;
    sign.mutate({ token, taskId, signerName, relationship, attestation }, {
      onSuccess: () => {
        setTaskId("");
        setSignerName("");
        setRelationship("");
        setAttestation("");
      },
    });
  };

  const needsTerms = !acceptedLocally && workspace.isError;

  // The move-in workspace RPC signals both "terms not accepted" and "token
  // invalid/expired" as coded 42501s, so a pre-terms error is ambiguous. Once
  // terms were accepted in this tab, a persisting coded error is the server
  // rejecting the token itself -- drop the stored copy so it is not replayed.
  // Uncoded (network) failures never clear.
  const serverRejected =
    acceptedLocally && workspace.isError &&
    typeof (workspace.error as { code?: unknown } | null)?.code === "string";
  useEffect(() => {
    if (serverRejected) clearStoredPublicAccessToken(SESSION_TOKEN_KEY);
  }, [serverRejected]);

  return (
    <div className="min-h-screen bg-muted/30 px-4 py-10">
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="text-center">
          <LockKeyhole className="mx-auto mb-3 h-10 w-10 text-primary" />
          <h1 className="text-2xl font-bold">Secure move-in collaboration</h1>
          <p className="text-muted-foreground">Your link is expiring and limited to selected admission tasks.</p>
        </div>

        {needsTerms ? (
          <Card>
            <CardHeader><CardTitle>Review guest access terms</CardTitle><CardDescription>Accept the current terms before viewing or signing admission tasks.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <Alert><LockKeyhole className="h-4 w-4" /><AlertTitle>Task-scoped access</AlertTitle><AlertDescription>You may access only the tasks selected by the facility. Every view and signature is recorded.</AlertDescription></Alert>
              <label className="flex items-start gap-2 text-sm"><Checkbox checked={termsAccepted} onCheckedChange={checked => setTermsAccepted(checked === true)} /><span>I agree to use this link only for the named resident's admission process and understand my actions are logged.</span></label>
              <Button className="w-full" disabled={!termsAccepted || accept.isPending} onClick={acceptTerms}>{accept.isPending ? "Accepting..." : "Accept and continue"}</Button>
              {accept.isError && <p className="text-sm text-destructive">{accept.error.message}</p>}
            </CardContent>
          </Card>
        ) : workspace.isLoading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin" /></div>
        ) : workspace.isError || !workspace.data ? (
          <Alert variant="destructive"><AlertTitle>Guest link unavailable</AlertTitle><AlertDescription>This link is invalid, expired, revoked, or has not accepted the current terms.</AlertDescription></Alert>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle>{workspace.data.residentName} move-in tasks</CardTitle>
                <CardDescription>Access for {workspace.data.guestLabel} expires {new Date(workspace.data.expiresAt).toLocaleString()}.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {workspace.data.tasks.map(task => (
                  <div key={task.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-4">
                    <div>
                      <p className="font-medium">{task.title}</p>
                      <div className="mt-1 flex gap-2">
                        {task.requiresSignature && <Badge variant="outline"><FileSignature className="mr-1 h-3 w-3" />Signature required</Badge>}
                        {task.requiresDocument && <Badge variant="outline">Document requested</Badge>}
                      </div>
                    </div>
                    {task.signed ? (
                      <Badge className="bg-emerald-100 text-emerald-900"><CheckCircle2 className="mr-1 h-3 w-3" />Signed</Badge>
                    ) : task.requiresSignature ? (
                      <Button size="sm" onClick={() => setTaskId(task.id)}>Review and sign</Button>
                    ) : (
                      <Badge variant="outline">{task.state.replace(/_/g, " ")}</Badge>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
            <p className="text-center text-xs text-muted-foreground">CareBase move-in guest access · Terms {workspace.data.termsVersion}</p>
          </>
        )}
      </div>

      <Dialog open={!!taskId} onOpenChange={open => !open && setTaskId("")}>
        <DialogContent>
          <DialogHeader><DialogTitle>Electronic signature</DialogTitle><DialogDescription>Your name, relationship, timestamp, authentication method, and attestation become part of the admission record.</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1"><Label>Signer name *</Label><Input value={signerName} onChange={event => setSignerName(event.target.value)} /></div>
            <div className="space-y-1"><Label>Relationship and legal authority *</Label><Input value={relationship} onChange={event => setRelationship(event.target.value)} placeholder="e.g. Designated person" /></div>
            <div className="space-y-1"><Label>Attestation *</Label><Textarea value={attestation} onChange={event => setAttestation(event.target.value)} placeholder="I reviewed and agree to this admission item..." /></div>
            {sign.isError && <p className="text-sm text-destructive">{sign.error.message}</p>}
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setTaskId("")}>Cancel</Button><Button disabled={signerName.trim().length < 2 || relationship.trim().length < 2 || attestation.trim().length < 5 || sign.isPending} onClick={signTask}>{sign.isPending ? "Signing..." : "Sign electronically"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
