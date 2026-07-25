import { Link } from "wouter";
import { ClipboardList, FilePenLine, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StateFormWorkflowStepper } from "@/components/residents/StateFormWorkflowStepper";
import { useListResidentAssessmentForms } from "@/hooks/useResidentAssessmentForms";
import { useListResidentComplianceItems } from "@/hooks/useResidentComplianceItems";
import {
  complianceStatusBadgeClassName, getComplianceFormLabel, getRequiredStateFormInfo, ITEM_TYPE_LABELS,
} from "@/lib/residentCompliance";
import { humanize } from "@/lib/utils";
import type { ResidentTabProps } from "./types";

export default function AssessmentsTab({ resident, facility, canManage, residentPathPrefix }: ResidentTabProps) {
  const { data: items, isLoading: itemsLoading } = useListResidentComplianceItems(resident.id);
  const { data: assessmentForms, isLoading: assessmentFormsLoading } = useListResidentAssessmentForms(resident.id);
  const formLabel = getComplianceFormLabel(facility?.facility_type);
  const itemById = new Map((items ?? []).map((i) => [i.id, i]));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ClipboardList className="h-5 w-5" /> {formLabel} Compliance Checklist</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {itemsLoading ? (
            <Skeleton className="h-10" />
          ) : !items?.length ? (
            <p className="text-sm text-muted-foreground">No compliance items recorded.</p>
          ) : (
            <div className="space-y-2">
              {items.map((item) => {
                const requiredForm = getRequiredStateFormInfo(item.item_type, facility?.facility_type);
                return (
                  <div key={item.id} className="p-2 rounded-lg border text-sm space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-1.5">
                          {ITEM_TYPE_LABELS[item.item_type] ?? humanize(item.item_type)}
                          {item.renewal_interval_days != null && (
                            <Badge variant="outline" className="text-[10px]">Recurring</Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Due {item.due_date ?? "—"}{item.completed_date ? ` · Completed ${item.completed_date}` : ""}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Required DHS source: <a href={requiredForm.url} target="_blank" rel="noreferrer" className="hover:underline">{requiredForm.sourceLabel}</a>
                        </p>
                        {item.triggered_by_item_id && itemById.get(item.triggered_by_item_id) && (
                          <p className="text-xs text-muted-foreground italic">
                            → triggered by {ITEM_TYPE_LABELS[itemById.get(item.triggered_by_item_id)!.item_type]
                              ?? humanize(itemById.get(item.triggered_by_item_id)!.item_type)} completed{" "}
                            {itemById.get(item.triggered_by_item_id)!.completed_date}
                          </p>
                        )}
                      </div>
                      <div className="shrink-0">
                        <Badge className={complianceStatusBadgeClassName(item.status)} variant="outline">{humanize(item.status)}</Badge>
                      </div>
                    </div>
                    <StateFormWorkflowStepper
                      item={item}
                      resident={resident}
                      facilityType={facility?.facility_type}
                      canManage={canManage}
                      triggeredByItemType={item.triggered_by_item_id ? itemById.get(item.triggered_by_item_id)?.item_type : undefined}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><FilePenLine className="h-5 w-5" /> Digital {formLabel} Forms</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Drafting/reference tool only — finalizing creates a PDF for staff and survey reference, but does
            not by itself satisfy the resident's compliance requirement. Attach the signed DHS-prescribed{" "}
            {formLabel} form using "Upload signed form" on the checklist above.
          </p>
          {assessmentFormsLoading ? (
            <Skeleton className="h-10" />
          ) : !assessmentForms?.length ? (
            <p className="text-sm text-muted-foreground">
              No {formLabel} prepared in CareMetric yet — use "Start {formLabel} prep" on a checklist item above to start one.
            </p>
          ) : (
            <div className="space-y-2">
              {assessmentForms.map((f) => (
                <div key={f.id} className="flex items-center justify-between p-2 rounded-lg border text-sm">
                  <div>
                    <div className="flex items-center gap-1.5">
                      Version {f.version_number} — {humanize(f.reason)}
                      {f.status === "finalized"
                        ? <Badge variant="outline"><Lock className="mr-1 h-3 w-3" /> Finalized</Badge>
                        : <Badge variant="outline">Draft</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {f.status === "finalized" ? `Finalized ${new Date(f.finalized_at!).toLocaleDateString()}` : `Prepared by ${f.prepared_by_name || "—"}`}
                    </p>
                  </div>
                  <Link href={`${residentPathPrefix}/${resident.id}/assessment-forms/${f.id}`} className="text-sm text-primary hover:underline">
                    {f.status === "finalized" ? "View" : "Continue"}
                  </Link>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
