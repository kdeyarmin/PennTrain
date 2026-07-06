import { useListPlatformSettings, useUpdatePlatformSetting } from "@/hooks/usePlatformSettings";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
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

export default function PlatformSettings() {
  const { toast } = useToast();
  const { data: settings, isLoading } = useListPlatformSettings();
  const { mutate: updateSetting, isPending } = useUpdatePlatformSetting();

  const handleBooleanChange = (key: string, label: string, checked: boolean) => {
    updateSetting(
      { key, value: checked },
      {
        onSuccess: () => toast({ title: `${label} ${checked ? "enabled" : "disabled"}` }),
        onError: (e: Error) => toast({ title: `Failed to update ${label}`, description: e.message, variant: "destructive" }),
      },
    );
  };

  const handleNumberChange = (key: string, label: string, value: number) => {
    if (Number.isNaN(value)) return;
    updateSetting(
      { key, value },
      {
        onSuccess: () => toast({ title: `${label} updated` }),
        onError: (e: Error) => toast({ title: `Failed to update ${label}`, description: e.message, variant: "destructive" }),
      },
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Platform Settings</h1>
        <p className="text-muted-foreground">Global switches that take effect immediately across every organization.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Settings</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : !settings?.length ? (
            <p className="text-sm text-muted-foreground">No settings found.</p>
          ) : (
            <div className="divide-y">
              {settings.map(setting => {
                const config = configFor(setting.key);
                return (
                  <div key={setting.key} className="flex items-center justify-between gap-4 py-4 first:pt-0 last:pb-0">
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
                          defaultValue={typeof setting.value === "number" ? setting.value : 0}
                          disabled={isPending}
                          className="h-9 w-24"
                          onBlur={e => handleNumberChange(setting.key, config.label, parseInt(e.target.value, 10))}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
