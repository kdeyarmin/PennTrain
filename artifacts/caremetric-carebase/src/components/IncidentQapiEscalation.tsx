import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { useListProfiles } from "@/hooks/useProfiles";
import { useCreateQapiProject, useListQapiProjects } from "@/hooks/useQapi";
import type { Incident } from "@/hooks/useIncidents";
import { humanize } from "@/lib/utils";
import { toLocalIsoDate } from "@/lib/dateUtils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowUpRight, ClipboardList } from "lucide-react";

// Escalate an incident into a formal QAPI quality project. The create_qapi_project RPC dedups on
// (source_type, source_id), so this is idempotent -- if the incident was already escalated, the
// existing project is shown/opened instead of creating a duplicate. Render only for managers on a
// PCH/ALF org (the QAPI routes are facility-type gated); the parent gates on that.
function ninetyDaysOut(): string {
  const d = new Date();
  d.setDate(d.getDate() + 90);
  return toLocalIsoDate(d);
}

export function IncidentQapiEscalation({ incident }: { incident: Incident }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const projectsQuery = useListQapiProjects({ facilityId: incident.facility_id });
  const { data: profiles } = useListProfiles();
  const createProject = useCreateQapiProject();

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [problem, setProblem] = useState("");
  const [completion, setCompletion] = useState("");
  const [lead, setLead] = useState("");

  const orgManagers = (profiles ?? []).filter((p) => p.is_active && ["org_admin", "facility_manager"].includes(p.role));

  const linked = (projectsQuery.data ?? []).find(
    (p) =>
      (p as { source_type?: string | null }).source_type === "incident" &&
      (p as { source_id?: string | null }).source_id === incident.id,
  ) as { id: string; project_number: string } | undefined;

  function openDialog() {
    setTitle(`QAPI: ${humanize(incident.incident_type)} follow-up`);
    setProblem(incident.narrative ?? "");
    setCompletion(ninetyDaysOut());
    setLead(orgManagers.some((p) => p.id === user?.id) ? (user?.id ?? "") : "");
    setOpen(true);
  }

  async function submit() {
    if (title.trim().length < 3) {
      toast({ title: "Title too short", description: "Use at least 3 characters.", variant: "destructive" });
      return;
    }
    if (problem.trim().length < 10) {
      toast({ title: "Problem statement too short", description: "Use at least 10 characters.", variant: "destructive" });
      return;
    }
    if (!completion) {
      toast({ title: "Target completion date is required", variant: "destructive" });
      return;
    }
    if (!lead) {
      toast({ title: "Select a project lead", variant: "destructive" });
      return;
    }
    try {
      const projectId = await createProject.mutateAsync({
        facilityId: incident.facility_id,
        title: title.trim(),
        problem: problem.trim(),
        source: `Incident: ${humanize(incident.incident_type)}`,
        baseline: "To be established during QAPI planning.",
        objective: "To be defined during QAPI planning.",
        target: "To be defined during QAPI planning.",
        completion,
        lead,
        sourceType: "incident",
        sourceId: incident.id,
      });
      toast({ title: "Escalated to QAPI", description: "A linked quality project is ready to plan." });
      setOpen(false);
      setLocation(`/app/qapi/projects/${projectId}`);
    } catch (e) {
      toast({ title: "Could not escalate", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  }

  if (linked) {
    return (
      <Button asChild variant="outline" size="sm">
        <Link href={`/app/qapi/projects/${linked.id}`}>
          <ClipboardList className="mr-1.5 h-4 w-4" />
          View QAPI project · {linked.project_number}
        </Link>
      </Button>
    );
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={openDialog}>
        <ArrowUpRight className="mr-1.5 h-4 w-4" />
        Escalate to QAPI
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Escalate to a QAPI project</DialogTitle>
            <DialogDescription>
              Creates a quality project linked to this incident. Baseline, objective, root cause, and interventions
              are refined afterward in the QAPI workspace.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="qapi-title">Title</Label>
              <Input id="qapi-title" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="qapi-problem">Problem statement</Label>
              <Textarea id="qapi-problem" rows={3} value={problem} onChange={(e) => setProblem(e.target.value)} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="qapi-date">Target completion</Label>
                <Input id="qapi-date" type="date" value={completion} onChange={(e) => setCompletion(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label>Project lead</Label>
                <Select value={lead} onValueChange={setLead}>
                  <SelectTrigger><SelectValue placeholder="Select lead" /></SelectTrigger>
                  <SelectContent>
                    {orgManagers.map((p) => <SelectItem key={p.id} value={p.id}>{p.first_name} {p.last_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={submit} disabled={createProject.isPending}>
              {createProject.isPending ? "Escalating…" : "Create QAPI project"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
