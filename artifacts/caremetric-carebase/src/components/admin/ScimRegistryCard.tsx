import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import { QueryError } from "@/components/QueryState";
import { KeyRound, Link2, RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { errorText } from "@/lib/errorText";
import {
  SSO_LINK_METHODS, useLinkSsoIdentitySubject, useRotateScimCredential,
  useScimConnectionRegistry, useSsoConnections, type RotatedScimCredential,
} from "@/hooks/useScimRegistry";

/**
 * Directory connections, and the two repairs that had no way in (BACKLOG.md G15.6-G15.8).
 *
 * The card above can create a SCIM connection. Nothing could list one afterwards, so its credential
 * could not be rotated -- the standing answer when a directory integration is compromised -- and an
 * SSO identity that failed to auto-match could not be attached to a profile by hand, which is the
 * only remedy when somebody's provider subject changes.
 *
 * The registry deliberately shows a `credential_hint` rather than the credential. The secret exists
 * once, at rotation, and this surface cannot show it again -- so the rotation panel says so at the
 * moment it matters rather than in documentation nobody reads at 2am.
 */
export function ScimRegistryCard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const registry = useScimConnectionRegistry();
  const ssoConnections = useSsoConnections();
  const rotate = useRotateScimCredential();
  const link = useLinkSsoIdentitySubject();

  const [rotated, setRotated] = useState<RotatedScimCredential | null>(null);
  const [linking, setLinking] = useState(false);
  const [ssoConnectionId, setSsoConnectionId] = useState("");
  const [providerSubject, setProviderSubject] = useState("");
  const [profileId, setProfileId] = useState("");
  const [linkMethod, setLinkMethod] = useState<string>("admin_verified");
  const [copied, setCopied] = useState(false);
  const secretReview = useRef(0);
  const linkDraft = useRef(0);
  const scope = JSON.stringify([user?.id, user?.organizationId, user?.role]);
  const previousScope = useRef(scope);
  if (previousScope.current !== scope) {
    previousScope.current = scope; secretReview.current += 1; linkDraft.current += 1;
    setRotated(null); setCopied(false); setLinking(false); setSsoConnectionId(""); setProviderSubject(""); setProfileId("");
  }
  useEffect(() => () => { secretReview.current += 1; linkDraft.current += 1; }, []);

  const canLink = ssoConnections.isSuccess && !ssoConnections.isFetching
    && ssoConnections.data.some(connection => connection.id === ssoConnectionId) && providerSubject.trim() && profileId.trim();
  const copySecret = async () => {
    if (!rotated) return;
    const request = secretReview.current;
    try {
      await navigator.clipboard.writeText(rotated.secret);
      if (request === secretReview.current) setCopied(true);
    } catch {
      if (request === secretReview.current) toast({ title: "Could not copy the credential", description: "Select and copy the displayed value manually.", variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="h-5 w-5" />Directory connections
        </CardTitle>
        <CardDescription>
          Optional directory automation: every SCIM connection provisioned here, its credential rotation, and the manual link for an
          SSO identity that did not match on its own.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {rotated && (
          <Alert>
            <AlertTitle>New SCIM credential</AlertTitle>
            <AlertDescription className="space-y-2">
              <p className="text-xs">Connection key <code className="font-mono">{rotated.connectionKey}</code></p>
              <code className="block break-all rounded bg-muted p-2 font-mono text-xs">{rotated.secret}</code>
              <p className="text-xs">
                The old credential is already invalid. Update the directory with this value to resume provisioning.
                The registry keeps only a hint, so this is the only time it can be read.
              </p>
              <Button size="sm" variant="outline" onClick={() => void copySecret()}>{copied ? "Copied" : "Copy credential"}</Button>
              <Button size="sm" variant="outline" onClick={() => { secretReview.current += 1; setRotated(null); setCopied(false); }}>I have saved it</Button>
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-2">
          {registry.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {registry.isError && (
            <QueryError what="SCIM connections" error={registry.error} onRetry={() => void registry.refetch()} />
          )}
          {registry.data?.length === 0 && (
            <p className="text-sm text-muted-foreground">No SCIM connections have been created.</p>
          )}
          {(registry.data ?? []).map((connection) => (
            <div key={connection.connection_id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2">
              <div className="min-w-0">
                <p className="text-sm font-medium">{connection.display_name}</p>
                <p className="text-xs text-muted-foreground">
                  {connection.provider} · key <span className="font-mono">{connection.connection_key.slice(0, 8)}…</span>
                  {connection.credential_hint && <> · hint {connection.credential_hint}</>}
                </p>
                <p className="text-xs text-muted-foreground">
                  {connection.last_rotated_at
                    ? `Last rotated ${new Date(connection.last_rotated_at).toLocaleDateString()}`
                    : "Never rotated since it was created"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge variant={connection.status === "active" ? "secondary" : "outline"}>{connection.status}</Badge>
                <Button
                  size="sm" variant="outline" disabled={rotate.isPending || !!rotated || registry.isError || registry.isFetching}
                  onClick={() => { const request = ++secretReview.current; rotate.mutate({ connectionId: connection.connection_id }, {
                    onSuccess: (secret) => {
                      if (request !== secretReview.current) return;
                      setRotated(secret); setCopied(false);
                    },
                    onError: (error) => { if (request === secretReview.current) toast({ title: "Rotation unavailable", description: errorText(error), variant: "destructive" }); },
                  }); }}
                  title="Rotation invalidates the previous credential immediately."
                >
                  <RefreshCw className="mr-1 h-3.5 w-3.5" />Rotate credential
                </Button>
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-2 border-t pt-3">
          {!linking && (
            <Button size="sm" variant="outline" onClick={() => { linkDraft.current += 1; setLinking(true); }}>
              <Link2 className="mr-1 h-3.5 w-3.5" />Link an SSO identity by hand
            </Button>
          )}
          {linking && (
            <div className="space-y-3 rounded-md border p-3">
              <p className="text-xs text-muted-foreground">
                For an identity the provider sends that does not match an existing account — usually
                because somebody's subject identifier changed. Without this the person cannot sign in
                and nothing in the product can attach them.
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="sso-connection">SSO connection</Label>
                <Select value={ssoConnectionId} onValueChange={value => { linkDraft.current += 1; setSsoConnectionId(value); }} disabled={!ssoConnections.isSuccess || ssoConnections.isFetching}>
                  <SelectTrigger id="sso-connection" className="sm:w-80"><SelectValue placeholder="Pick a connection" /></SelectTrigger>
                  <SelectContent>
                    {(ssoConnections.data ?? []).map((connection) => (
                      <SelectItem key={connection.id} value={connection.id}>
                        {connection.display_name ?? connection.provider ?? connection.id.slice(0, 8)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {ssoConnections.isError && <QueryError what="SSO connections" error={ssoConnections.error} onRetry={() => void ssoConnections.refetch()} />}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="provider-subject">Provider subject</Label>
                <Input id="provider-subject" value={providerSubject} onChange={(e) => { linkDraft.current += 1; setProviderSubject(e.target.value); }} placeholder="The sub claim the provider sends" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="link-profile">Profile</Label>
                <Input id="link-profile" value={profileId} onChange={(e) => { linkDraft.current += 1; setProfileId(e.target.value); }} placeholder="Profile UUID" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="link-method">How it was established</Label>
                <Select value={linkMethod} onValueChange={value => { linkDraft.current += 1; setLinkMethod(value); }}>
                  <SelectTrigger id="link-method" className="sm:w-80"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SSO_LINK_METHODS.map((method) => (
                      <SelectItem key={method.value} value={method.value}>{method.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm" disabled={link.isPending || !canLink}
                  onClick={() => { if (!canLink || link.isPending) return; const request = linkDraft.current; link.mutate({
                    ssoConnectionId,
                    providerSubject: providerSubject.trim(),
                    profileId: profileId.trim(),
                    linkMethod,
                  }, {
                    onSuccess: () => {
                      if (request !== linkDraft.current) return;
                      setLinking(false); setProviderSubject(""); setProfileId("");
                      toast({ title: "Identity linked", description: "That subject now resolves to the profile." });
                    },
                    onError: (error) => { if (request === linkDraft.current) toast({ title: "Link refused", description: errorText(error), variant: "destructive" }); },
                  }); }}
                >
                  {link.isPending ? "Linking…" : "Link identity"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { linkDraft.current += 1; setLinking(false); }}>Cancel</Button>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
