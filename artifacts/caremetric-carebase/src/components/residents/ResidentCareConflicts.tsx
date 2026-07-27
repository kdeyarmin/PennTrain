import { useState } from "react";
import { Link } from "wouter";
import { ArrowRight, CheckCircle2, GitCompareArrows, ShieldQuestion } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useRecordCareConflictDisposition } from "@/hooks/useResidentCareConflicts";
import {
  CONFLICT_DISPOSITION_LABELS, type CareConflict, type ConflictDisposition,
} from "@/lib/residentCareConflicts";
import { formatDateForDisplay } from "@/lib/dateUtils";

function RecordRef({ label, at, href, caption }: { label: string; at: string | null; href?: string; caption: string }) {
  const body = (
    <>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{caption}</p>
      <p className="text-sm font-medium">{label}</p>
      <p className="text-[11px] text-muted-foreground">{at ? formatDateForDisplay(at.slice(0, 10)) : "No date recorded"}</p>
    </>
  );
  return href
    ? <Link href={href} className="block rounded-md border p-2 hover:bg-muted">{body}</Link>
    : <div className="rounded-md border p-2">{body}</div>;
}

/**
 * Conflicts are derived on every render from current records, so a resolved disagreement that comes
 * back (because the underlying values changed) reappears rather than staying silently dismissed.
 * Only the human's disposition is persisted.
 */
export function ResidentCareConflictsPanel({
  residentId,
  conflicts,
  isLoading,
}: {
  residentId: string;
  conflicts: CareConflict[];
  isLoading?: boolean;
}) {
  const { toast } = useToast();
  const record = useRecordCareConflictDisposition();
  const [resolving, setResolving] = useState<CareConflict | null>(null);
  const [disposition, setDisposition] = useState<ConflictDisposition>("accepted");
  const [note, setNote] = useState("");

  const submit = async () => {
    if (!resolving) return;
    try {
      await record.mutateAsync({
        residentId,
        conflictKey: resolving.key,
        conflictKind: resolving.kind,
        disposition,
        note: note.trim(),
      });
      toast({ title: "Disposition recorded" });
      setResolving(null);
      setNote("");
    } catch (error) {
      toast({
        title: "Could not record the disposition",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    }
  };

  if (isLoading) return null;

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2">
                <GitCompareArrows className="h-5 w-5" /> Record conflicts
              </CardTitle>
              <CardDescription>
                Where two records about this resident disagree, with both sides shown.
              </CardDescription>
            </div>
            {conflicts.length > 0 && (
              <Badge variant="outline" className="border-destructive text-destructive">
                {conflicts.length} open
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {conflicts.length === 0 ? (
            <p className="flex items-center gap-2 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
              No disagreements detected between this resident's assessment, plan, header, and documentation.
            </p>
          ) : (
            conflicts.map((conflict) => (
              <div
                key={conflict.key}
                className={`rounded-md border p-3 ${conflict.severity === "high" ? "border-l-4 border-l-destructive" : "border-l-4 border-l-amber-500"}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="font-medium">{conflict.title}</p>
                  <Badge variant="outline" className="text-[10px]">{conflict.responsibleRole}</Badge>
                </div>

                <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                  <RecordRef caption="Source" label={conflict.source.label} at={conflict.source.at} href={conflict.source.href} />
                  <ArrowRight className="hidden h-4 w-4 shrink-0 text-muted-foreground sm:block" />
                  <RecordRef caption="Conflicts with" label={conflict.conflicting.label} at={conflict.conflicting.at} href={conflict.conflicting.href} />
                </div>

                <p className="mt-2 flex items-start gap-1.5 text-sm text-muted-foreground">
                  <ShieldQuestion className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {conflict.recommendedResolution}
                </p>

                <div className="mt-2 flex justify-end">
                  <Button size="sm" variant="outline" onClick={() => { setResolving(conflict); setDisposition("accepted"); setNote(""); }}>
                    Resolve
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Dialog open={!!resolving} onOpenChange={(open) => !open && setResolving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resolve conflict</DialogTitle>
            <DialogDescription>{resolving?.title}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs" htmlFor="conflict-disposition">Disposition</Label>
              <Select value={disposition} onValueChange={(value) => setDisposition(value as ConflictDisposition)}>
                <SelectTrigger id="conflict-disposition"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(CONFLICT_DISPOSITION_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs" htmlFor="conflict-note">Why</Label>
              <Textarea
                id="conflict-note"
                rows={3}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="What you changed, or why both records are correct as they stand."
              />
              <p className="text-[11px] text-muted-foreground">
                Required. A disposition with no reason is indistinguishable from clearing a warning to make it go away.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResolving(null)}>Cancel</Button>
            <Button onClick={submit} disabled={record.isPending || note.trim().length < 5}>
              {record.isPending ? "Saving..." : "Record disposition"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
