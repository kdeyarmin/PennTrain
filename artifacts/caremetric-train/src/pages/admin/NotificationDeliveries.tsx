import { useEffect, useState } from "react";
import {
  useListNotificationDeliveries,
  useOrganizationNameMap,
  useRetryNotificationDelivery,
  useBulkRetryNotificationDeliveries,
  useNotificationDeliveryOperations,
  useNotificationDeliveryEvidence,
  useNotificationTemplateLibrary,
  usePreviewNotificationTemplate,
  useCreateNotificationTemplateVersion,
  useActivateNotificationTemplate,
  useSetNotificationSpendPolicy,
  useSetNotificationChannelPolicy,
  useAcknowledgeNotificationSpendAlert,
} from "@/hooks/useAdminNotificationDeliveries";
import { useUrlState } from "@/hooks/useUrlState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Activity, AlertTriangle, Bell, CheckCircle2, CircleDollarSign, Eye, FileText, Search } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type StatusFilter = "all" | "pending" | "processing" | "sent" | "accepted" | "delivered" | "failed" | "skipped";
type ChannelFilter = "all" | "email" | "sms";

// Mirrors AuditLog.tsx's getActionDisplay color-map convention. StatusBadge
// (@/components/ui/status-badge) doesn't have a type variant whose switch
// covers pending/sent/failed/skipped, so we inline the mapping here instead
// of forcing an unrelated variant onto it.
function getStatusDisplay(status: string): { color: string; label: string } {
  switch (status.toLowerCase()) {
    case "sent":
    case "accepted":
      return { color: "bg-blue-100 text-blue-800", label: status === "accepted" ? "Accepted" : "Sent" };
    case "delivered":
      return { color: "bg-green-100 text-green-800", label: "Delivered" };
    case "processing":
      return { color: "bg-blue-100 text-blue-800", label: "Processing" };
    case "pending":
      return { color: "bg-amber-100 text-amber-800", label: "Pending" };
    case "failed":
      return { color: "bg-red-100 text-red-800", label: "Failed" };
    case "skipped":
      return { color: "bg-gray-100 text-gray-600", label: "Skipped" };
    default:
      return { color: "bg-gray-100 text-gray-800", label: status };
  }
}

function formatUsdMicros(micros: number | null | undefined): string {
  if (micros == null) return "Not configured";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(micros / 1_000_000);
}

function templateVariables(subject: string, body: string): string[] {
  const matches = `${subject}
${body}`.matchAll(/\{\{([a-z][a-z0-9_]*)\}\}/g);
  return Array.from(new Set(Array.from(matches, (match) => match[1])));
}

// Synced into the URL via useUrlState so a deep link like AdminDashboard's "Failed Deliveries"
// tile (?status=failed) pre-selects the matching filter on load, and Back/Forward between two
// filtered views of this page works instead of resetting to "all" every time.
const NOTIFICATION_DELIVERIES_URL_DEFAULTS = {
  status: "all",
  channel: "all",
  search: "",
};

