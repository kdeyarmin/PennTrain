import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, Circle, CircleDot } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { deriveAssessmentReason } from "@/lib/residentAssessmentFormSchema";
import {
  deriveStateFormWorkflow,
  type StateFormWorkflowState,
  type WorkflowAction,
  type WorkflowItem,
} from "@/lib/stateFormWorkflow";
import {
  useListResidentAssessmentForms, useStartResidentAssessmentForm, useGenerateResidentAssessmentFormPdf,
} from "@/hooks/useResidentAssessmentForms";
import {
  useListResidentDocuments, useResidentDocumentSignedUrl, useGenerateStateFormPrefill,
} from "@/hooks/useResidentDocuments";
import { CompleteWithStateFormDialog } from "./CompleteWithStateFormDialog";
import { useCompleteResidentComplianceItem } from "@/hooks/useResidentComplianceItems";

interface StateFormWorkflowStepperProps {
  item: WorkflowItem;
  resident: { id: string; organization_id: string; facility_id: string };
  facilityType: string | undefined;
  canManage: boolean;
  // The item_type of the item that cross-triggered this one (resolved by the parent, which holds
  // the full item list) -- a support_plan_30day spawned by an annual/significant-change completion
  // must start its digital form with the PARENT's reason, not "initial".
  triggeredByItemType?: string;
}

// One guided pipeline per compliance item: derives the current step from data that already exists
// and offers exactly one primary next action. Rendered on both ResidentDetail and the State Forms
// Center; the per-resident forms/documents queries share TanStack cache keys, so mounting several
// steppers for one resident costs one fetch each.
export function StateFormWorkflowStepper({ item, resident, facilityType, canManage, triggeredByItemType }: StateFormWorkflowStepperProps) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const { data: forms, isLoading: formsLoading } = useListResidentAssessmentForms(resident.id);
  const { data: documents, isLoading: documentsLoading } = useListResidentDocuments(resident.id);

  const startAssessmentForm = useStartResidentAssessmentForm();
  const generatePdf = useGenerateResidentAssessmentFormPdf();
  const generatePrefill = useGenerateStateFormPrefill();
  const completeItem = useCompleteResidentComplianceItem();
  const getSignedUrl = useResidentDocumentSignedUrl();

  const [showCompleteDialog, setShowCompleteDialog] = useState(false);

  // Never derive from unloaded data: treating a still-loading forms/documents list as empty
  // would briefly render "Start prep" for an item whose draft or finalized form already exists,
  // and a fast click in that window starts a duplicate draft instead of continuing the real one.
  if (formsLoading || documentsLoading) {
    return <Skeleton className="h-12" />;
  }

  const workflow: StateFormWorkflowState = deriveStateFormWorkflow(item, forms ?? [], documents ?? [], facilityType);

  const openDocument = async (documentId: string) => {
    const doc = (documents ?? []).find((d) => d.id === documentId);
    if (!doc) return;
    try {
      const signedUrl = await getSignedUrl.mutateAsync(doc);
      window.open(signedUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast({ title: "Download failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    }
  };

  const anyPending = startAssessmentForm.isPending || generatePdf.isPending || generatePrefill.isPending
    || completeItem.isPending || getSignedUrl.isPending;

  const runAction = (action: WorkflowAction) => {
    switch (action.key) {
      case "start_prep": {
        const reason = deriveAssessmentReason(triggeredByItemType ?? item.item_type);
        startAssessmentForm.mutate(
          { residentId: resident.id, reason, complianceItemId: item.id },
          {
            onSuccess: (newForm) => navigate(`/app/residents/${resident.id}/assessment-forms/${newForm.id}`),
            onError: (e: Error) => toast({ title: "Failed to start assessment form", description: e.message, variant: "destructive" }),
          },
        );
        break;
      }
      case "continue_draft":
        navigate(`/app/residents/${resident.id}/assessment-forms/${action.formId}`);
        break;
      case "generate_pdf":
        generatePdf.mutate(action.formId!, {
          onSuccess: () => toast({ title: "Filled DHS PDF generated" }),
          onError: (e: Error) => toast({ title: "Failed to generate PDF", description: e.message, variant: "destructive" }),
        });
        break;
      case "generate_prefilled_start":
        generatePrefill.mutate(
          { complianceItemId: item.id, residentId: resident.id },
          {
            onSuccess: (data) => {
              toast({
                title: "Prefilled form ready",
                description: data.fieldsFilled
                  ? "Resident details were filled onto the official DHS form."
                  : "The official DHS form is attached — fill it out from the resident record.",
              });
              if (data.url) window.open(data.url, "_blank", "noopener,noreferrer");
            },
            onError: (e: Error) => toast({ title: "Failed to generate prefilled form", description: e.message, variant: "destructive" }),
          },
        );
        break;
      case "download_reference_pdf":
      case "download_prefilled_start":
      case "view_signed_form":
        void openDocument(action.documentId!);
        break;
      case "download_official_blank":
        window.open(action.url!, "_blank", "noopener,noreferrer");
        break;
      case "upload_signed_form":
        setShowCompleteDialog(true);
        break;
      case "mark_compliant":
        completeItem.mutate(
          { item, documentId: action.documentId! },
          {
            onSuccess: () => toast({ title: "Marked compliant" }),
            onError: (e: Error) => toast({ title: "Failed to mark compliant", description: e.message, variant: "destructive" }),
          },
        );
        break;
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 flex-wrap text-xs">
        {workflow.steps.map((step, i) => (
          <div key={step.key} className="flex items-center gap-1.5">
            {i > 0 && <div className="h-px w-3 bg-border" aria-hidden />}
            <span
              className={cn(
                "flex items-center gap-1",
                step.state === "current" ? "font-medium text-foreground"
                  : step.state === "done" ? "text-success"
                  : "text-muted-foreground",
              )}
            >
              {step.state === "done" ? <CheckCircle2 className="h-3.5 w-3.5" />
                : step.state === "current" ? <CircleDot className="h-3.5 w-3.5" />
                : <Circle className="h-3.5 w-3.5" />}
              {step.label}
            </span>
          </div>
        ))}
      </div>

      {canManage && (workflow.primaryAction || workflow.secondaryActions.length > 0) && (
        <div className="flex items-center gap-2 flex-wrap">
          {workflow.primaryAction && (
            <Button size="sm" className="h-7 text-xs" disabled={anyPending} onClick={() => runAction(workflow.primaryAction!)}>
              {workflow.primaryAction.label}
            </Button>
          )}
          {workflow.secondaryActions.map((action) => (
            <Button
              key={action.key}
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-muted-foreground"
              disabled={anyPending}
              onClick={() => runAction(action)}
            >
              {action.label}
            </Button>
          ))}
        </div>
      )}

      <CompleteWithStateFormDialog
        item={showCompleteDialog ? item : null}
        resident={resident}
        facilityType={facilityType}
        onClose={() => setShowCompleteDialog(false)}
      />
    </div>
  );
}
