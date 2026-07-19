import { useEffect, useRef, useState } from "react";
import { Settings as SettingsIcon, Palette, Bell, Clock, Upload, Building2, Send, RefreshCw, Database, FlaskConical, LockKeyhole, PanelLeftClose, Download } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { useGetOrganizationSettings, useUpsertOrganizationSettings } from "@/hooks/useOrganizationSettings";
import { useListNotificationDeliveries } from "@/hooks/useNotifications";
import { useRecalculateOrgCompliance } from "@/hooks/useTrainingRecords";
import { QueryError, QueryLoading } from "@/components/QueryState";
import { useOrganizationExports, useRestoreDemoBaseline, useSandboxActions } from "@/hooks/useProductExperience";
import { useListFacilities } from "@/hooks/useFacilities";
import { useGetOrganization } from "@/hooks/useOrganizations";

const DEFAULT_WARNING_DAYS = 90;
const DEFAULT_OAPSA_DAYS_RESIDENT = 30;
const DEFAULT_OAPSA_DAYS_NONRESIDENT = 90;
const LOGO_BUCKET = "org-branding";

interface SettingsFormData {
  emailNotificationsEnabled: boolean;
  smsNotificationsEnabled: boolean;
  webPushNotificationsEnabled: boolean;
  defaultWarningDays: string;
  oapsaProvisionalDaysResident: string;
  oapsaProvisionalDaysNonresident: string;
  idleTimeoutMinutes: string;
  kioskIdleTimeoutMinutes: string;
  hiddenNavigationSections: string[];
}

const EMPTY_FORM: SettingsFormData = {
  emailNotificationsEnabled: true,
  smsNotificationsEnabled: false,
  webPushNotificationsEnabled: true,
  defaultWarningDays: String(DEFAULT_WARNING_DAYS),
  oapsaProvisionalDaysResident: String(DEFAULT_OAPSA_DAYS_RESIDENT),
  oapsaProvisionalDaysNonresident: String(DEFAULT_OAPSA_DAYS_NONRESIDENT),
  idleTimeoutMinutes: "30",
  kioskIdleTimeoutMinutes: "5",
  hiddenNavigationSections: [],
};

const TAILORABLE_SECTIONS = [
  "Staff Training & Requirements",
  "Competency & Qualifications",
  "Credentialing & Screening",
  "Residents",
  "Incidents & Alerts",
  "Reporting & Documents",
] as const;

