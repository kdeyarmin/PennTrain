import { useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { useListEmployees } from "@/hooks/useEmployees";
import {
  useListExclusionScreeningMatches, useReviewExclusionScreeningMatch, useRescanOrgExclusionMatches,
  type ExclusionScreeningMatch,
} from "@/hooks/useExclusionScreening";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ShieldAlert, RefreshCw } from "lucide-react";

const SOURCE_LABELS: Record<string, string> = { oig_leie: "OIG LEIE", sam_exclusions: "SAM.gov" };

function statusBadgeClass(status: string): string {
  switch (status) {
    case "confirmed_exclusion": return "bg-destructive text-destructive-foreground hover:bg-destructive/80";
    case "false_positive": return "bg-muted text-muted-foreground";
    default: return "bg-warning text-warning-foreground hover:bg-warning/80";
  }
}

export default function ExclusionScreening() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>("pending_review");
  const [reviewing, setReviewing] = useState<{ match: ExclusionScreeningMatch; decision: "confirmed_exclusion" | "false_positive" } | null>(null);
  const [notes, setNotes] = useState("");

  const { data: matches, isLoading } = useListExclusionScreeningMatches({
    organizationId: user?.organizationId ?? undefined,
    status: statusFilter === "all" ? undefined : (statusFilter as ExclusionScreeningMatch["status"]),
  });
  const { data: employees } = useListEmployees();
  const { mutateAsync: review, isPending: reviewingPending } = useReviewExclusionScreeningMatch();
  const { mutateAsync: rescan, isPending: rescanning } = useRescanOrgExclusionMatches();

  const employeeById = useMemo(() => new Map((employees ?? []).map((e) => [e.id, e])), [employees]);

  const sorted = (matches ?? []).slice().sort((a, b) => b.created_at.localeCompare(a.created_at));

  const handleRescan = async () => {
    if (!user?.organizationId) return;
    try {
      await rescan(user.organizationId);
      toast({ title: "Roster re-scanned", description: "Any newly-matching entries now appear in the queue below." });
    } catch (e) {
      toast({ variant: "destructive", title: "Re-scan failed", description: e instanceof Error ? e.message : String(e) });
    }
  };

  const openReview = (match: ExclusionScreeningMatch, decision: "confirmed_exclusion" | "false_positive") => {
    setReviewing({ match, decision });
    setNotes(match.reviewed_notes ?? "");
  };

  const handleConfirmReview = async () => {
    if (!reviewing || !user) return;
    try {
      await review({ id: reviewing.match.id, status: reviewing.decision, reviewedBy: user.id, reviewedNotes: notes || undefined });
      toast({ title: reviewing.decision === "confirmed_exclusion" ? "Marked as confirmed exclusion" : "Marked as false positive" });
      setReviewing(null);
      setNotes("");
    } catch (e) {
      toast({ variant: "destructive", title: "Couldn't save review", description: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Exclusion Screening</h1>
          <p className="text-muted-foreground">
            OIG LEIE / SAM.gov exclusion-list matches against your roster. Fuzzy name matching can produce false positives — review each match before acting on it.
          </p>
        </div>
        <Button variant="outline" onClick={handleRescan} disabled={rescanning}>
          <RefreshCw className="mr-2 h-4 w-4" /> {rescanning ? "Re-scanning..." : "Re-scan Roster Now"}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <CardTitle className="flex items-center gap-2"><ShieldAlert className="h-5 w-5" /> Matches ({sorted.length})</CardTitle>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pending_review">Pending Review</SelectItem>
                <SelectItem value="confirmed_exclusion">Confirmed Exclusion</SelectItem>
                <SelectItem value="false_positive">False Positive</SelectItem>
                <SelectItem value="all">All</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-16 bg-muted animate-pulse rounded" />)}</div>
          ) : !sorted.length ? (
            <p className="text-sm text-muted-foreground text-center py-8">No matches in this queue. The roster is re-scanned monthly by an automated job.</p>
          ) : (
            <div className="space-y-2">
              {sorted.map((m) => {
                const employee = employeeById.get(m.employee_id);
                return (
                  <div key={m.id} className="flex items-center justify-between gap-3 p-3 rounded-lg border flex-wrap">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-sm">{employee ? `${employee.first_name} ${employee.last_name}` : m.matched_name}</p>
                        <Badge variant="outline" className="text-xs">{SOURCE_LABELS[m.source] ?? m.source}</Badge>
                        <Badge className={statusBadgeClass(m.status)}>{m.status.replace(/_/g, " ")}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Matched name: {m.matched_name} · similarity {(Number(m.match_score) * 100).toFixed(0)}%
                      </p>
                    </div>
                    {m.status === "pending_review" && (
                      <div className="flex items-center gap-2 shrink-0">
                        <Button size="sm" variant="outline" onClick={() => openReview(m, "false_positive")}>False Positive</Button>
                        <Button size="sm" variant="destructive" onClick={() => openReview(m, "confirmed_exclusion")}>Confirm Exclusion</Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!reviewing} onOpenChange={(o) => { if (!o) { setReviewing(null); setNotes(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{reviewing?.decision === "confirmed_exclusion" ? "Confirm Exclusion" : "Mark False Positive"}</DialogTitle>
            <DialogDescription>
              {reviewing?.decision === "confirmed_exclusion"
                ? "This records that the exclusion-list entry has been verified as this employee. Document any next steps (e.g. suspension, termination) separately."
                : "This records that the name match was a coincidence, not this employee."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label className="text-[13px]">Review notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Optional" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setReviewing(null); setNotes(""); }}>Cancel</Button>
            <Button onClick={handleConfirmReview} disabled={reviewingPending}>{reviewingPending ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