export default function NotificationDeliveries() {
  const { toast } = useToast();
  const [urlState, setUrlState] = useUrlState(NOTIFICATION_DELIVERIES_URL_DEFAULTS);
  const statusFilter = urlState.status as StatusFilter;
  const channelFilter = urlState.channel as ChannelFilter;
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [evidenceDeliveryId, setEvidenceDeliveryId] = useState<string | null>(null);
  const [templateScope, setTemplateScope] = useState("global");
  const [templateKey, setTemplateKey] = useState("default");
  const [templateChannel, setTemplateChannel] = useState<"email" | "sms">("email");
  const [templateSubject, setTemplateSubject] = useState("CareMetric Train notification");
  const [templateBody, setTemplateBody] = useState(
    "A training or compliance item requires attention. Sign in to CareMetric Train to review it securely.",
  );
  const [spendOrganizationId, setSpendOrganizationId] = useState("");
  const [monthlyBudgetUsd, setMonthlyBudgetUsd] = useState("");
  const [emailEstimateUsd, setEmailEstimateUsd] = useState("0");
  const [smsEstimateUsd, setSmsEstimateUsd] = useState("0");
  const [warningPercent, setWarningPercent] = useState("80");
  const [fallbackEnabled, setFallbackEnabled] = useState(false);
  const [fallbackDelayMinutes, setFallbackDelayMinutes] = useState("15");
  const [maxFallbackDepth, setMaxFallbackDepth] = useState("1");

  const { data: deliveriesData, isLoading } = useListNotificationDeliveries({
    status: statusFilter !== "all" ? statusFilter : undefined,
    channel: channelFilter !== "all" ? channelFilter : undefined,
  });
  const { data: orgNameMap } = useOrganizationNameMap();
  const { data: operations, isLoading: operationsLoading } = useNotificationDeliveryOperations();
  const { data: evidence, isLoading: evidenceLoading } = useNotificationDeliveryEvidence(evidenceDeliveryId);
  const { data: templates = [] } = useNotificationTemplateLibrary();
  const { mutate: retryDelivery, isPending: retrying } = useRetryNotificationDelivery();
  const { mutateAsync: bulkRetry, isPending: bulkRetrying } = useBulkRetryNotificationDeliveries();
  const { mutateAsync: previewTemplate, data: templatePreview, isPending: previewing } = usePreviewNotificationTemplate();
  const { mutateAsync: createTemplate, isPending: savingTemplate } = useCreateNotificationTemplateVersion();
  const { mutateAsync: activateTemplate, isPending: activatingTemplate } = useActivateNotificationTemplate();
  const { mutateAsync: setSpendPolicy, isPending: savingSpendPolicy } = useSetNotificationSpendPolicy();
  const { mutateAsync: setChannelPolicy, isPending: savingChannelPolicy } = useSetNotificationChannelPolicy();
  const { mutate: acknowledgeSpendAlert, isPending: acknowledgingSpendAlert } = useAcknowledgeNotificationSpendAlert();
  const anyRetryInFlight = retrying || bulkRetrying;
  const selectedOperationsPolicy = operations?.policies.find(
    (item) => item.organizationId === spendOrganizationId,
  );

  useEffect(() => {
    if (!spendOrganizationId || !operations) return;
    const policy = selectedOperationsPolicy;
    if (!policy) {
      setMonthlyBudgetUsd("");
      setEmailEstimateUsd("0");
      setSmsEstimateUsd("0");
      setWarningPercent("80");
      setFallbackEnabled(false);
      setFallbackDelayMinutes("15");
      setMaxFallbackDepth("1");
      return;
    }
    setMonthlyBudgetUsd(policy.monthlyBudgetMicros == null ? "" : String(policy.monthlyBudgetMicros / 1_000_000));
    setEmailEstimateUsd(String(policy.emailEstimateMicros / 1_000_000));
    setSmsEstimateUsd(String(policy.smsEstimateMicros / 1_000_000));
    setWarningPercent(String(policy.warningPercent));
    setFallbackEnabled(policy.fallbackEnabled);
    setFallbackDelayMinutes(String(policy.fallbackDelayMinutes));
    setMaxFallbackDepth(String(policy.maxFallbackDepth));
  }, [
    spendOrganizationId,
    selectedOperationsPolicy?.fallbackEnabled,
    selectedOperationsPolicy?.fallbackDelayMinutes,
    selectedOperationsPolicy?.maxFallbackDepth,
    selectedOperationsPolicy?.monthlyBudgetMicros,
    selectedOperationsPolicy?.warningPercent,
    selectedOperationsPolicy?.emailEstimateMicros,
    selectedOperationsPolicy?.smsEstimateMicros,
  ]);

  const deliveries = deliveriesData ?? [];

  // Client-side, not server-side: useListNotificationDeliveries caps at 200 rows (its own
  // .limit()), so the full filtered set is already sitting in memory -- no need for a server round
  // trip per keystroke. Matches the raw recipient column plus the organization name resolved via
  // orgNameMap, since organization_id alone isn't human-searchable.
  const search = urlState.search.trim().toLowerCase();
  const filteredDeliveries = search
    ? deliveries.filter((d) => {
        const orgName = orgNameMap?.[d.organization_id] ?? "";
        return d.recipient.toLowerCase().includes(search) || orgName.toLowerCase().includes(search);
      })
    : deliveries;

  // Based on the full (unfiltered-by-search) fetch, not filteredDeliveries -- a row that scrolls
  // out of view because of the search box shouldn't silently vanish from the bulk-retry count.
  const failedIds = new Set(deliveries.filter((d) => d.status === "failed").map((d) => d.id));
  const selectedFailedIds = Array.from(selectedIds).filter((id) => failedIds.has(id));
  const visibleFailedIds = filteredDeliveries.filter((d) => d.status === "failed").map((d) => d.id);
  const allVisibleFailedSelected = visibleFailedIds.length > 0 && visibleFailedIds.every((id) => selectedIds.has(id));

  const handleRetry = (deliveryId: string) => {
    retryDelivery(deliveryId, {
      onSuccess: () => toast({ title: "Delivery queued for retry", variant: "success" }),
      onError: (e: Error) => toast({ title: "Failed to retry delivery", description: e.message, variant: "destructive" }),
    });
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllVisibleFailed = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleFailedSelected) visibleFailedIds.forEach((id) => next.delete(id));
      else visibleFailedIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const handleBulkRetry = async () => {
    if (!selectedFailedIds.length) return;
    const ids = selectedFailedIds;
    const results = await bulkRetry(ids);
    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    const failedCount = results.length - succeeded;
    setSelectedIds(new Set());
    if (failedCount === 0) {
      toast({ title: `${succeeded} deliver${succeeded === 1 ? "y" : "ies"} queued for retry`, variant: "success" });
    } else if (succeeded === 0) {
      toast({ title: `Failed to queue ${failedCount} deliver${failedCount === 1 ? "y" : "ies"} for retry`, variant: "destructive" });
    } else {
      toast({
        title: `${succeeded} of ${results.length} deliveries queued for retry`,
        description: `${failedCount} could not be queued -- try again.`,
        variant: "destructive",
      });
    }
  };

  const previewVariables = {
    title: "Annual training reminder",
    body: "Sign in to review the training item securely.",
    organization_name: "Example care organization",
    action_url: "/me",
  };

  const handlePreviewTemplate = async () => {
    try {
      await previewTemplate({
        subjectTemplate: templateSubject,
        bodyTemplate: templateBody,
        allowedVariables: templateVariables(templateSubject, templateBody),
        variables: previewVariables,
      });
    } catch (error) {
      toast({
        title: "Template preview failed",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    }
  };

  const handleSaveTemplate = async () => {
    try {
      await createTemplate({
        organizationId: templateScope === "global" ? undefined : templateScope,
        templateKey,
        channel: templateChannel,
        subjectTemplate: templateSubject,
        bodyTemplate: templateBody,
        allowedVariables: templateVariables(templateSubject, templateBody),
      });
      toast({ title: "Template version activated", variant: "success" });
    } catch (error) {
      toast({
        title: "Template could not be saved",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    }
  };

  const handleActivateTemplate = async (templateId: string) => {
    try {
      await activateTemplate(templateId);
      toast({ title: "Template version activated", variant: "success" });
    } catch (error) {
      toast({
        title: "Template could not be activated",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    }
  };

  const handleSaveSpendPolicy = async () => {
    if (!spendOrganizationId) return;
    try {
      await setSpendPolicy({
        organizationId: spendOrganizationId,
        monthlyBudgetUsd: monthlyBudgetUsd.trim() ? Number(monthlyBudgetUsd) : null,
        emailEstimateUsd: Number(emailEstimateUsd),
        smsEstimateUsd: Number(smsEstimateUsd),
        warningPercent: Number(warningPercent),
      });
      toast({ title: "Notification spend policy saved", variant: "success" });
    } catch (error) {
      toast({
        title: "Spend policy could not be saved",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    }
  };

  const handleSaveChannelPolicy = async () => {
    if (!spendOrganizationId) return;
    try {
      await setChannelPolicy({
        organizationId: spendOrganizationId,
        fallbackEnabled,
        fallbackDelayMinutes: Number(fallbackDelayMinutes),
        maxFallbackDepth: Number(maxFallbackDepth),
      });
      toast({ title: "Notification fallback policy saved", variant: "success" });
    } catch (error) {
      toast({
        title: "Fallback policy could not be saved",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Notification Deliveries</h1>
        <p className="text-muted-foreground">Provider outcomes, fallback evidence, templates, retries, and estimated spend.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardContent className="pt-5 flex items-start justify-between">
            <div><p className="text-sm text-muted-foreground">Delivered (24h)</p><p className="text-2xl font-bold">{operationsLoading ? "--" : operations?.summary.delivered ?? 0}</p></div>
            <CheckCircle2 className="h-5 w-5 text-green-600" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 flex items-start justify-between">
            <div><p className="text-sm text-muted-foreground">Actionable failures</p><p className="text-2xl font-bold">{operationsLoading ? "--" : operations?.summary.failed ?? 0}</p></div>
            <AlertTriangle className="h-5 w-5 text-destructive" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 flex items-start justify-between">
            <div><p className="text-sm text-muted-foreground">Awaiting provider final</p><p className="text-2xl font-bold">{operationsLoading ? "--" : operations?.summary.awaitingFinal ?? 0}</p></div>
            <Activity className="h-5 w-5 text-blue-600" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 flex items-start justify-between">
            <div><p className="text-sm text-muted-foreground">Fallbacks (24h)</p><p className="text-2xl font-bold">{operationsLoading ? "--" : operations?.summary.fallbacks ?? 0}</p></div>
            <Bell className="h-5 w-5 text-amber-600" />
          </CardContent>
        </Card>
      </div>

      {Boolean(operations?.spendAlerts.length) && (
        <Card className="border-amber-300 bg-amber-50/50">
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><CircleDollarSign className="h-5 w-5" />Open spend alerts</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {operations?.spendAlerts.map((alert) => (
              <div key={alert.id} className="flex items-center justify-between gap-4 rounded-md border bg-background p-3">
                <div>
                  <p className="font-medium">{alert.organizationName} reached {alert.thresholdPercent}% of its monthly notification budget</p>
                  <p className="text-sm text-muted-foreground">Estimated {formatUsdMicros(alert.estimatedSpendMicros)} of {formatUsdMicros(alert.budgetMicros)}</p>
                </div>
                <Button size="sm" variant="outline" disabled={acknowledgingSpendAlert} onClick={() => acknowledgeSpendAlert(alert.id)}>Acknowledge</Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-3">
          <CardTitle>All Deliveries</CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search deliveries..."
                value={urlState.search}
                onChange={(e) => setUrlState({ search: e.target.value })}
                className="pl-9 h-9 w-56"
              />
            </div>
            <Select value={statusFilter} onValueChange={(v) => setUrlState({ status: v })}>
              <SelectTrigger className="w-36 h-9"><SelectValue placeholder="All Statuses" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="processing">Processing</SelectItem>
                <SelectItem value="sent">Sent</SelectItem>
                <SelectItem value="accepted">Accepted</SelectItem>
                <SelectItem value="delivered">Delivered</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="skipped">Skipped</SelectItem>
              </SelectContent>
            </Select>
            <Select value={channelFilter} onValueChange={(v) => setUrlState({ channel: v })}>
              <SelectTrigger className="w-32 h-9"><SelectValue placeholder="All Channels" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Channels</SelectItem>
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="sms">SMS</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(6)].map((_, i) => <div key={i} className="h-12 bg-muted animate-pulse rounded-md" />)}
            </div>
          ) : !filteredDeliveries.length ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-3">
                <Bell className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="font-medium text-muted-foreground">No notification deliveries found</p>
              <p className="text-sm text-muted-foreground/60 mt-1">Try adjusting your search or filters, or check back after the next notification run.</p>
            </div>
          ) : (
            <>
              {selectedFailedIds.length > 0 && (
                <div className="flex items-center gap-3 px-4 py-2 mb-3 bg-muted rounded-md border flex-wrap">
                  <span className="text-sm font-medium">
                    {selectedFailedIds.length} failed deliver{selectedFailedIds.length === 1 ? "y" : "ies"} selected
                  </span>
                  <Button size="sm" variant="outline" onClick={handleBulkRetry} disabled={anyRetryInFlight}>
                    {bulkRetrying ? "Retrying..." : "Retry Selected Failed"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>Clear Selection</Button>
                </div>
              )}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={allVisibleFailedSelected}
                        onCheckedChange={toggleSelectAllVisibleFailed}
                        disabled={visibleFailedIds.length === 0}
                        aria-label="Select all failed deliveries"
                      />
                    </TableHead>
                    <TableHead>Organization</TableHead>
                    <TableHead>Recipient</TableHead>
                    <TableHead>Channel</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Provider evidence</TableHead>
                    <TableHead>Created / Sent</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredDeliveries.map((delivery) => {
                    const { color, label } = getStatusDisplay(delivery.status);
                    const orgName = orgNameMap?.[delivery.organization_id] ?? delivery.organization_id;
                    return (
                      <TableRow key={delivery.id}>
                        <TableCell>
                          {delivery.status === "failed" && (
                            <Checkbox
                              checked={selectedIds.has(delivery.id)}
                              onCheckedChange={() => toggleSelected(delivery.id)}
                              aria-label={`Select delivery to ${delivery.recipient}`}
                            />
                          )}
                        </TableCell>
                        <TableCell className="font-medium">{orgName}</TableCell>
                        <TableCell>{delivery.recipient}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="uppercase text-xs">{delivery.channel}</Badge>
                        </TableCell>
                        <TableCell className="capitalize">{delivery.delivery_type.replace(/_/g, " ")}</TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <span className={`inline-flex items-center w-fit px-2 py-0.5 rounded text-xs font-medium ${color}`}>
                              {label}
                            </span>
                            {delivery.error_message && (
                              <span className="text-xs text-destructive">{delivery.error_message}</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs">
                          <div>{delivery.provider ?? "Not attempted"}</div>
                          <div className="text-muted-foreground">
                            {delivery.final_outcome ?? delivery.last_provider_status ?? "Awaiting attempt"}
                            {delivery.attempt_count > 0 ? ` / ${delivery.attempt_count} attempt${delivery.attempt_count === 1 ? "" : "s"}` : ""}
                          </div>
                          {delivery.parent_delivery_id && <Badge variant="outline" className="mt-1 text-[10px]">Fallback</Badge>}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          <div>{new Date(delivery.created_at).toLocaleString()}</div>
                          {delivery.sent_at && <div>Sent {new Date(delivery.sent_at).toLocaleString()}</div>}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button size="sm" variant="ghost" onClick={() => setEvidenceDeliveryId(delivery.id)}>
                              <Eye className="h-4 w-4 mr-1" />Evidence
                            </Button>
                            {delivery.status === "failed" && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={anyRetryInFlight}
                              onClick={() => handleRetry(delivery.id)}
                            >
                              Retry
                            </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </>
          )}
        </CardContent>
      </Card>

      {evidenceDeliveryId && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" />Delivery evidence</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => setEvidenceDeliveryId(null)}>Close</Button>
          </CardHeader>
          <CardContent>
            {evidenceLoading ? (
              <div className="h-24 rounded-md bg-muted animate-pulse" />
            ) : evidence ? (
              <div className="space-y-5">
                <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                  <div><p className="text-muted-foreground">Delivery ID</p><p className="font-mono break-all">{evidence.delivery.id}</p></div>
                  <div><p className="text-muted-foreground">Provider correlation</p><p className="font-mono break-all">{evidence.delivery.provider_message_id ?? "Not assigned"}</p></div>
                  <div><p className="text-muted-foreground">Template</p><p>{evidence.template ? `${evidence.template.key} v${evidence.template.version}` : "Legacy renderer"}</p></div>
                  <div><p className="text-muted-foreground">Final outcome</p><p className="capitalize">{evidence.delivery.final_outcome ?? "Awaiting final callback"}</p></div>
                </div>
                <div>
                  <h3 className="font-medium mb-2">Provider attempts</h3>
                  <Table>
                    <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Provider</TableHead><TableHead>Status</TableHead><TableHead>Provider ID</TableHead><TableHead>Started</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {evidence.attempts.length ? evidence.attempts.map((attempt) => (
                        <TableRow key={attempt.id}>
                          <TableCell>{attempt.attempt_number}</TableCell>
                          <TableCell className="uppercase">{attempt.provider}</TableCell>
                          <TableCell>{attempt.provider_status ?? attempt.status}</TableCell>
                          <TableCell className="font-mono text-xs">{attempt.provider_message_id ?? "--"}</TableCell>
                          <TableCell className="text-xs">{new Date(attempt.started_at).toLocaleString()}</TableCell>
                        </TableRow>
                      )) : <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No provider attempt yet.</TableCell></TableRow>}
                    </TableBody>
                  </Table>
                </div>
                <div>
                  <h3 className="font-medium mb-2">Signed provider events</h3>
                  <Table>
                    <TableHeader><TableRow><TableHead>Event</TableHead><TableHead>Outcome</TableHead><TableHead>Provider event ID</TableHead><TableHead>Occurred</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {evidence.events.length ? evidence.events.map((event) => (
                        <TableRow key={event.id}>
                          <TableCell>{event.event_type}</TableCell>
                          <TableCell>{event.outcome ?? "Progress"}</TableCell>
                          <TableCell className="font-mono text-xs">{event.provider_event_id}</TableCell>
                          <TableCell className="text-xs">{new Date(event.occurred_at).toLocaleString()}</TableCell>
                        </TableRow>
                      )) : <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No callback evidence yet.</TableCell></TableRow>}
                    </TableBody>
                  </Table>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Versioned template editor</CardTitle>
            <p className="text-sm text-muted-foreground">Preview exact provider copy, then create and atomically activate a new version.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Select value={templateScope} onValueChange={setTemplateScope}>
                <SelectTrigger><SelectValue placeholder="Scope" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="global">Global default</SelectItem>
                  {Object.entries(orgNameMap ?? {}).map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input value={templateKey} onChange={(event) => setTemplateKey(event.target.value)} placeholder="template_key" />
              <Select value={templateChannel} onValueChange={(value) => setTemplateChannel(value as "email" | "sms")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="email">Email</SelectItem><SelectItem value="sms">SMS</SelectItem></SelectContent>
              </Select>
            </div>
            <Input value={templateSubject} onChange={(event) => setTemplateSubject(event.target.value)} placeholder="Subject" />
            <Textarea value={templateBody} onChange={(event) => setTemplateBody(event.target.value)} rows={4} placeholder="Provider-safe body" />
            <p className="text-xs text-muted-foreground">Allowed placeholders: {"{{title}}, {{body}}, {{organization_name}}, {{action_url}}"}. Sensitive notification types receive generic values.</p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handlePreviewTemplate} disabled={previewing}>{previewing ? "Previewing..." : "Preview"}</Button>
              <Button onClick={handleSaveTemplate} disabled={savingTemplate}>{savingTemplate ? "Activating..." : "Save and activate version"}</Button>
            </div>
            {templatePreview && (
              <div className="rounded-md border bg-muted/30 p-3 text-sm">
                <p className="font-medium">{templatePreview.subject}</p>
                <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{templatePreview.body}</p>
              </div>
            )}
            <div className="max-h-64 overflow-auto rounded-md border">
              <Table>
                <TableHeader><TableRow><TableHead>Template</TableHead><TableHead>Scope</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
                <TableBody>
                  {templates.map((template) => (
                    <TableRow key={template.id}>
                      <TableCell><span className="font-medium">{template.templateKey}</span><span className="text-muted-foreground"> / {template.channel} / v{template.version}</span></TableCell>
                      <TableCell>{template.organizationId ? orgNameMap?.[template.organizationId] ?? "Organization" : "Global"}</TableCell>
                      <TableCell><Badge variant="outline">{template.status}</Badge></TableCell>
                      <TableCell className="text-right">{template.status !== "active" && <Button size="sm" variant="ghost" disabled={activatingTemplate} onClick={() => handleActivateTemplate(template.id)}>Activate</Button>}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Delivery cost and fallback policy</CardTitle>
            <p className="text-sm text-muted-foreground">Provider rates vary by contract. Configure estimates explicitly; no assumed rate is applied.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <Select value={spendOrganizationId} onValueChange={setSpendOrganizationId}>
              <SelectTrigger><SelectValue placeholder="Select organization" /></SelectTrigger>
              <SelectContent>{Object.entries(orgNameMap ?? {}).map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}</SelectContent>
            </Select>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><label className="text-sm font-medium">Monthly budget (USD)</label><Input type="number" min="0.01" step="0.01" value={monthlyBudgetUsd} onChange={(event) => setMonthlyBudgetUsd(event.target.value)} /></div>
              <div><label className="text-sm font-medium">Alert threshold (%)</label><Input type="number" min="1" max="99" value={warningPercent} onChange={(event) => setWarningPercent(event.target.value)} /></div>
              <div><label className="text-sm font-medium">Email estimate / attempt</label><Input type="number" min="0" step="0.000001" value={emailEstimateUsd} onChange={(event) => setEmailEstimateUsd(event.target.value)} /></div>
              <div><label className="text-sm font-medium">SMS estimate / attempt</label><Input type="number" min="0" step="0.000001" value={smsEstimateUsd} onChange={(event) => setSmsEstimateUsd(event.target.value)} /></div>
            </div>
            <Button onClick={handleSaveSpendPolicy} disabled={!spendOrganizationId || savingSpendPolicy}>{savingSpendPolicy ? "Saving..." : "Save spend policy"}</Button>

            <div className="border-t pt-4 space-y-3">
              <div className="flex items-center gap-2">
                <Checkbox id="fallback-enabled" checked={fallbackEnabled} onCheckedChange={(checked) => setFallbackEnabled(Boolean(checked))} />
                <label htmlFor="fallback-enabled" className="text-sm font-medium">Fallback to the alternate channel after permanent failure</label>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div><label className="text-sm font-medium">Fallback delay (minutes)</label><Input type="number" min="0" max="1440" value={fallbackDelayMinutes} onChange={(event) => setFallbackDelayMinutes(event.target.value)} /></div>
                <div><label className="text-sm font-medium">Maximum fallback depth</label><Input type="number" min="0" max="2" value={maxFallbackDepth} onChange={(event) => setMaxFallbackDepth(event.target.value)} /></div>
              </div>
              <Button variant="outline" onClick={handleSaveChannelPolicy} disabled={!spendOrganizationId || savingChannelPolicy}>{savingChannelPolicy ? "Saving..." : "Save fallback policy"}</Button>
            </div>

            <div className="border-t pt-4 space-y-2">
              <h3 className="font-medium">Current month estimates</h3>
              {operations?.spend.map((row) => (
                <div key={row.organizationId} className="flex items-center justify-between text-sm">
                  <span>{row.organizationName}</span>
                  <span>{formatUsdMicros(row.estimatedSpendMicros)} / {formatUsdMicros(row.budgetMicros)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
