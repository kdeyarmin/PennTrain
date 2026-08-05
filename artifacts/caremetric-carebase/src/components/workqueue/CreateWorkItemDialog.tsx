/**
 * Open a work item by hand (BACKLOG.md G11).
 *
 * The queue could only ever fill itself. Every item came from a detected condition -- an appointment
 * follow-up, a hospital return, a service exception, an automation rule -- and the client had no
 * create path at all, so work the system had not noticed could not be tracked here.
 *
 * The template is the first field rather than a detail, because it decides what closing the item
 * will require: `transition_work_item` refuses closure while a template's `required_evidence_types`
 * are unmet. Saying that before the item exists is the difference between a considered choice and a
 * surprise a week later.
 */
import { useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { useCreateManualWorkItem, useWorkItemTemplates } from "@/hooks/useWorkItems";
import { useListFacilities } from "@/hooks/useFacilities";
import { useToast } from "@/hooks/use-toast";
import {
  manualDeduplicationKey,
  manualWorkItemIssues,
  templateObligations,
  WORK_ITEM_PRIORITIES,
} from "@/lib/manualWorkItem";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { facilityDayBounds } from "@/lib/dateUtils";

export function CreateWorkItemDialog({
  organizationId,
  defaultFacilityId,
}: {
  organizationId: string | null;
  defaultFacilityId?: string;
}) {
  const [open, setOpen] = useState(false);
  const templates = useWorkItemTemplates();
  const facilities = useListFacilities(
    { organizationId: organizationId ?? undefined },
    Boolean(organizationId),
  );
  const create = useCreateManualWorkItem();
  const { toast } = useToast();

  const [templateId, setTemplateId] = useState("");
  const [facilityId, setFacilityId] = useState(defaultFacilityId ?? "");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("");
  const [dueAt, setDueAt] = useState("");

  const now = new Date();
  const template = (templates.data ?? []).find((row) => row.id === templateId);
  const form = {
    templateId,
    facilityId,
    title,
    description,
    priority,
    // `dueAt` is a date-only value off a date input, meaning a FACILITY calendar day. Stamping it
    // with a literal `Z` read it as UTC end-of-day, which in Pennsylvania is 19:59 local in summer
    // -- so from ~8pm onward manualWorkItemIssues rejected "due today" with "The due date is in the
    // past", on a day that had four hours left in it. facilityDayBounds().through is the UTC
    // instant that ends the facility day, which is what "due today" actually means.
    dueAt: dueAt ? facilityDayBounds(dueAt).through : "",
  };
  const issues = manualWorkItemIssues(form, now);
  const obligations = templateObligations(template);

  const reset = () => {
    setTemplateId(""); setTitle(""); setDescription(""); setPriority(""); setDueAt("");
    setFacilityId(defaultFacilityId ?? "");
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) reset(); }}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={!organizationId}>
          <Plus className="mr-2 h-4 w-4" />New work item
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Open a work item</DialogTitle>
          <DialogDescription>
            For work the system has not detected on its own. Submitting the same template and title twice
            returns the item that already exists rather than opening a second.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="work-item-template">Template</Label>
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger id="work-item-template">
                <SelectValue placeholder={templates.isLoading ? "Loading templates…" : "Choose a template"} />
              </SelectTrigger>
              <SelectContent>
                {(templates.data ?? []).map((row) => (
                  <SelectItem key={row.id} value={row.id}>{row.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {obligations.map((note) => (
              <p key={note} className="text-xs text-muted-foreground">{note}</p>
            ))}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="work-item-facility">Facility</Label>
            <Select value={facilityId} onValueChange={setFacilityId}>
              <SelectTrigger id="work-item-facility"><SelectValue placeholder="Choose a facility" /></SelectTrigger>
              <SelectContent>
                {(facilities.data ?? []).map((facility) => (
                  <SelectItem key={facility.id} value={facility.id}>{facility.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="work-item-title">Title</Label>
            <Input
              id="work-item-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Replace the fire extinguisher in B wing"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="work-item-description">Description</Label>
            <Textarea
              id="work-item-description"
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What needs doing, and anything the person picking it up will need to know"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="work-item-priority">Priority</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger id="work-item-priority">
                  <SelectValue placeholder={template ? `Template default (${template.default_priority})` : "Template default"} />
                </SelectTrigger>
                <SelectContent>
                  {WORK_ITEM_PRIORITIES.map((value) => (
                    <SelectItem key={value} value={value}>{value}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="work-item-due">Due</Label>
              <Input id="work-item-due" type="date" value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
              <p className="text-xs text-muted-foreground">Left empty, the template's own interval applies.</p>
            </div>
          </div>

          {issues.map((issue) => <p key={issue} className="text-xs text-muted-foreground">{issue}</p>)}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            disabled={!organizationId || issues.length > 0 || create.isPending}
            onClick={async () => {
              if (!organizationId || !template) return;
              try {
                await create.mutateAsync({
                  organizationId,
                  facilityId,
                  templateKey: template.template_key,
                  sourceType: template.source_type,
                  deduplicationKey: manualDeduplicationKey(template.template_key, title),
                  title: title.trim(),
                  description: description.trim(),
                  ownerProfileId: null,
                  priority: priority || null,
                  dueAt: form.dueAt || null,
                });
                toast({ title: "Work item opened", description: "It is in the queue and can be assigned from there." });
                setOpen(false);
                reset();
              } catch (error) {
                toast({
                  title: "Could not open the work item",
                  description: error instanceof Error ? error.message : String(error),
                  variant: "destructive",
                });
              }
            }}
          >
            {create.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Open item
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
