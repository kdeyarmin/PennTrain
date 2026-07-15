import { useEffect, useState } from "react";
import { useListPlatformSettings, useUpdatePlatformSetting, type PlatformSetting } from "@/hooks/usePlatformSettings";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Globe, Clock, Sparkles, Settings as SettingsIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface SettingConfig {
  label: string;
  description: string;
  type: "boolean" | "number";
}

const SETTINGS_CONFIG: Record<string, SettingConfig> = {
  signup_enabled: {
    label: "Self-Service Signup",
    description: "Allow new organizations to sign themselves up at /signup.",
    type: "boolean",
  },
  maintenance_mode: {
    label: "Maintenance Mode",
    description: "Shows a site-wide banner; does not currently block logins.",
    type: "boolean",
  },
  default_trial_days: {
    label: "Default Trial Length (days)",
    description: "Number of trial days granted to a newly signed-up organization.",
    type: "number",
  },
  ai_course_generation_enabled: {
    label: "AI Course Generation",
    description: "Platform_admin AI curriculum drafting via Claude -- disable to stop new Anthropic API spend.",
    type: "boolean",
  },
  ai_wellness_summary_generation_enabled: {
    label: "AI Wellness Summary Generation",
    description: "Resident assessment summary drafting via Claude. Keep disabled until the PHI/BAA review is complete.",
    type: "boolean",
  },
  ai_compliance_copilot_enabled: {
    label: "Citation-Backed Regulatory Copilot",
    description: "Read-only compliance synthesis via Claude. Keep disabled until regulated-data, provider-contract, and governed-rule-source reviews are complete.",
    type: "boolean",
  },
  ai_document_analyzer_enabled: {
    label: "AI Document Analyzer",
    description: "State form extraction from scanned PDFs via Claude. Keep disabled until the PHI/BAA review is complete.",
    type: "boolean",
  },
  ai_video_generation_enabled: {
    label: "AI Avatar Video Generation",
    description: "HeyGen avatar-video generation for course blocks -- disable to stop new HeyGen API spend.",
    type: "boolean",
  },
};

// Settings not listed here (or not present in the seeded table yet) still render with a
// derived fallback label so a newly-added key never silently disappears from this page.
function configFor(key: string): SettingConfig {
  return (
    SETTINGS_CONFIG[key] ?? {
      label: key,
      description: "",
      type: "boolean",
    }
  );
}

interface SettingsGroup {
  title: string;
  description: string;
  icon: typeof Globe;
  keys: string[];
}

// Mirrors Settings.tsx's card-per-concern grouping pattern (icon + title + description, rows of
// controls inside) instead of one flat undifferentiated list. Any settings key not listed in any
// group here still renders, in a final "Other Settings" card below -- see leftoverSettings -- so a
// newly-added key never silently disappears the way configFor's own fallback already promises.
const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    title: "Platform Access",
    description: "Controls that take effect instantly, platform-wide, for every organization.",
    icon: Globe,
    keys: ["signup_enabled", "maintenance_mode"],
  },
  {
    title: "Trial Configuration",
    description: "Defaults applied automatically to a newly signed-up organization.",
    icon: Clock,
    keys: ["default_trial_days"],
  },
  {
    title: "AI Features",
    description: "Platform-wide switches for AI drafting and synthesis, including features that require regulated-data and provider-contract review.",
    icon: Sparkles,
    keys: ["ai_course_generation_enabled", "ai_wellness_summary_generation_enabled", "ai_compliance_copilot_enabled", "ai_video_generation_enabled"],
  },
];

const GROUPED_KEYS = new Set(SETTINGS_GROUPS.flatMap((g) => g.keys));

// The two settings whose accidental toggle has the widest blast radius: turning maintenance_mode
// ON banners every customer immediately, and turning signup_enabled OFF blocks every prospective
// organization from signing up, platform-wide, until someone notices and flips it back. Mirrors
// OrganizationDetail.tsx's suspend/reactivate asymmetry -- only the harmful direction of each
// confirms; the reversal (turning the banner back off, re-opening signups) applies instantly, same
// as "Reactivate Organization" does there.
function needsConfirm(key: string, nextValue: boolean): boolean {
  if (key === "maintenance_mode") return nextValue === true;
  if (key === "signup_enabled") return nextValue === false;
  return false;
}

const CONFIRM_COPY: Record<string, { title: string; description: string; confirmLabel: string }> = {
  maintenance_mode: {
    title: "Enable Maintenance Mode?",
    description:
      "This immediately shows a maintenance banner to every signed-in user in every organization on the platform. It does not block logins or sign anyone out -- turn it back off the moment maintenance is complete.",
    confirmLabel: "Enable Maintenance Mode",
  },
  signup_enabled: {
    title: "Disable Self-Service Signup?",
    description:
      "No new organization will be able to sign themselves up at /signup, platform-wide, until you turn this back on. Existing organizations and their users are not affected.",
    confirmLabel: "Disable Signup",
  },
};