function parseDefaultWarningDays(json: unknown): number {
  if (json && typeof json === "object" && !Array.isArray(json) && "default" in (json as Record<string, unknown>)) {
    const value = (json as Record<string, unknown>).default;
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return DEFAULT_WARNING_DAYS;
}

export default function Settings() {
  const { user } = useAuth();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canManage = ["platform_admin", "org_admin", "facility_manager"].includes(user?.role ?? "");

  const { data: settings, isLoading, isError, error, refetch } = useGetOrganizationSettings(user?.organizationId ?? undefined);
  const { mutate: upsertSettings, isPending: saving } = useUpsertOrganizationSettings();
  const { data: deliveries } = useListNotificationDeliveries(15);
  const { mutate: recalculateCompliance, isPending: recalculating } = useRecalculateOrgCompliance();
  const exports = useOrganizationExports(user?.organizationId);
  const sandboxActions = useSandboxActions();
  const demoBaseline = useRestoreDemoBaseline();
  const { data: organization } = useGetOrganization(user?.organizationId ?? undefined);
  const { data: facilities = [] } = useListFacilities({ organizationId: user?.organizationId ?? undefined }, !!user?.organizationId);
  const sandbox = facilities.find((facility) => facility.is_sandbox && facility.is_active);

  const [form, setForm] = useState<SettingsFormData>(EMPTY_FORM);
  const [logoPath, setLogoPath] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoUploading, setLogoUploading] = useState(false);

  useEffect(() => {
    if (settings) {
      setForm({
        emailNotificationsEnabled: settings.email_notifications_enabled,
        smsNotificationsEnabled: settings.sms_notifications_enabled,
        webPushNotificationsEnabled: settings.web_push_notifications_enabled,
        defaultWarningDays: String(parseDefaultWarningDays(settings.default_warning_days)),
        oapsaProvisionalDaysResident: String(settings.oapsa_provisional_days_resident ?? DEFAULT_OAPSA_DAYS_RESIDENT),
        oapsaProvisionalDaysNonresident: String(settings.oapsa_provisional_days_nonresident ?? DEFAULT_OAPSA_DAYS_NONRESIDENT),
        idleTimeoutMinutes: String(settings.idle_timeout_minutes ?? 30),
        kioskIdleTimeoutMinutes: String(settings.kiosk_idle_timeout_minutes ?? 5),
        hiddenNavigationSections: settings.hidden_navigation_sections ?? [],
      });
      setLogoPath(settings.branding_logo_path ?? null);
    } else {
      setForm(EMPTY_FORM);
      setLogoPath(null);
    }
  }, [settings]);

  useEffect(() => {
    if (!logoPath) {
      setLogoUrl(null);
      return;
    }
    let cancelled = false;
    supabase.storage
      .from(LOGO_BUCKET)
      .createSignedUrl(logoPath, 3600)
      .then(({ data, error }) => {
        if (!cancelled && !error) setLogoUrl(data.signedUrl);
      });
    return () => {
      cancelled = true;
    };
  }, [logoPath]);

  const field = <K extends keyof SettingsFormData>(key: K, value: SettingsFormData[K]) =>
    setForm(f => ({ ...f, [key]: value }));

  const handleLogoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!user?.organizationId) {
      toast({ title: "No organization on your account", variant: "destructive" });
      return;
    }

    const ext = file.name.split(".").pop() ?? "png";
    const path = `${user.organizationId}/logo.${ext}`;
    setLogoUploading(true);
    try {
      const { error: uploadError } = await supabase.storage
        .from(LOGO_BUCKET)
        .upload(path, file, { upsert: true });
      if (uploadError) throw uploadError;

      setLogoPath(path);
      upsertSettings(
        { organization_id: user.organizationId, branding_logo_path: path },
        {
          onSuccess: () => toast({ title: "Logo uploaded" }),
          onError: (err: Error) =>
            toast({ title: "Logo uploaded, but failed to save", description: err.message, variant: "destructive" }),
        },
      );
    } catch (err) {
      toast({
        title: "Logo upload failed",
        description:
          err instanceof Error
            ? `${err.message} (the "org-branding" storage bucket may not exist yet)`
            : "The \"org-branding\" storage bucket may not exist yet.",
        variant: "destructive",
      });
    } finally {
      setLogoUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleSave = () => {
    if (!user?.organizationId) return;
    const parsedDays = parseInt(form.defaultWarningDays, 10);
    const parsedOapsaResident = parseInt(form.oapsaProvisionalDaysResident, 10);
    const parsedOapsaNonresident = parseInt(form.oapsaProvisionalDaysNonresident, 10);
    const idleTimeoutMinutes = parseInt(form.idleTimeoutMinutes, 10);
    const kioskIdleTimeoutMinutes = parseInt(form.kioskIdleTimeoutMinutes, 10);
    upsertSettings(
      {
        organization_id: user.organizationId,
        email_notifications_enabled: form.emailNotificationsEnabled,
        sms_notifications_enabled: form.smsNotificationsEnabled,
        web_push_notifications_enabled: form.webPushNotificationsEnabled,
        default_warning_days: { default: Number.isFinite(parsedDays) ? parsedDays : DEFAULT_WARNING_DAYS },
        oapsa_provisional_days_resident: Number.isFinite(parsedOapsaResident) ? parsedOapsaResident : DEFAULT_OAPSA_DAYS_RESIDENT,
        oapsa_provisional_days_nonresident: Number.isFinite(parsedOapsaNonresident) ? parsedOapsaNonresident : DEFAULT_OAPSA_DAYS_NONRESIDENT,
        idle_timeout_minutes: Number.isFinite(idleTimeoutMinutes) ? idleTimeoutMinutes : 30,
        kiosk_idle_timeout_minutes: Number.isFinite(kioskIdleTimeoutMinutes) ? kioskIdleTimeoutMinutes : 5,
        hidden_navigation_sections: form.hiddenNavigationSections,
      },
      {
        onSuccess: () => toast({ title: "Settings saved" }),
        onError: (err: Error) => toast({ title: "Failed to save settings", description: err.message, variant: "destructive" }),
      },
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
          <p className="text-muted-foreground">Manage organization and facility settings</p>
        </div>
        {canManage && (
          <Button onClick={handleSave} disabled={saving || isLoading} className="shadow-sm">
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        )}
      </div>

      {isError ? (
        <QueryError what="organization settings" error={error} onRetry={() => { void refetch(); }} />
      ) : isLoading ? (
        <QueryLoading what="organization settings">
          <div className="space-y-6">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-40 bg-muted animate-pulse rounded-xl" />
            ))}
          </div>
        </QueryLoading>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Palette className="h-5 w-5" />
                Branding
              </CardTitle>
              <CardDescription>Customize the logo shown to your organization's users.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-1.5">
                <Label className="text-[13px]">Organization Logo</Label>
                <div className="flex items-center gap-4">
                  <div className="h-16 w-16 rounded-lg border border-border bg-muted flex items-center justify-center overflow-hidden shrink-0">
                    {logoUrl ? (
                      <img src={logoUrl} alt="Organization logo" className="h-full w-full object-contain" />
                    ) : (
                      <Building2 className="h-6 w-6 text-muted-foreground/40" />
                    )}
                  </div>
                  {canManage && (
                    <div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={logoUploading}
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <Upload className="mr-2 h-3.5 w-3.5" />
                        {logoUploading ? "Uploading..." : "Upload Logo"}
                      </Button>
                      <input
                        ref={fileInputRef}
                        type="file"
                        className="hidden"
                        accept="image/png,image/jpeg,image/svg+xml"
                        onChange={handleLogoSelect}
                      />
                      <p className="text-xs text-muted-foreground mt-1.5">PNG, JPG, or SVG.</p>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bell className="h-5 w-5" />
                Notification Preferences
              </CardTitle>
              <CardDescription>Choose how compliance alerts and reminders are delivered.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between rounded-lg border border-border/60 p-3.5">
                <div>
                  <p className="text-sm font-medium">Email Notifications</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Send compliance warnings and expiration alerts via email.
                  </p>
                </div>
                <Switch
                  checked={form.emailNotificationsEnabled}
                  onCheckedChange={v => field("emailNotificationsEnabled", v)}
                  disabled={!canManage}
                />
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border/60 p-3.5">
                <div>
                  <p className="text-sm font-medium">SMS Notifications</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Send urgent compliance alerts via text message.
                  </p>
                </div>
                <Switch
                  checked={form.smsNotificationsEnabled}
                  onCheckedChange={v => field("smsNotificationsEnabled", v)}
                  disabled={!canManage}
                />
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border/60 p-3.5">
                <div>
                  <p className="text-sm font-medium">Web Push Notifications</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Send low-cost browser and lock-screen reminders to staff who granted permission.
                  </p>
                </div>
                <Switch
                  checked={form.webPushNotificationsEnabled}
                  onCheckedChange={v => field("webPushNotificationsEnabled", v)}
                  disabled={!canManage}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Send className="h-5 w-5" />
                Recent Notification Deliveries
              </CardTitle>
              <CardDescription>
                Email, SMS, and web-push attempts recorded by the delivery engine.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!deliveries?.length ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  No deliveries yet -- these appear once a notification channel above is enabled and a staff member
                  receives an eligible alert or reminder.
                </p>
              ) : (
                <div className="space-y-2">
                  {deliveries.map(d => (
                    <div key={d.id} className="flex items-center justify-between p-2.5 rounded-lg border text-sm">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs uppercase">{d.channel}</Badge>
                          <span className="text-muted-foreground truncate">{d.recipient}</span>
                        </div>
                        {d.error_message && (
                          <p className="text-xs text-muted-foreground mt-0.5 truncate" title={d.error_message}>
                            {d.error_message}
                          </p>
                        )}
                      </div>
                      <Badge
                        variant="outline"
                        className={
                          d.status === "sent" ? "bg-success text-success-foreground hover:bg-success/80"
                          : d.status === "failed" ? "bg-destructive text-destructive-foreground hover:bg-destructive/80"
                          : d.status === "skipped" ? "bg-muted text-muted-foreground"
                          : "bg-info text-info-foreground hover:bg-info/80"
                        }
                      >
                        {d.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Compliance Thresholds
              </CardTitle>
              <CardDescription>Set the default lead time before an employee's training is marked as expiring.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-1.5 max-w-xs">
                <Label className="text-[13px]">Default Warning Days</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={1}
                    max={365}
                    value={form.defaultWarningDays}
                    onChange={e => field("defaultWarningDays", e.target.value)}
                    disabled={!canManage}
                    className="h-9 w-28"
                  />
                  <span className="text-sm text-muted-foreground">days before expiration</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1.5">
                  Individual training types can override this default.
                </p>
              </div>

              <div className="mt-5 pt-4 border-t border-border/60 grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-md">
                <div className="space-y-1.5">
                  <Label className="text-[13px]">OAPSA Provisional Period — PA Resident</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number" min={1} max={365}
                      value={form.oapsaProvisionalDaysResident}
                      onChange={(e) => field("oapsaProvisionalDaysResident", e.target.value)}
                      disabled={!canManage}
                      className="h-9 w-24"
                    />
                    <span className="text-sm text-muted-foreground">days</span>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[13px]">OAPSA Provisional Period — Non-Resident</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number" min={1} max={365}
                      value={form.oapsaProvisionalDaysNonresident}
                      onChange={(e) => field("oapsaProvisionalDaysNonresident", e.target.value)}
                      disabled={!canManage}
                      className="h-9 w-24"
                    />
                    <span className="text-sm text-muted-foreground">days</span>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground sm:col-span-2">
                  Default countdown for a new hire's provisional-employment period on the Background Checks page, based
                  on OAPSA (6 Pa Code Sec 15.146) and the parallel PA Code provisions for personal care homes — confirm
                  with your own regulatory counsel before relying on these defaults.
                </p>
              </div>
              {canManage && user?.organizationId && (
                <div className="mt-5 pt-4 border-t border-border/60 flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium">Recompute Now</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Statuses, alerts, and annual-hours tracking normally refresh automatically overnight. Use this
                      to see a newly recorded training reflected immediately instead of waiting.
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={recalculating}
                    onClick={() =>
                      recalculateCompliance(user.organizationId!, {
                        onSuccess: () => toast({ title: "Compliance recomputed" }),
                        onError: (e: Error) => toast({ title: "Failed to recompute", description: e.message, variant: "destructive" }),
                      })
                    }
                  >
                    <RefreshCw className={`mr-2 h-4 w-4 ${recalculating ? "animate-spin" : ""}`} />
                    {recalculating ? "Recomputing..." : "Recompute Now"}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><LockKeyhole className="h-5 w-5" />Shared-device session security</CardTitle>
              <CardDescription>Soft-lock an unattended session without discarding the user’s work. Kiosk routes use the shorter timeout.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5"><Label htmlFor="idle-timeout">Standard idle timeout</Label><div className="flex items-center gap-2"><Input id="idle-timeout" type="number" min={5} max={480} value={form.idleTimeoutMinutes} onChange={(event) => field("idleTimeoutMinutes", event.target.value)} disabled={!canManage} className="w-28" /><span className="text-sm text-muted-foreground">minutes</span></div></div>
              <div className="space-y-1.5"><Label htmlFor="kiosk-idle-timeout">Kiosk idle timeout</Label><div className="flex items-center gap-2"><Input id="kiosk-idle-timeout" type="number" min={1} max={60} value={form.kioskIdleTimeoutMinutes} onChange={(event) => field("kioskIdleTimeoutMinutes", event.target.value)} disabled={!canManage} className="w-28" /><span className="text-sm text-muted-foreground">minutes</span></div></div>
              <p className="text-xs text-muted-foreground sm:col-span-2">Organization administrators and facility managers must enroll and verify TOTP MFA. Irreversible actions—including deactivation, evidence-grant revocation, and unpublishing—require a fresh AAL2 session.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><PanelLeftClose className="h-5 w-5" />Navigation module tailoring</CardTitle>
              <CardDescription>Hide modules your facilities do not use. This changes navigation only; server-side entitlements and permissions remain authoritative.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              {TAILORABLE_SECTIONS.map((section) => {
                const hidden = form.hiddenNavigationSections.includes(section);
                return <div key={section} className="flex items-center justify-between rounded-lg border p-3"><span className="text-sm font-medium">{section}</span><Switch checked={!hidden} onCheckedChange={(visible) => field("hiddenNavigationSections", visible ? form.hiddenNavigationSections.filter((item) => item !== section) : Array.from(new Set([...form.hiddenNavigationSections, section])))} disabled={!canManage} aria-label={`${hidden ? "Show" : "Hide"} ${section}`} /></div>;
              })}
            </CardContent>
          </Card>

          {user?.role === "org_admin" && organization?.is_demo && (
            <Card className="border-blue-200 bg-blue-50/40">
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><RefreshCw className="h-5 w-5" />Public demo workspace</CardTitle>
                <CardDescription>This organization contains fictional starter data. Restoring the baseline repairs or recreates the guided examples without sending email, SMS, or push notifications.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">Seed version {organization.demo_seed_version ?? 1}</p>
                  <p className="text-xs text-muted-foreground">{organization.demo_reset_at ? `Last restored ${new Date(organization.demo_reset_at).toLocaleString()}` : "Starter data has not been restored yet."}</p>
                </div>
                <Button
                  variant="outline"
                  disabled={demoBaseline.isPending}
                  onClick={() => demoBaseline.mutate(undefined, {
                    onSuccess: () => toast({ title: "Demo starter data restored" }),
                    onError: (error: Error) => toast({ title: "Demo restore failed", description: error.message, variant: "destructive" }),
                  })}
                >
                  <RefreshCw className={`mr-2 h-4 w-4 ${demoBaseline.isPending ? "animate-spin" : ""}`} />
                  Restore starter data
                </Button>
              </CardContent>
            </Card>
          )}

          {user?.role === "org_admin" && !organization?.is_demo && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><FlaskConical className="h-5 w-5" />Training sandbox</CardTitle>
                <CardDescription>A visually flagged facility with synthetic employees and residents. It is excluded from binders, reports, and peer benchmarks.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center justify-between gap-4">
                <div><p className="text-sm font-medium">{sandbox ? sandbox.name : "No sandbox created"}</p><p className="text-xs text-muted-foreground">{sandbox?.sandbox_reset_at ? `Last reset ${new Date(sandbox.sandbox_reset_at).toLocaleString()}` : "Create it before manager onboarding or practice sessions."}</p></div>
                <Button variant="outline" disabled={sandboxActions.ensure.isPending || sandboxActions.reset.isPending} onClick={() => (sandbox ? sandboxActions.reset : sandboxActions.ensure).mutate(undefined, { onSuccess: () => toast({ title: sandbox ? "Sandbox reset" : "Sandbox created" }), onError: (error: Error) => toast({ title: "Sandbox action failed", description: error.message, variant: "destructive" }) })}><RefreshCw className={`mr-2 h-4 w-4 ${(sandboxActions.ensure.isPending || sandboxActions.reset.isPending) ? "animate-spin" : ""}`} />{sandbox ? "Reset synthetic data" : "Create sandbox"}</Button>
              </CardContent>
            </Card>
          )}

          {user?.role === "org_admin" && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Database className="h-5 w-5" />Complete organization export</CardTitle>
                <CardDescription>Request a ZIP containing per-table CSVs and a document manifest with short-lived signed URLs. Completed archives expire after seven days.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Button disabled={exports.request.isPending || exports.data?.some((job) => ["pending", "processing"].includes(job.status))} onClick={() => exports.request.mutate(undefined, { onSuccess: () => toast({ title: "Organization export queued" }), onError: (error: Error) => toast({ title: "Export could not be queued", description: error.message, variant: "destructive" }) })}><Database className="mr-2 h-4 w-4" />Request complete export</Button>
                <div className="space-y-2">{exports.data?.map((job) => <div key={job.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"><div><p className="text-sm font-medium">Requested {new Date(job.requested_at).toLocaleString()}</p><p className="text-xs text-muted-foreground">{job.status === "succeeded" ? `${job.table_count} tables · ${job.row_count} rows · expires ${new Date(job.expires_at!).toLocaleString()}` : job.last_error_message ?? "The background worker is preparing the archive."}</p></div><div className="flex items-center gap-2"><Badge variant={job.status === "failed" ? "destructive" : "outline"}>{job.status}</Badge>{job.status === "succeeded" && <Button size="sm" variant="outline" disabled={exports.download.isPending} onClick={() => exports.download.mutate(job, { onSuccess: (url) => window.open(url, "_blank", "noopener,noreferrer"), onError: (error: Error) => toast({ title: "Download failed", description: error.message, variant: "destructive" }) })}><Download className="mr-2 h-4 w-4" />Download</Button>}</div></div>)}</div>
              </CardContent>
            </Card>
          )}

          {!canManage && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <SettingsIcon className="h-3.5 w-3.5" />
              You have read-only access to these settings. Contact an organization admin to make changes.
            </p>
          )}
        </>
      )}
    </div>
  );
}
