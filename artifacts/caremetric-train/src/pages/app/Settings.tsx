import { useEffect, useRef, useState } from "react";
import { Settings as SettingsIcon, Palette, Bell, Clock, Upload, Building2, Send, RefreshCw } from "lucide-react";
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

const DEFAULT_PRIMARY_COLOR = "#2563eb";
const DEFAULT_ACCENT_COLOR = "#7c3aed";
const DEFAULT_WARNING_DAYS = 90;
const LOGO_BUCKET = "org-branding";

interface SettingsFormData {
  primaryColor: string;
  accentColor: string;
  emailNotificationsEnabled: boolean;
  smsNotificationsEnabled: boolean;
  defaultWarningDays: string;
}

const EMPTY_FORM: SettingsFormData = {
  primaryColor: DEFAULT_PRIMARY_COLOR,
  accentColor: DEFAULT_ACCENT_COLOR,
  emailNotificationsEnabled: true,
  smsNotificationsEnabled: false,
  defaultWarningDays: String(DEFAULT_WARNING_DAYS),
};

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

  const { data: settings, isLoading } = useGetOrganizationSettings(user?.organizationId ?? undefined);
  const { mutate: upsertSettings, isPending: saving } = useUpsertOrganizationSettings();
  const { data: deliveries } = useListNotificationDeliveries(15);
  const { mutate: recalculateCompliance, isPending: recalculating } = useRecalculateOrgCompliance();

  const [form, setForm] = useState<SettingsFormData>(EMPTY_FORM);
  const [logoPath, setLogoPath] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoUploading, setLogoUploading] = useState(false);

  useEffect(() => {
    if (settings) {
      setForm({
        primaryColor: settings.branding_primary_color ?? DEFAULT_PRIMARY_COLOR,
        accentColor: settings.branding_accent_color ?? DEFAULT_ACCENT_COLOR,
        emailNotificationsEnabled: settings.email_notifications_enabled,
        smsNotificationsEnabled: settings.sms_notifications_enabled,
        defaultWarningDays: String(parseDefaultWarningDays(settings.default_warning_days)),
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
    upsertSettings(
      {
        organization_id: user.organizationId,
        branding_primary_color: form.primaryColor || null,
        branding_accent_color: form.accentColor || null,
        email_notifications_enabled: form.emailNotificationsEnabled,
        sms_notifications_enabled: form.smsNotificationsEnabled,
        default_warning_days: { default: Number.isFinite(parsedDays) ? parsedDays : DEFAULT_WARNING_DAYS },
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

      {isLoading ? (
        <div className="space-y-6">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-40 bg-muted animate-pulse rounded-xl" />
          ))}
        </div>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Palette className="h-5 w-5" />
                Branding
              </CardTitle>
              <CardDescription>Customize the colors and logo shown to your organization's users.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-[13px]">Primary Color</Label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={form.primaryColor}
                      onChange={e => field("primaryColor", e.target.value)}
                      disabled={!canManage}
                      className="h-9 w-9 rounded-md border border-border cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                    />
                    <Input
                      value={form.primaryColor}
                      onChange={e => field("primaryColor", e.target.value)}
                      disabled={!canManage}
                      placeholder="#2563eb"
                      className="h-9 font-mono text-sm"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[13px]">Accent Color</Label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={form.accentColor}
                      onChange={e => field("accentColor", e.target.value)}
                      disabled={!canManage}
                      className="h-9 w-9 rounded-md border border-border cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                    />
                    <Input
                      value={form.accentColor}
                      onChange={e => field("accentColor", e.target.value)}
                      disabled={!canManage}
                      placeholder="#7c3aed"
                      className="h-9 font-mono text-sm"
                    />
                  </div>
                </div>
              </div>

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
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Send className="h-5 w-5" />
                Recent Notification Deliveries
              </CardTitle>
              <CardDescription>
                Email/SMS attempts for training due-soon and expired alerts, sent every 15 minutes by the delivery engine.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!deliveries?.length ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  No deliveries yet -- these appear once email or SMS notifications above are turned on and a staff
                  member has a training due-soon or expired alert.
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
