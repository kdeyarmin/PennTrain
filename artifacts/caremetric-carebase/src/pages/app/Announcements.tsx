import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BellRing, CheckCheck, Megaphone, Send } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { useAnnouncements } from "@/hooks/useProductExperience";
import { useListFacilities } from "@/hooks/useFacilities";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { QueryError, QueryLoading } from "@/components/QueryState";

const ROLES = ["org_admin", "facility_manager", "trainer", "employee", "auditor"] as const;

function ReadSummary({ announcementId }: { announcementId: string }) {
  const { data } = useQuery({
    queryKey: ["announcement_read_summary", announcementId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_announcement_read_summary", {
        p_announcement_id: announcementId,
      });
      if (error) throw error;
      return data as { audienceCount: number; seenCount: number };
    },
  });
  if (!data) return null;
  return <Badge variant="outline">{data.seenCount} of {data.audienceCount} seen</Badge>;
}

export default function Announcements() {
  const { user } = useAuth();
  const { toast } = useToast();
  const canPublish = user?.role === "org_admin" || user?.role === "facility_manager";
  const announcements = useAnnouncements();
  const { data: facilities = [] } = useListFacilities({ organizationId: user?.organizationId ?? undefined }, !!user?.organizationId);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [roles, setRoles] = useState<string[]>([]);
  const [facilityIds, setFacilityIds] = useState<string[]>([]);
  const [expiresAt, setExpiresAt] = useState("");

  const toggle = (values: string[], value: string, checked: boolean) => checked
    ? Array.from(new Set([...values, value]))
    : values.filter((item) => item !== value);

  const submit = () => {
    announcements.publish.mutate({
      title,
      body,
      audienceRoles: roles,
      audienceFacilityIds: facilityIds,
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
    }, {
      onSuccess: () => {
        setTitle(""); setBody(""); setRoles([]); setFacilityIds([]); setExpiresAt("");
        toast({ title: "Announcement published", description: "The audience has been notified in-app and through eligible push/email channels." });
      },
      onError: (error: Error) => toast({ title: "Announcement not published", description: error.message, variant: "destructive" }),
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Announcements</h1>
        <p className="text-muted-foreground">Operational broadcasts with lightweight read receipts—not policy attestations.</p>
      </div>

      {canPublish && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Megaphone className="h-5 w-5" />Publish an announcement</CardTitle>
            <CardDescription>Leave roles and facilities empty to reach everyone in your organization.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5"><Label htmlFor="announcement-title">Title</Label><Input id="announcement-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} /></div>
              <div className="space-y-1.5"><Label htmlFor="announcement-expiry">Optional expiry</Label><Input id="announcement-expiry" type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></div>
            </div>
            <div className="space-y-1.5"><Label htmlFor="announcement-body">Message</Label><Textarea id="announcement-body" value={body} onChange={(event) => setBody(event.target.value)} maxLength={5000} rows={5} /></div>
            <div className="grid gap-4 md:grid-cols-2">
              <fieldset className="space-y-2 rounded-lg border p-3"><legend className="px-1 text-sm font-medium">Roles</legend>{ROLES.map((role) => <label key={role} className="flex items-center gap-2 text-sm"><Checkbox checked={roles.includes(role)} onCheckedChange={(checked) => setRoles(toggle(roles, role, checked === true))} /><span className="capitalize">{role.replace(/_/g, " ")}</span></label>)}</fieldset>
              <fieldset className="space-y-2 rounded-lg border p-3"><legend className="px-1 text-sm font-medium">Facilities</legend>{facilities.filter((facility) => !facility.is_sandbox).map((facility) => <label key={facility.id} className="flex items-center gap-2 text-sm"><Checkbox checked={facilityIds.includes(facility.id)} onCheckedChange={(checked) => setFacilityIds(toggle(facilityIds, facility.id, checked === true))} /><span>{facility.name}</span></label>)}</fieldset>
            </div>
            <Button onClick={submit} disabled={announcements.publish.isPending || title.trim().length < 3 || body.trim().length < 3}><Send className="mr-2 h-4 w-4" />Publish and notify</Button>
          </CardContent>
        </Card>
      )}

      {announcements.isLoading ? <QueryLoading what="announcements" /> : announcements.isError ? (
        <QueryError what="announcements" error={announcements.error} onRetry={() => announcements.refetch()} />
      ) : announcements.data?.length ? (
        <div className="space-y-3">{announcements.data.map((announcement) => (
          <Card key={announcement.id}>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-start justify-between gap-2"><div><CardTitle className="flex items-center gap-2 text-lg"><BellRing className="h-4 w-4" />{announcement.title}</CardTitle><CardDescription>Published {new Date(announcement.published_at).toLocaleString()}</CardDescription></div>{canPublish && <ReadSummary announcementId={announcement.id} />}</div>
            </CardHeader>
            <CardContent className="space-y-3"><p className="whitespace-pre-wrap text-sm">{announcement.body}</p><Button variant="outline" size="sm" onClick={() => announcements.markSeen.mutate(announcement.id, { onSuccess: () => toast({ title: "Marked as seen" }) })}><CheckCheck className="mr-2 h-4 w-4" />Mark seen</Button></CardContent>
          </Card>
        ))}</div>
      ) : <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">No active announcements.</CardContent></Card>}
    </div>
  );
}
