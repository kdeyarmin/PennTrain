import { Settings as SettingsIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function Settings() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Manage organization and facility settings</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SettingsIcon className="h-5 w-5" />
            Organization Settings
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-12 text-muted-foreground">
            <SettingsIcon className="h-12 w-12 mx-auto mb-4 opacity-40" />
            <p className="font-medium">Settings management coming soon</p>
            <p className="text-sm mt-1">Configure compliance thresholds, notification preferences, and more.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
