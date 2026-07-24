import { useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { useListFacilities } from "@/hooks/useFacilities";
import { useCopyComplianceRequirement, type ComplianceRequirement } from "@/hooks/useComplianceRequirements";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: ComplianceRequirement | null;
}

export function CopyTemplateDialog({ open, onOpenChange, template }: Props) {
  const { toast } = useToast();
  const { data: facilities } = useListFacilities();
  const copy = useCopyComplianceRequirement();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => { if (open) setSelected(new Set()); }, [open]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleCopy() {
    if (!template || selected.size === 0) {
      toast({ title: "Select at least one facility", variant: "destructive" });
      return;
    }
    try {
      const count = await copy.mutateAsync({ templateId: template.id, facilityIds: [...selected] });
      toast({ title: `Deployed to ${count} facilit${count === 1 ? "y" : "ies"}`, description: count < selected.size ? "Facilities that already have this requirement were skipped." : undefined });
      onOpenChange(false);
    } catch (e) {
      toast({ title: "Could not copy template", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Copy “{template?.title}” to facilities</DialogTitle>
          <DialogDescription>Creates a live, scheduled requirement in each selected facility. Facilities that already have this template are skipped.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          {(facilities ?? []).map((f) => (
            <label key={f.id} className="flex items-center gap-3 rounded-md border p-2 text-sm">
              <Checkbox checked={selected.has(f.id)} onCheckedChange={() => toggle(f.id)} />
              <Label className="cursor-pointer font-normal">{f.name}</Label>
            </label>
          ))}
          {(facilities ?? []).length === 0 && <p className="text-sm text-muted-foreground">No facilities available.</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleCopy} disabled={copy.isPending || selected.size === 0}>
            {copy.isPending ? "Copying…" : `Copy to ${selected.size || 0} facilit${selected.size === 1 ? "y" : "ies"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
