import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useMyProfile, useUpdateProfile } from "@/hooks/useProfiles";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { QueryError } from "@/components/QueryState";
import { useToast } from "@/hooks/use-toast";
import { formatDateForDisplay } from "@/lib/dateUtils";
import { Bell, Loader2, MessageSquareText, UserRound } from "lucide-react";

interface ContactFormData {
  firstName: string;
  lastName: string;
  phone: string;
  smsOptIn: boolean;
  preferredNotificationChannel: "email" | "sms";
}

export default function NotificationSettings() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: profile, isLoading, isError, error, refetch } = useMyProfile(user?.id);
  const { mutate: updateProfile, isPending: saving } = useUpdateProfile();

  const [form, setForm] = useState<ContactFormData>({
    firstName: "",
    lastName: "",
    phone: "",
    smsOptIn: false,
    preferredNotificationChannel: "email",
  });
  // Hydrate once per profile row rather than on every refetch, so a background
  // invalidation (auth events also refresh this query) can't wipe in-progress edits.
  const [hydratedProfileId, setHydratedProfileId] = useState<string | null>(null);
  useEffect(() => {
    if (!profile || profile.id === hydratedProfileId) return;
    setForm({
      firstName: profile.first_name ?? "",
      lastName: profile.last_name ?? "",
      phone: profile.phone ?? "",
      smsOptIn: profile.sms_opt_in,
      preferredNotificationChannel: profile.preferred_notification_channel === "sms" ? "sms" : "email",
    });
    setHydratedProfileId(profile.id);
  }, [profile, hydratedProfileId]);

  const handleSave = () => {
    if (!user) return;
    if (!form.firstName.trim() || !form.lastName.trim()) {
      toast({ title: "First and last name are required", variant: "destructive" });
      return;
    }
    if (form.smsOptIn && !form.phone.trim()) {
      toast({ title: "A mobile number is required to enable text messages", variant: "destructive" });
      return;
    }
    if (form.preferredNotificationChannel === "sms" && (!form.smsOptIn || !form.phone.trim())) {
      toast({ title: "SMS can be preferred only after phone consent is enabled", variant: "destructive" });
      return;
    }
    updateProfile(
      {
        id: user.id,
        first_name: form.firstName.trim(),
        last_name: form.lastName.trim(),
        phone: form.phone || null,
        sms_opt_in: form.smsOptIn,
        preferred_notification_channel: form.preferredNotificationChannel,
      },
      {
        onSuccess: () => toast({ title: "Notification preferences saved" }),
        onError: (e: Error) =>
          toast({ title: "Failed to save preferences", description: e.message, variant: "destructive" }),
      },
    );
  };

  if (isLoading) {
    return (
      <div className="mx-auto max-w-4xl flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-primary">Account settings</p>
          <h1 className="text-3xl font-bold tracking-tight">Notification settings</h1>
          <p className="mt-2 text-muted-foreground">
            Choose how CareMetric Train reaches you about training, credentials, and compliance tasks.
          </p>
        </div>
        {!isError && (
          <Button onClick={handleSave} disabled={saving} className="shadow-sm">
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        )}
      </div>

      {isError ? (
        <QueryError what="your notification settings" error={error} onRetry={() => refetch()} />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserRound className="h-5 w-5" /> Contact details
              </CardTitle>
              <CardDescription>Reminders are sent to the contact details on file here.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-[13px]">First Name *</Label>
                  <Input
                    value={form.firstName}
                    onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))}
                    className="h-9"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[13px]">Last Name *</Label>
                  <Input
                    value={form.lastName}
                    onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))}
                    className="h-9"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[13px]">Mobile Phone</Label>
                  <Input
                    value={form.phone}
                    onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                    placeholder="(215) 555-0100"
                    className="h-9"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[13px]">Email</Label>
                  <Input value={profile?.email ?? ""} disabled className="h-9" />
                  <p className="text-[11px] text-muted-foreground">
                    Email changes require an admin action; contact your administrator.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bell className="h-5 w-5" /> Notification preferences
              </CardTitle>
              <CardDescription>
                Important reminders always appear in the app. Choose whether they also reach you by email or text.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-start gap-2 rounded-md border p-3">
                <input
                  type="checkbox"
                  id="sms-opt-in"
                  checked={form.smsOptIn}
                  onChange={e => setForm(f => ({
                    ...f,
                    smsOptIn: e.target.checked,
                    preferredNotificationChannel: e.target.checked ? f.preferredNotificationChannel : "email",
                  }))}
                  className="h-4 w-4 mt-0.5"
                />
                <label htmlFor="sms-opt-in" className="text-[13px] cursor-pointer">
                  <span className="font-medium flex items-center gap-1.5">
                    <MessageSquareText className="h-3.5 w-3.5" /> Text me training and compliance reminders
                  </span>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    By checking this box, I agree to receive automated text messages from CareMetric Train
                    about my training, credentials, and compliance tasks at the mobile number above. Message
                    frequency varies, and message and data rates may apply. Texts are sent only between
                    8:00 AM and 9:00 PM in my local time zone. I can reply STOP at any time to stop receiving
                    messages, or HELP for help. Consent is not a condition of employment.
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Your organization must also have SMS notifications turned on.
                    {profile?.sms_consent_at && form.smsOptIn && (
                      <> Consent recorded {formatDateForDisplay(profile.sms_consent_at)}.</>
                    )}
                  </p>
                </label>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[13px]">Preferred notification channel</Label>
                <Select
                  value={form.preferredNotificationChannel}
                  onValueChange={value => setForm(f => ({
                    ...f,
                    preferredNotificationChannel: value as "email" | "sms",
                  }))}
                >
                  <SelectTrigger className="h-9 w-full sm:w-64"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="email">Email first</SelectItem>
                    <SelectItem value="sms" disabled={!form.smsOptIn || !form.phone.trim()}>
                      SMS first
                    </SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  SMS becomes available only after a mobile number and consent are recorded above.
                </p>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
