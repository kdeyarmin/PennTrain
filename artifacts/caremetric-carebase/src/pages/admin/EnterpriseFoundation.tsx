import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toLocalIsoDate } from "@/lib/dateUtils";
import { Link } from "wouter";
import {
  Building2,
  CreditCard,
  Fingerprint,
  KeyRound,
  LineChart,
  Network,
  RefreshCw,
  Scale,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import {
  type EnterpriseJson,
  type EnterpriseRecord,
  type EnterpriseRpcCommand,
  useEnterpriseFoundation,
  useEnterpriseRpcCommand,
  useSaveEnterpriseSnapshot,
  useEnterpriseTableInsert,
} from "@/hooks/useEnterpriseFoundation";
import { BillingPlanSelector } from "@/components/billing/BillingPlanSelector";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { ENTERPRISE_OPERATION_GUARDRAILS, summarizeSetupProgress, type GuidedSetupItem } from "@/lib/enterpriseOperations";

function isScalar(value: EnterpriseJson): value is string | number | boolean | null {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

function labelFor(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatScalar(value: string | number | boolean | null): string {
  if (value === null) return "Not set";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function statusVariant(value: EnterpriseJson): "default" | "secondary" | "destructive" | "outline" {
  const normalized = String(value ?? "").toLowerCase();
  if (["active", "approved", "healthy", "resolved", "current", "true"].includes(normalized)) return "default";
  if (["failed", "blocked", "suspended", "unresolved", "past_due", "dead_letter"].includes(normalized)) return "destructive";
  return "secondary";
}

function JsonValue({ value }: { value: EnterpriseJson }) {
  if (isScalar(value)) return <span>{formatScalar(value)}</span>;
  return (
    <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function ControlPlanePanel({
  title,
  description,
  data,
}: {
  title: string;
  description: string;
  data: EnterpriseRecord;
}) {
  const scalarEntries = Object.entries(data).filter((entry): entry is [string, string | number | boolean | null] => isScalar(entry[1]));
  const detailEntries = Object.entries(data).filter(([, value]) => !isScalar(value));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          {scalarEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No summary metrics are available yet.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {scalarEntries.map(([key, value]) => (
                <div key={key} className="rounded-lg border bg-card p-3">
                  <p className="text-xs font-medium text-muted-foreground">{labelFor(key)}</p>
                  <div className="mt-2 text-lg font-semibold">
                    {key.includes("status") || typeof value === "boolean" ? (
                      <Badge variant={statusVariant(value)}>{formatScalar(value)}</Badge>
                    ) : (
                      formatScalar(value)
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {detailEntries.map(([key, value]) => (
        <Card key={key}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{labelFor(key)}</CardTitle>
          </CardHeader>
          <CardContent>
            <JsonValue value={value} />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function LifecycleCommand() {
  const { toast } = useToast();
  const previewCommand = useEnterpriseRpcCommand();
  const applyCommand = useEnterpriseRpcCommand();
  const [employeeId, setEmployeeId] = useState("");
  const [transition, setTransition] = useState("leave");
  const [effectiveDate, setEffectiveDate] = useState(() => toLocalIsoDate());
  const [targetFacilityId, setTargetFacilityId] = useState("");
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<EnterpriseJson | null>(null);
  const [previewKey, setPreviewKey] = useState<string | null>(null);

  const commandArgs = {
    p_employee_id: employeeId,
    p_transition: transition,
    p_effective_on: effectiveDate,
    p_facility_id: targetFacilityId || null,
    p_reason: reason.trim(),
  };
  const currentKey = JSON.stringify(commandArgs);

  const previewTransition = async () => {
    if (!employeeId || reason.trim().length < 8) {
      toast({ title: "Employee and a meaningful reason are required", variant: "destructive" });
      return;
    }
    try {
      const result = await previewCommand.mutateAsync({
        rpc: "preview_employee_lifecycle_transition",
        args: commandArgs,
      });
      setPreview(result as EnterpriseJson);
      setPreviewKey(currentKey);
    } catch (error) {
      setPreview(null);
      setPreviewKey(null);
      toast({ title: "Preview blocked", description: error instanceof Error ? error.message : "Unknown error", variant: "destructive" });
    }
  };

  const submit = async () => {
    if (!employeeId || reason.trim().length < 8) {
      toast({ title: "Employee and a meaningful reason are required", variant: "destructive" });
      return;
    }
    try {
      if (previewKey !== currentKey) {
        toast({ title: "Preview the current transition first", variant: "destructive" });
        return;
      }
      await applyCommand.mutateAsync({
        rpc: "apply_employee_lifecycle_transition",
        args: commandArgs,
      });
      toast({ title: "Employee lifecycle transition recorded" });
      setReason("");
      setPreview(null);
      setPreviewKey(null);
    } catch (error) {
      toast({ title: "Transition blocked", description: error instanceof Error ? error.message : "Unknown error", variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Guarded employee transition</CardTitle>
        <CardDescription>Lifecycle commands retain evidence, capture the reason, and apply access changes transactionally.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="phase2-employee-id">Employee ID</Label>
          <Input id="phase2-employee-id" value={employeeId} onChange={(event) => setEmployeeId(event.target.value)} placeholder="Employee UUID" />
        </div>
        <div className="space-y-1.5">
          <Label>Transition</Label>
          <Select value={transition} onValueChange={setTransition}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {['hire', 'rehire', 'leave', 'return', 'transfer', 'terminate', 'suspend_access', 'restore_access'].map((value) => (
                <SelectItem key={value} value={value}>{labelFor(value)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="phase2-effective-date">Effective date</Label>
          <Input id="phase2-effective-date" type="date" value={effectiveDate} onChange={(event) => setEffectiveDate(event.target.value)} />
        </div>
        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="phase2-target-facility">Target facility ID (hire, rehire, or transfer)</Label>
          <Input id="phase2-target-facility" value={targetFacilityId} onChange={(event) => setTargetFacilityId(event.target.value)} placeholder="Optional facility UUID" />
        </div>
        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="phase2-transition-reason">Reason</Label>
          <Textarea id="phase2-transition-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why this transition is required" />
        </div>
        {preview !== null && previewKey === currentKey ? (
          <div className="space-y-2 rounded-lg border bg-muted/30 p-4 md:col-span-2">
            <p className="text-sm font-medium">Transition preview</p>
            <JsonValue value={preview} />
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2 md:col-span-2">
          <Button variant="outline" onClick={() => void previewTransition()} disabled={previewCommand.isPending || applyCommand.isPending}>
            Preview effects
          </Button>
          <Button onClick={() => void submit()} disabled={applyCommand.isPending || previewKey !== currentKey}>
            Apply guarded transition
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ScopeGrantCommand() {
  const { toast } = useToast();
  const command = useEnterpriseRpcCommand();
  const [profileId, setProfileId] = useState("");
  const [scopeType, setScopeType] = useState("organization");
  const [scopeId, setScopeId] = useState("");
  const [roleTemplateId, setRoleTemplateId] = useState("");
  const [reason, setReason] = useState("");

  const submit = async () => {
    if (!profileId || !scopeId || !roleTemplateId || reason.trim().length < 8) {
      toast({ title: "Profile, scope, role template, and a meaningful reason are required", variant: "destructive" });
      return;
    }
    try {
      await command.mutateAsync({
        rpc: "grant_enterprise_role",
        args: {
          p_profile_id: profileId,
          p_scope_type: scopeType,
          p_scope_id: scopeId,
          p_role_template_id: roleTemplateId,
          p_reason: reason.trim(),
        },
      });
      setReason("");
      toast({ title: "Effective-dated enterprise role granted" });
    } catch (error) {
      toast({ title: "Role grant blocked", description: error instanceof Error ? error.message : "Unknown error", variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Governed enterprise role grant</CardTitle>
        <CardDescription>The trusted resolver combines this effective-dated grant with hierarchy and tenant state.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="phase2-grant-profile">Profile ID</Label>
          <Input id="phase2-grant-profile" value={profileId} onChange={(event) => setProfileId(event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="phase2-role-template">Role template ID</Label>
          <Input id="phase2-role-template" value={roleTemplateId} onChange={(event) => setRoleTemplateId(event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Scope type</Label>
          <Select value={scopeType} onValueChange={setScopeType}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {['portfolio', 'region', 'organization', 'facility'].map((value) => <SelectItem key={value} value={value}>{labelFor(value)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="phase2-grant-scope">Scope ID</Label>
          <Input id="phase2-grant-scope" value={scopeId} onChange={(event) => setScopeId(event.target.value)} />
        </div>
        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="phase2-grant-reason">Reason</Label>
          <Textarea id="phase2-grant-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Approved responsibility or access change" />
        </div>
        <div className="md:col-span-2"><Button onClick={() => void submit()} disabled={command.isPending}>Grant enterprise role</Button></div>
      </CardContent>
    </Card>
  );
}

function ComplianceProfileAssignmentCommand() {
  const { toast } = useToast();
  const command = useEnterpriseRpcCommand();
  const [employeeId, setEmployeeId] = useState("");
  const [profileDefinitionId, setProfileDefinitionId] = useState("");
  const [reason, setReason] = useState("");

  const submit = async () => {
    if (!employeeId || !profileDefinitionId || reason.trim().length < 8) {
      toast({ title: "Employee, profile definition, and a meaningful reason are required", variant: "destructive" });
      return;
    }
    try {
      await command.mutateAsync({
        rpc: "upsert_compliance_profile_assignment",
        args: {
          p_employee_id: employeeId,
          p_profile_definition_id: profileDefinitionId,
          p_reason: reason.trim(),
        },
      });
      setReason("");
      toast({ title: "Compliance profile assignment recorded" });
    } catch (error) {
      toast({ title: "Profile assignment blocked", description: error instanceof Error ? error.message : "Unknown error", variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Compliance profile assignment</CardTitle>
        <CardDescription>Assignments retain their effective dates and explanation; mandatory regulatory baselines cannot be weakened.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="phase2-profile-employee">Employee ID</Label>
          <Input id="phase2-profile-employee" value={employeeId} onChange={(event) => setEmployeeId(event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="phase2-profile-definition">Profile definition ID</Label>
          <Input id="phase2-profile-definition" value={profileDefinitionId} onChange={(event) => setProfileDefinitionId(event.target.value)} />
        </div>
        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="phase2-profile-reason">Reason</Label>
          <Textarea id="phase2-profile-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why this governed profile applies" />
        </div>
        <div className="md:col-span-2"><Button onClick={() => void submit()} disabled={command.isPending}>Assign compliance profile</Button></div>
      </CardContent>
    </Card>
  );
}

function RegulatoryRuleCommand() {
  const { toast } = useToast();
  const command = useEnterpriseRpcCommand();
  const [versionId, setVersionId] = useState("");
  const [action, setAction] = useState("submit");
  const [notes, setNotes] = useState("");

  const submit = async () => {
    if (!versionId || (["approve", "withdraw"].includes(action) && notes.trim().length < 10)) {
      toast({ title: "Version ID and meaningful review/withdrawal notes are required", variant: "destructive" });
      return;
    }
    const commands: Record<string, EnterpriseRpcCommand> = {
      submit: { rpc: "submit_regulatory_rule_version", args: { p_version_id: versionId } },
      approve: { rpc: "approve_regulatory_rule_version", args: { p_version_id: versionId, p_review_notes: notes.trim() } },
      shadow: { rpc: "start_regulatory_rule_shadow", args: { p_version_id: versionId } },
      activate: { rpc: "activate_regulatory_rule_version", args: { p_version_id: versionId } },
      withdraw: { rpc: "withdraw_regulatory_rule_version", args: { p_version_id: versionId, p_reason: notes.trim() } },
    };
    try {
      await command.mutateAsync(commands[action]);
      setNotes("");
      toast({ title: `Rule workflow advanced: ${labelFor(action)}` });
    } catch (error) {
      toast({ title: "Rule transition blocked", description: error instanceof Error ? error.message : "Unknown error", variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Guarded rule workflow</CardTitle>
        <CardDescription>Approval separation, fixtures, shadow duration, reconciliation, and supersession are enforced in the database.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="phase2-rule-version">Rule version ID</Label>
          <Input id="phase2-rule-version" value={versionId} onChange={(event) => setVersionId(event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Action</Label>
          <Select value={action} onValueChange={setAction}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="submit">Submit for review</SelectItem>
              <SelectItem value="approve">Approve</SelectItem>
              <SelectItem value="shadow">Start shadow</SelectItem>
              <SelectItem value="activate">Activate</SelectItem>
              <SelectItem value="withdraw">Withdraw</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {(["approve", "withdraw"].includes(action)) ? (
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="phase2-rule-notes">{action === "approve" ? "Independent review notes" : "Withdrawal reason"}</Label>
            <Textarea id="phase2-rule-notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
          </div>
        ) : null}
        <div className="md:col-span-2"><Button onClick={() => void submit()} disabled={command.isPending}>Run guarded rule action</Button></div>
      </CardContent>
    </Card>
  );
}

function RegulatoryExpansionPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [installing, setInstalling] = useState(false);
  const proposals = useQuery({
    queryKey: ["regulatory-change-proposals"],
    queryFn: async () => {
      const { data, error } = await supabase.from("regulatory_change_proposals")
        .select("id,state,change_summary,drafted_rule_version_id,created_at,regulatory_source_snapshots(fetched_at,regulatory_update_sources(source_key,source_uri))")
        .order("created_at", { ascending: false }).limit(20);
      if (error) throw error;
      return data;
    },
  });
  const installOhio = async () => {
    setInstalling(true);
    try {
      const { data, error } = await supabase.rpc("install_regulatory_rule_pack_template", { p_template_key: "oh.rcf.3701-16.personnel" });
      if (error) throw error;
      toast({ title: "Ohio rule pack installed as a draft", description: `Version ${data} must complete fixture, independent review, shadow, and activation gates.` });
      await queryClient.invalidateQueries({ queryKey: ["enterprise-foundation"] });
    } catch (error) {
      toast({ title: "Ohio draft could not be installed", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    } finally { setInstalling(false); }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Multi-state packs and official-source feed</CardTitle>
        <CardDescription>Templates and automated source changes create drafts only. The guarded workflow above remains the only activation path.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
          <div><p className="font-medium">Ohio residential care facility personnel training</p><p className="text-xs text-muted-foreground">Ohio Admin. Code 3701-16-06, effective July 12, 2024. Install for legal and operational validation.</p></div>
          <Button onClick={() => void installOhio()} disabled={installing}>{installing ? "Installing draft..." : "Install Ohio draft"}</Button>
        </div>
        <div>
          <p className="mb-2 text-sm font-medium">Detected official-source changes</p>
          {proposals.isLoading ? <p className="text-sm text-muted-foreground">Loading source feed...</p> : proposals.data?.length ? (
            <div className="space-y-2">{proposals.data.map((proposal) => {
              const snapshot = proposal.regulatory_source_snapshots as { fetched_at?: string; regulatory_update_sources?: { source_key?: string; source_uri?: string } | null } | null;
              const summary = proposal.change_summary as {
                addedTokenCount?: number;
                removedTokenCount?: number;
                addedTokenSample?: string[];
                removedTokenSample?: string[];
              } | null;
              return <div key={proposal.id} className="rounded-lg border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{snapshot?.regulatory_update_sources?.source_key ?? "Official source"}</span><Badge variant={proposal.state === "drafted" ? "secondary" : "outline"}>{proposal.state}</Badge></div>
                <p className="mt-1 text-xs text-muted-foreground">Detected {new Date(proposal.created_at).toLocaleString()} {proposal.drafted_rule_version_id ? `| Draft version ${proposal.drafted_rule_version_id}` : "| No matching active pack; review required"}</p>
                {summary?.addedTokenCount != null ? <div className="mt-2 rounded bg-muted/50 p-2 text-xs">
                  <p className="font-medium">Grounded source diff: {summary.addedTokenCount} added / {summary.removedTokenCount ?? 0} removed terms</p>
                  {summary.addedTokenSample?.length ? <p className="mt-1 text-muted-foreground">Added sample: {summary.addedTokenSample.join(", ")}</p> : null}
                  {summary.removedTokenSample?.length ? <p className="mt-1 text-muted-foreground">Removed sample: {summary.removedTokenSample.join(", ")}</p> : null}
                </div> : null}
              </div>;
            })}</div>
          ) : <p className="text-sm text-muted-foreground">No changed official sources have been detected. The first successful poll establishes each baseline.</p>}
        </div>
      </CardContent>
    </Card>
  );
}

type RegisteredDomain = { domainId: string; domain: string; token: string; recordName: string };

function IdentityDomainCommand() {
  const { user } = useAuth();
  const { toast } = useToast();
  const registerCommand = useEnterpriseRpcCommand();
  const [organizationId, setOrganizationId] = useState(user?.organizationId ?? "");
  const [domain, setDomain] = useState("");
  const [registered, setRegistered] = useState<RegisteredDomain | null>(null);
  const [verifying, setVerifying] = useState(false);

  const register = async () => {
    const normalizedDomain = domain.trim().toLowerCase().replace(/\.$/, "");
    if (!organizationId || !normalizedDomain.includes(".")) {
      toast({ title: "Organization and a valid domain are required", variant: "destructive" });
      return;
    }
    const randomBytes = crypto.getRandomValues(new Uint8Array(24));
    const token = `cmt_${Array.from(randomBytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
    const challengeHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    try {
      const result = await registerCommand.mutateAsync({
        rpc: "register_identity_domain",
        args: {
          p_organization_id: organizationId,
          p_domain: normalizedDomain,
          p_verification_challenge_sha256: challengeHash,
        },
      });
      const domainId = String(result);
      setRegistered({
        domainId,
        domain: normalizedDomain,
        token,
        recordName: `_caremetric-carebase-verification.${normalizedDomain}`,
      });
      toast({ title: "Identity domain registered", description: "Publish the TXT proof before verification." });
    } catch (error) {
      toast({ title: "Domain registration blocked", description: error instanceof Error ? error.message : "Unknown error", variant: "destructive" });
    }
  };

  const verify = async () => {
    if (!registered) return;
    setVerifying(true);
    try {
      const { data, error } = await supabase.functions.invoke("verify-identity-domain", {
        body: { domainId: registered.domainId },
      });
      if (error) throw error;
      if (!data?.verified) throw new Error(data?.message ?? "The expected TXT proof was not found.");
      toast({ title: "Domain ownership verified", description: `${registered.domain} may now be used for an SSO pilot.` });
      setRegistered(null);
      setDomain("");
    } catch (error) {
      toast({ title: "Domain verification incomplete", description: error instanceof Error ? error.message : "Unknown error", variant: "destructive" });
    } finally {
      setVerifying(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Verified SSO domain</CardTitle>
        <CardDescription>Domain ownership is proven by a trusted DNS lookup; administrators cannot self-attest verification.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="phase2-domain-org">Organization ID</Label>
          <Input id="phase2-domain-org" value={organizationId} onChange={(event) => setOrganizationId(event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="phase2-domain-name">Domain</Label>
          <Input id="phase2-domain-name" value={domain} onChange={(event) => setDomain(event.target.value)} placeholder="example.org" />
        </div>
        {registered ? (
          <Alert className="md:col-span-2">
            <Fingerprint className="h-4 w-4" />
            <AlertTitle>Publish this DNS TXT record</AlertTitle>
            <AlertDescription className="space-y-2">
              <p><strong>Name:</strong> <code className="break-all">{registered.recordName}</code></p>
              <p><strong>Value:</strong> <code className="break-all">{registered.token}</code></p>
              <p>After DNS propagation, use the verification button below.</p>
            </AlertDescription>
          </Alert>
        ) : null}
        <div className="flex flex-wrap gap-2 md:col-span-2">
          <Button variant="outline" onClick={() => void register()} disabled={registerCommand.isPending || verifying || !!registered}>Register domain</Button>
          <Button onClick={() => void verify()} disabled={!registered || verifying}>
            {verifying && <RefreshCw className="mr-2 h-4 w-4 animate-spin" />}
            Verify DNS proof
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function IdentityDomainRevocationCommand() {
  const { toast } = useToast();
  const command = useEnterpriseRpcCommand();
  const [domainId, setDomainId] = useState("");
  const [reason, setReason] = useState("");

  const revoke = async () => {
    if (!domainId || reason.trim().length < 10) {
      toast({ title: "Domain ID and a meaningful revocation reason are required", variant: "destructive" });
      return;
    }
    try {
      await command.mutateAsync({
        rpc: "revoke_identity_domain",
        args: { p_domain_id: domainId, p_reason: reason.trim() },
      });
      setReason("");
      toast({ title: "Identity domain revoked", description: "Attached SSO connections were suspended and linked sessions revoked." });
    } catch (error) {
      toast({ title: "Domain revocation blocked", description: error instanceof Error ? error.message : "Unknown error", variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Revoke an identity domain</CardTitle>
        <CardDescription>Emergency revocation suspends attached SSO connections and deactivates linked profiles with retained evidence.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="phase2-revoke-domain">Domain ID</Label>
          <Input id="phase2-revoke-domain" value={domainId} onChange={(event) => setDomainId(event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="phase2-revoke-domain-reason">Reason</Label>
          <Input id="phase2-revoke-domain-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Ownership or security incident reference" />
        </div>
        <div className="md:col-span-2"><Button variant="destructive" onClick={() => void revoke()} disabled={command.isPending}>Revoke domain and linked access</Button></div>
      </CardContent>
    </Card>
  );
}

function SsoConnectionCommand() {
  const { user } = useAuth();
  const { toast } = useToast();
  const insert = useEnterpriseTableInsert("organization_sso_connections");
  const [organizationId, setOrganizationId] = useState(user?.organizationId ?? "");
  const [identityDomainId, setIdentityDomainId] = useState("");
  const [providerConnectionId, setProviderConnectionId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [status, setStatus] = useState("pilot");
  const [defaultRole, setDefaultRole] = useState("employee");
  const [jitEnabled, setJitEnabled] = useState(true);

  const create = async () => {
    if (!organizationId || !identityDomainId || !providerConnectionId || !displayName.trim() || !user) {
      toast({ title: "Complete every SSO connection field", variant: "destructive" });
      return;
    }
    try {
      await insert.mutateAsync({
        organization_id: organizationId,
        identity_domain_id: identityDomainId,
        provider: "saml",
        provider_connection_id: providerConnectionId.trim(),
        display_name: displayName.trim(),
        status,
        default_role: defaultRole,
        jit_membership_enabled: jitEnabled,
        jit_membership_policy: { allowNewUsers: jitEnabled },
        require_aal2: true,
        created_by: user.id,
      });
      setDisplayName("");
      toast({ title: "SAML connection registered", description: "The Supabase Auth provider is now bound to this verified tenant domain." });
    } catch (error) {
      toast({ title: "SSO connection blocked", description: error instanceof Error ? error.message : "Unknown error", variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>SAML SSO connection</CardTitle>
        <CardDescription>First create the provider in Supabase Auth, then bind its immutable provider UUID to a verified tenant domain.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="phase2-sso-org">Organization ID</Label>
          <Input id="phase2-sso-org" value={organizationId} onChange={(event) => setOrganizationId(event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="phase2-sso-domain">Verified domain ID</Label>
          <Input id="phase2-sso-domain" value={identityDomainId} onChange={(event) => setIdentityDomainId(event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="phase2-sso-provider">Supabase SSO provider UUID</Label>
          <Input id="phase2-sso-provider" value={providerConnectionId} onChange={(event) => setProviderConnectionId(event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="phase2-sso-name">Display name</Label>
          <Input id="phase2-sso-name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Company SSO" />
        </div>
        <div className="space-y-1.5">
          <Label>Initial status</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="draft">Draft</SelectItem><SelectItem value="pilot">Pilot</SelectItem><SelectItem value="active">Active</SelectItem></SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>JIT default role</Label>
          <Select value={defaultRole} onValueChange={setDefaultRole}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {['employee', 'trainer', 'facility_manager', 'auditor', 'org_admin'].map((value) => <SelectItem key={value} value={value}>{labelFor(value)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-between rounded-lg border p-3 md:col-span-2">
          <div><Label htmlFor="phase2-sso-jit">Allow verified-domain JIT membership</Label><p className="text-xs text-muted-foreground">Disable when every identity must be pre-provisioned.</p></div>
          <Switch id="phase2-sso-jit" checked={jitEnabled} onCheckedChange={setJitEnabled} />
        </div>
        <div className="md:col-span-2"><Button onClick={() => void create()} disabled={insert.isPending}>Register SAML connection</Button></div>
      </CardContent>
    </Card>
  );
}

type IssuedScimCredential = { connectionId: string; bearerToken: string };

function ScimConnectionCommand() {
  const { user } = useAuth();
  const { toast } = useToast();
  const command = useEnterpriseRpcCommand();
  const [organizationId, setOrganizationId] = useState(user?.organizationId ?? "");
  const [displayName, setDisplayName] = useState("");
  const [provider, setProvider] = useState("generic-scim-v2");
  const [defaultFacilityId, setDefaultFacilityId] = useState("");
  const [issued, setIssued] = useState<IssuedScimCredential | null>(null);

  const createConnection = async () => {
    if (!organizationId || !displayName.trim() || !provider.trim() || !defaultFacilityId) {
      toast({ title: "Complete every SCIM connection field", variant: "destructive" });
      return;
    }
    try {
      const result = await command.mutateAsync({
        rpc: "create_scim_connection",
        args: {
          p_organization_id: organizationId,
          p_display_name: displayName.trim(),
          p_provider: provider.trim(),
          p_default_facility_id: defaultFacilityId,
        },
      });
      const firstRow = Array.isArray(result) ? result[0] : result;
      if (!firstRow || typeof firstRow !== "object" || !("connection_key" in firstRow) || !("connection_id" in firstRow) || !("credential_secret" in firstRow)) {
        throw new Error("The SCIM connection was created but its credential response was invalid.");
      }
      setIssued({
        connectionId: String(firstRow.connection_id),
        bearerToken: `${String(firstRow.connection_key)}.${String(firstRow.credential_secret)}`,
      });
      toast({ title: "SCIM connection created" });
    } catch (error) {
      setIssued(null);
      toast({ title: "SCIM connection blocked", description: error instanceof Error ? error.message : "Unknown error", variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>SCIM provisioning connection</CardTitle>
        <CardDescription>A trusted database boundary generates 256 bits of secret entropy, retains only its salted digest, and returns the plaintext once.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="phase2-scim-org">Organization ID</Label>
          <Input id="phase2-scim-org" value={organizationId} onChange={(event) => setOrganizationId(event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="phase2-scim-facility">Default facility ID</Label>
          <Input id="phase2-scim-facility" value={defaultFacilityId} onChange={(event) => setDefaultFacilityId(event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="phase2-scim-name">Connection name</Label>
          <Input id="phase2-scim-name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Okta production" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="phase2-scim-provider">Provider</Label>
          <Input id="phase2-scim-provider" value={provider} onChange={(event) => setProvider(event.target.value)} />
        </div>
        {issued ? (
          <Alert className="md:col-span-2">
            <KeyRound className="h-4 w-4" />
            <AlertTitle>Copy the SCIM bearer credential now</AlertTitle>
            <AlertDescription className="space-y-2">
              <p><strong>Connection ID:</strong> <code>{issued.connectionId}</code></p>
              <code className="block break-all rounded bg-muted p-2">{issued.bearerToken}</code>
            </AlertDescription>
          </Alert>
        ) : null}
        <div className="md:col-span-2"><Button onClick={() => void createConnection()} disabled={command.isPending || !!issued}>Create SCIM connection</Button></div>
      </CardContent>
    </Card>
  );
}

function SessionRevocationCommand() {
  const { toast } = useToast();
  const command = useEnterpriseRpcCommand();
  const [profileId, setProfileId] = useState("");
  const [reason, setReason] = useState("");

  const revoke = async () => {
    if (!profileId || reason.trim().length < 8) {
      toast({ title: "Profile and a meaningful revocation reason are required", variant: "destructive" });
      return;
    }
    try {
      await command.mutateAsync({
        rpc: "revoke_identity_sessions",
        args: {
          p_profile_id: profileId,
          p_reason: reason.trim(),
          p_source: "administrator",
          p_deactivate_profile: true,
        },
      });
      setReason("");
      toast({ title: "Sessions revoked and profile deactivated" });
    } catch (error) {
      toast({ title: "Session revocation blocked", description: error instanceof Error ? error.message : "Unknown error", variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Emergency session revocation</CardTitle>
        <CardDescription>Revokes active sessions, deactivates the profile, and records immutable AAL2-authorized evidence.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="phase2-revoke-profile">Profile ID</Label>
          <Input id="phase2-revoke-profile" value={profileId} onChange={(event) => setProfileId(event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="phase2-revoke-reason">Reason</Label>
          <Input id="phase2-revoke-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Security incident reference" />
        </div>
        <div className="md:col-span-2"><Button variant="destructive" onClick={() => void revoke()} disabled={command.isPending}>Revoke sessions and deactivate</Button></div>
      </CardContent>
    </Card>
  );
}

function EntitlementCommand() {
  const { user } = useAuth();
  const { toast } = useToast();
  const command = useEnterpriseRpcCommand();
  const [organizationId, setOrganizationId] = useState(user?.organizationId ?? "");
  const [featureKey, setFeatureKey] = useState("");
  const [decision, setDecision] = useState("grant");
  const [entitlementValue, setEntitlementValue] = useState("true");
  const [reason, setReason] = useState("");

  const submit = async () => {
    if (!organizationId || !featureKey.trim() || reason.trim().length < 8) {
      toast({ title: "Organization, feature, and a meaningful reason are required", variant: "destructive" });
      return;
    }
    let parsedValue: unknown;
    try {
      parsedValue = JSON.parse(entitlementValue);
    } catch {
      toast({ title: "Entitlement value must be valid JSON", variant: "destructive" });
      return;
    }
    try {
      await command.mutateAsync({
        rpc: "set_organization_entitlement_grant",
        args: {
          p_organization_id: organizationId,
          p_feature_key: featureKey.trim(),
          p_decision: decision,
          p_entitlement_value: parsedValue,
          p_reason: reason.trim(),
        },
      });
      setReason("");
      toast({ title: "Effective-dated entitlement grant recorded" });
    } catch (error) {
      toast({ title: "Entitlement change blocked", description: error instanceof Error ? error.message : "Unknown error", variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Organization entitlement grant</CardTitle>
        <CardDescription>Contractual access remains separate from release flags and emergency kill switches.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="phase2-entitlement-org">Organization ID</Label>
          <Input id="phase2-entitlement-org" value={organizationId} onChange={(event) => setOrganizationId(event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="phase2-feature-key">Feature key</Label>
          <Input id="phase2-feature-key" value={featureKey} onChange={(event) => setFeatureKey(event.target.value)} placeholder="enterprise.sso" />
        </div>
        <div className="space-y-1.5">
          <Label>Decision</Label>
          <Select value={decision} onValueChange={setDecision}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="grant">Grant</SelectItem><SelectItem value="override">Override value</SelectItem><SelectItem value="deny">Deny</SelectItem></SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="phase2-entitlement-value">Typed value (JSON)</Label>
          <Textarea id="phase2-entitlement-value" value={entitlementValue} onChange={(event) => setEntitlementValue(event.target.value)} placeholder='{"seatLimit":100}' />
        </div>
        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="phase2-entitlement-reason">Reason</Label>
          <Textarea id="phase2-entitlement-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Approved contract or access exception" />
        </div>
        <div className="md:col-span-2">
          <Button onClick={() => void submit()} disabled={command.isPending}>Record entitlement grant</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function BillingOverrideCommand() {
  const { toast } = useToast();
  const command = useEnterpriseRpcCommand();
  const [organizationId, setOrganizationId] = useState("");
  const [overrideState, setOverrideState] = useState("suspended");
  const [reason, setReason] = useState("");
  const [expiresAt, setExpiresAt] = useState("");

  const submit = async () => {
    if (!organizationId || reason.trim().length < 10) {
      toast({ title: "Organization and a meaningful override reason are required", variant: "destructive" });
      return;
    }
    try {
      await command.mutateAsync({
        rpc: "set_billing_account_override",
        args: {
          p_organization_id: organizationId,
          p_override_state: overrideState,
          p_reason: reason.trim(),
          p_expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
        },
      });
      setReason("");
      toast({ title: overrideState === "provider" ? "Provider billing state restored" : "Billing override recorded" });
    } catch (error) {
      toast({ title: "Billing override blocked", description: error instanceof Error ? error.message : "Unknown error", variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Platform billing override</CardTitle>
        <CardDescription>Comped and manual-suspension states are audited separately from Stripe's reconciled provider state.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="phase2-billing-override-org">Organization ID</Label>
          <Input id="phase2-billing-override-org" value={organizationId} onChange={(event) => setOrganizationId(event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Override state</Label>
          <Select value={overrideState} onValueChange={setOverrideState}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="comped">Comped</SelectItem><SelectItem value="suspended">Suspended</SelectItem><SelectItem value="provider">Restore provider state</SelectItem></SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="phase2-billing-override-expiry">Expires at (optional)</Label>
          <Input id="phase2-billing-override-expiry" type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} disabled={overrideState === "provider"} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="phase2-billing-override-reason">Reason</Label>
          <Input id="phase2-billing-override-reason" value={reason} onChange={(event) => setReason(event.target.value)} />
        </div>
        <div className="md:col-span-2"><Button onClick={() => void submit()} disabled={command.isPending}>Apply billing override</Button></div>
      </CardContent>
    </Card>
  );
}

function IntegrationProvisioningCommand() {
  const { user } = useAuth();
  const { toast } = useToast();
  const command = useEnterpriseRpcCommand();
  const [organizationId, setOrganizationId] = useState(user?.organizationId ?? "");
  const [kind, setKind] = useState<"api" | "webhook">("api");
  const [name, setName] = useState("");
  const [scopesOrEvents, setScopesOrEvents] = useState("events:read");
  const [destinationUrl, setDestinationUrl] = useState("");
  const [issuedSecret, setIssuedSecret] = useState<EnterpriseJson | null>(null);

  const submit = async () => {
    const values = scopesOrEvents.split(",").map((value) => value.trim()).filter(Boolean);
    if (!organizationId || !name.trim() || values.length === 0 || (kind === "webhook" && !destinationUrl)) {
      toast({ title: "Complete every required integration field", variant: "destructive" });
      return;
    }
    try {
      const result = await command.mutateAsync(kind === "api" ? {
        rpc: "issue_integration_api_credential",
        args: {
          p_organization_id: organizationId,
          p_name: name.trim(),
          p_scopes: values,
          p_expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
          p_rate_limit_per_minute: 120,
        },
      } : {
        rpc: "create_integration_webhook_endpoint",
        args: {
          p_organization_id: organizationId,
          p_name: name.trim(),
          p_destination_url: destinationUrl,
          p_event_types: values,
          p_description: "Created from the enterprise foundation control plane",
        },
      });
      setIssuedSecret(result as EnterpriseJson);
      toast({ title: kind === "api" ? "API credential issued" : "Webhook endpoint created" });
    } catch (error) {
      setIssuedSecret(null);
      toast({ title: "Integration provisioning blocked", description: error instanceof Error ? error.message : "Unknown error", variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Provision an integration</CardTitle>
        <CardDescription>Plaintext credentials are shown once. Store them in the consumer's managed secret store.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="phase2-integration-org">Organization ID</Label>
          <Input id="phase2-integration-org" value={organizationId} onChange={(event) => setOrganizationId(event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Integration type</Label>
          <Select value={kind} onValueChange={(value) => { setKind(value as "api" | "webhook"); setIssuedSecret(null); }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="api">Inbound API credential</SelectItem><SelectItem value="webhook">Outbound webhook</SelectItem></SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="phase2-integration-name">Name</Label>
          <Input id="phase2-integration-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Production HRIS" />
        </div>
        {kind === "webhook" ? (
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="phase2-webhook-url">HTTPS destination URL</Label>
            <Input id="phase2-webhook-url" type="url" value={destinationUrl} onChange={(event) => setDestinationUrl(event.target.value)} placeholder="https://consumer.example/webhooks/caremetric" />
          </div>
        ) : null}
        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="phase2-scopes-events">{kind === "api" ? "Scopes" : "Event types"} (comma separated)</Label>
          <Input id="phase2-scopes-events" value={scopesOrEvents} onChange={(event) => setScopesOrEvents(event.target.value)} />
        </div>
        {issuedSecret !== null ? (
          <Alert className="md:col-span-2">
            <KeyRound className="h-4 w-4" />
            <AlertTitle>Copy this secret now</AlertTitle>
            <AlertDescription><JsonValue value={issuedSecret} /></AlertDescription>
          </Alert>
        ) : null}
        <div className="md:col-span-2">
          <Button onClick={() => void submit()} disabled={command.isPending}>Provision securely</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function EnterpriseOperationsPanel({ operations, setup }: { operations: EnterpriseRecord; setup: EnterpriseRecord }) {
  const { toast } = useToast();
  const saveSnapshot = useSaveEnterpriseSnapshot();
  const metrics = (operations.metrics && typeof operations.metrics === "object" && !Array.isArray(operations.metrics))
    ? operations.metrics as Record<string, EnterpriseRecord>
    : {};
  const setupItems = Array.isArray(setup.items) ? setup.items as unknown as GuidedSetupItem[] : [];
  const progress = summarizeSetupProgress(setupItems);

  const saveCurrentSnapshot = async () => {
    try {
      await saveSnapshot.mutateAsync();
      toast({ title: "Enterprise snapshot saved", description: "The snapshot checksum and source definitions were recorded for reproducible review." });
    } catch (error) {
      toast({ title: "Snapshot blocked", description: error instanceof Error ? error.message : "Unknown error", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Executive analytics and trusted operations</CardTitle>
          <CardDescription>RLS-scoped live summaries define numerator, denominator, date basis, freshness, and drill-down source for each metric.</CardDescription>
          <Button className="mt-2 w-fit" variant="outline" onClick={() => void saveCurrentSnapshot()} disabled={saveSnapshot.isPending}>Save reproducible snapshot</Button>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Object.entries(metrics).map(([key, metric]) => (
            <div key={key} className="rounded-lg border p-4">
              <div className="flex items-start justify-between gap-3">
                <p className="font-medium">{labelFor(key)}</p>
                <Badge variant={Number(metric.value ?? 0) > 0 ? "secondary" : "outline"}>{formatScalar(metric.value as string | number | boolean | null)}</Badge>
              </div>
              <dl className="mt-3 space-y-1 text-xs text-muted-foreground">
                <div><dt className="inline font-medium text-foreground">Denominator: </dt><dd className="inline">{formatScalar(metric.denominator as string | number | boolean | null)}</dd></div>
                <div><dt className="inline font-medium text-foreground">Date basis: </dt><dd className="inline">{formatScalar(metric.dateBasis as string | number | boolean | null)}</dd></div>
                <div><dt className="inline font-medium text-foreground">Drill-down: </dt><dd className="inline">{formatScalar(metric.source as string | number | boolean | null)}</dd></div>
              </dl>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Guided organization setup</CardTitle>
            <CardDescription>{progress.complete} of {progress.total} setup records detected from saved data. {progress.percent}% complete.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {setupItems.map((item) => (
              <div key={item.key} className="rounded-lg border p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium">{item.label}</p>
                  <Badge variant={item.complete ? "default" : "secondary"}>{item.complete ? "Complete" : "Needs setup"}</Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{item.why}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recovery queues</CardTitle>
            <CardDescription>Failed integrations and imports remain visible for operator replay, reconciliation, and error export.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm font-medium">Integration recovery</p>
              <JsonValue value={operations.integrationRecovery ?? []} />
            </div>
            <div>
              <p className="text-sm font-medium">Import recovery</p>
              <JsonValue value={operations.importRecovery ?? []} />
            </div>
          </CardContent>
        </Card>
      </div>

      <Alert>
        <ShieldCheck className="h-4 w-4" />
        <AlertTitle>Platform operations guardrails</AlertTitle>
        <AlertDescription>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {ENTERPRISE_OPERATION_GUARDRAILS.map((guardrail) => <li key={guardrail}>{guardrail}</li>)}
          </ul>
        </AlertDescription>
      </Alert>
    </div>
  );
}

const TABS = [
  { value: "scope", label: "Scope", icon: Building2 },
  { value: "workforce", label: "Workforce", icon: UsersRound },
  { value: "rules", label: "Rules", icon: Scale },
  { value: "identity", label: "Identity", icon: Fingerprint },
  { value: "billing", label: "Billing & plans", icon: CreditCard },
  { value: "integrations", label: "Integrations", icon: Network },
  { value: "operations", label: "Operations", icon: LineChart },
] as const;

export default function EnterpriseFoundation() {
  const { user } = useAuth();
  const foundation = useEnterpriseFoundation();
  const data = foundation.data;
  const lastUpdated = useMemo(
    () => data ? new Date(data.collectedAt).toLocaleString() : null,
    [data],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold">Enterprise foundation</h1>
          <p className="text-muted-foreground">Govern scope, workforce, rules, identity, commercial access, and integrations from one control plane.</p>
          {lastUpdated && <p className="mt-1 text-xs text-muted-foreground">Last reconciled {lastUpdated}</p>}
        </div>
        <Button variant="outline" onClick={() => void foundation.refetch()} disabled={foundation.isFetching}>
          <RefreshCw className={`mr-2 h-4 w-4 ${foundation.isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {foundation.error && (
        <Alert variant="destructive">
          <AlertTitle>Enterprise control plane unavailable</AlertTitle>
          <AlertDescription>{foundation.error.message}</AlertDescription>
        </Alert>
      )}

      {!data ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {TABS.map((tab) => <div key={tab.value} className="h-32 animate-pulse rounded-xl bg-muted" />)}
        </div>
      ) : (
        <Tabs defaultValue="scope" className="space-y-5">
          <TabsList className="h-auto flex-wrap justify-start">
            {TABS.map(({ value, label, icon: Icon }) => (
              <TabsTrigger key={value} value={value} className="gap-2">
                <Icon className="h-4 w-4" />{label}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="scope" className="space-y-4"><ControlPlanePanel title="Hierarchy and permissions" description="Effective portfolio, regional, organization, and facility scope with explicit governed permissions." data={data.scope} /><ScopeGrantCommand /></TabsContent>
          <TabsContent value="workforce" className="space-y-4"><ControlPlanePanel title="Workforce lifecycle and compliance profiles" description="Effective employment state, retained evidence, profile explanations, and unresolved mappings." data={data.workforce} /><LifecycleCommand /><ComplianceProfileAssignmentCommand /></TabsContent>
          <TabsContent value="rules" className="space-y-4"><ControlPlanePanel title="Approved regulatory rule packs" description="Sourced versions, approval separation, golden fixtures, shadow comparisons, and activation readiness." data={data.rules} />{user?.role === "platform_admin" ? <><RegulatoryExpansionPanel /><RegulatoryRuleCommand /></> : null}</TabsContent>
          <TabsContent value="identity" className="space-y-4">
            <ControlPlanePanel title="Enterprise identity" description="Verified domains, SAML connections, AAL2 policy, SCIM replay safety, and session revocation evidence." data={data.identity} />
            <IdentityDomainCommand />
            <IdentityDomainRevocationCommand />
            <SsoConnectionCommand />
            <ScimConnectionCommand />
            <SessionRevocationCommand />
            <Card>
              <CardHeader>
                <CardTitle>Privileged session assurance</CardTitle>
                <CardDescription>Enroll or verify an authenticator before running AAL2-protected enterprise commands.</CardDescription>
              </CardHeader>
              <CardContent>
                <Button asChild variant="outline"><Link href="/account/security">Manage my MFA</Link></Button>
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="billing" className="space-y-4">
            <BillingPlanSelector />
            <ControlPlanePanel title="Billing and typed entitlements" description="Stripe source-of-truth state, contractual grants, limits, rollout controls, and reconciliation variance." data={data.billing} />
            {user?.role === "platform_admin" ? <><EntitlementCommand /><BillingOverrideCommand /></> : null}
          </TabsContent>
          <TabsContent value="integrations" className="space-y-4"><ControlPlanePanel title="Signed integration hub" description="Scoped credentials, versioned events, webhook delivery, retry, rotation, and dead-letter visibility." data={data.integrations} /><IntegrationProvisioningCommand /></TabsContent>
          <TabsContent value="operations" className="space-y-4"><EnterpriseOperationsPanel operations={data.operations} setup={data.setup} /></TabsContent>
        </Tabs>
      )}
    </div>
  );
}