export default function PlatformSettings() {
  const { toast } = useToast();
  const { data: settings, isLoading } = useListPlatformSettings();
  const { mutate: updateSetting, isPending } = useUpdatePlatformSetting();

  // Controlled per-key draft state for number inputs, so a failed update visibly reverts to the
  // real server value instead of leaving the input showing an unsaved edit as if it had been
  // committed. Only adopts the server value for keys not already tracked, so mid-edit typing
  // survives an unrelated settings refetch.
  const [numberDrafts, setNumberDrafts] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!settings) return;
    setNumberDrafts(prev => {
      const next = { ...prev };
      for (const s of settings) {
        if (typeof s.value === "number" && !(s.key in next)) next[s.key] = String(s.value);
      }
      return next;
    });
  }, [settings]);

  // Pending confirmation for a high-blast-radius toggle -- set by handleBooleanChange below
  // instead of applying immediately, and only actually committed (from the AlertDialog's action
  // button) once the platform_admin explicitly confirms. Lower-risk toggles skip this entirely and
  // apply the instant they're touched, same as before.
  const [confirmToggle, setConfirmToggle] = useState<{ key: string; label: string; nextValue: boolean } | null>(null);

  const applyBooleanChange = (key: string, label: string, checked: boolean) => {
    updateSetting(
      { key, value: checked },
      {
        onSuccess: () => toast({ title: `${label} ${checked ? "enabled" : "disabled"}`, variant: "success" }),
        onError: (e: Error) => toast({ title: `Failed to update ${label}`, description: e.message, variant: "destructive" }),
      },
    );
  };

  const handleBooleanChange = (key: string, label: string, checked: boolean) => {
    if (needsConfirm(key, checked)) setConfirmToggle({ key, label, nextValue: checked });
    else applyBooleanChange(key, label, checked);
  };

  const handleConfirmToggle = () => {
    if (!confirmToggle) return;
    applyBooleanChange(confirmToggle.key, confirmToggle.label, confirmToggle.nextValue);
    setConfirmToggle(null);
  };

  const handleNumberBlur = (key: string, label: string, raw: string) => {
    const value = parseInt(raw, 10);
    const serverValue = settings?.find(s => s.key === key)?.value;
    const serverValueStr = typeof serverValue === "number" ? String(serverValue) : "0";
    if (Number.isNaN(value)) {
      setNumberDrafts(prev => ({ ...prev, [key]: serverValueStr }));
      return;
    }
    updateSetting(
      { key, value },
      {
        onSuccess: () => {
          toast({ title: `${label} updated`, variant: "success" });
          setNumberDrafts(prev => ({ ...prev, [key]: String(value) }));
        },
        onError: (e: Error) => {
          toast({ title: `Failed to update ${label}`, description: e.message, variant: "destructive" });
          setNumberDrafts(prev => ({ ...prev, [key]: serverValueStr }));
        },
      },
    );
  };

  const settingsByKey = new Map((settings ?? []).map((s) => [s.key, s]));
  const leftoverSettings = (settings ?? []).filter((s) => !GROUPED_KEYS.has(s.key));

  const renderRow = (setting: PlatformSetting) => {
    const config = configFor(setting.key);
    return (
      <div key={setting.key} className="flex items-center justify-between gap-4 rounded-lg border border-border/60 p-3.5">
        <div className="min-w-0">
          <p className="text-sm font-medium">{config.label}</p>
          {config.description && (
            <p className="text-xs text-muted-foreground mt-0.5">{config.description}</p>
          )}
        </div>
        <div className="shrink-0">
          {config.type === "boolean" ? (
            <Switch
              checked={Boolean(setting.value)}
              disabled={isPending}
              onCheckedChange={checked => handleBooleanChange(setting.key, config.label, checked)}
            />
          ) : (
            <Input
              type="number"
              min="0"
              value={numberDrafts[setting.key] ?? (typeof setting.value === "number" ? String(setting.value) : "0")}
              disabled={isPending}
              className="h-9 w-24"
              onChange={e => setNumberDrafts(prev => ({ ...prev, [setting.key]: e.target.value }))}
              onBlur={e => handleNumberBlur(setting.key, config.label, e.target.value)}
            />
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Platform Settings</h1>
        <p className="text-muted-foreground">
          Global switches for every organization. Maintenance Mode and Self-Service Signup ask for confirmation
          before applying -- everything else still takes effect the instant it's touched.
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-6">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-40 w-full" />)}
        </div>
      ) : !settings?.length ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">No settings found.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {SETTINGS_GROUPS.map((group) => {
            const rows = group.keys.map((key) => settingsByKey.get(key)).filter((s): s is PlatformSetting => !!s);
            if (!rows.length) return null;
            const Icon = group.icon;
            return (
              <Card key={group.title}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Icon className="h-5 w-5" />
                    {group.title}
                  </CardTitle>
                  <CardDescription>{group.description}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {rows.map(renderRow)}
                </CardContent>
              </Card>
            );
          })}

          {leftoverSettings.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <SettingsIcon className="h-5 w-5" />
                  Other Settings
                </CardTitle>
                <CardDescription>Additional settings not yet assigned to a group above.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {leftoverSettings.map(renderRow)}
              </CardContent>
            </Card>
          )}
        </>
      )}

      <AlertDialog open={!!confirmToggle} onOpenChange={(open) => { if (!open) setConfirmToggle(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmToggle ? CONFIRM_COPY[confirmToggle.key]?.title : ""}</AlertDialogTitle>
            <AlertDialogDescription>{confirmToggle ? CONFIRM_COPY[confirmToggle.key]?.description : ""}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleConfirmToggle}
              disabled={isPending}
            >
              {confirmToggle ? CONFIRM_COPY[confirmToggle.key]?.confirmLabel : "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
