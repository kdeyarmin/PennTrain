import { useState } from "react";
import { Link } from "wouter";
import { BookOpen, ClipboardCheck, ClipboardList, FilePenLine, Lock, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { AssessmentReviewDialog } from "@/components/residents/AssessmentReviewDialog";
import {
  internalReviewTemplates, templateCitation, type AssessmentTemplate,
} from "@/lib/assessmentTemplates";
import { citationDisplayLabel, governedStatusByCitation, isCitationLibraryStale, PA_CITATIONS_LAST_VERIFIED } from "@/lib/paRegulatoryCitations";
import { useListCitationTopics } from "@/hooks/useCitationTopics";
import {
  useRecordAssessmentReviewClinicalReview, useResidentAssessmentReviews,
} from "@/hooks/useResidentAssessmentReviews";
import { useToast } from "@/hooks/use-toast";
import { formatDateForDisplay } from "@/lib/dateUtils";
import type { ResidentTabProps } from "./types";
import { QueryError } from "@/components/QueryState";

export default function AssessmentsTab({ resident, facility, canManage, residentPathPrefix }: ResidentTabProps) {
  const { toast } = useToast();
  // See AssessmentReviewDialog: the citation library states provenance, the database states
  // verification (BACKLOG.md F10).
  const { data: citationTopics } = useListCitationTopics();
  const governedStatuses = governedStatusByCitation(citationTopics ?? []);
  const itemsQuery = useListResidentComplianceItems(resident.id);
  const { data: items, isLoading: itemsLoading } = itemsQuery;
  const { data: reviews } = useResidentAssessmentReviews(resident.id);
  const recordClinicalReview = useRecordAssessmentReviewClinicalReview();
  const [openTemplate, setOpenTemplate] = useState<AssessmentTemplate | null>(null);
  const templates = internalReviewTemplates(facility?.facility_type);
  const assessmentFormsQuery = useListResidentAssessmentForms(resident.id);
  const { data: assessmentForms, isLoading: assessmentFormsLoading } = assessmentFormsQuery;
  const formLabel = getComplianceFormLabel(facility?.facility_type);
  const itemById = new Map((items ?? []).map((i) => [i.id, i]));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ClipboardList className="h-5 w-5" /> {formLabel} Compliance Checklist</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {itemsQuery.isError ? (
            <QueryError what="this resident's compliance items" error={itemsQuery.error} onRetry={() => void itemsQuery.refetch()} />
          ) : itemsLoading ? (
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
          {assessmentFormsQuery.isError ? (
            <QueryError what={`prepared ${formLabel} forms`} error={assessmentFormsQuery.error} onRetry={() => void assessmentFormsQuery.refetch()} />
          ) : assessmentFormsLoading ? (
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
      {templates.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ClipboardCheck className="h-5 w-5" /> Clinical reviews</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Governed internal review instruments. No DHS form prescribes these — they do not replace the
              {" "}{formLabel}, and finalizing one never completes a compliance item on its own.
            </p>
            {isCitationLibraryStale() && (
              <p className="rounded-md border border-dashed p-2 text-[11px] text-amber-700 dark:text-amber-500">
                The regulatory citation library was last reviewed {formatDateForDisplay(PA_CITATIONS_LAST_VERIFIED)} and is
                past its review window — treat the guidance below as needing re-verification.
              </p>
            )}

            <div className="grid gap-2 md:grid-cols-2">
              {templates.map((template) => {
                const latest = (reviews ?? []).find((review) => review.template_key === template.key);
                const citation = templateCitation(template);
                return (
                  <div key={template.key} className="rounded-md border p-2.5 text-sm">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium">{template.title}</p>
                        <p className="text-xs text-muted-foreground">{template.purpose}</p>
                      </div>
                      <Badge variant="outline" className="text-[10px]">v{template.version}</Badge>
                    </div>
                    {citation && (
                      <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                        <BookOpen className="h-3 w-3 shrink-0" /> {citationDisplayLabel(citation, governedStatuses[citation.citation])}
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[11px] text-muted-foreground">
                        {latest
                          ? `${humanize(latest.status)} · ${formatDateForDisplay(latest.review_date)}${latest.assessor_name ? ` · ${latest.assessor_name}` : ""}`
                          : "Not started"}
                      </span>
                      <div className="flex gap-1.5">
                        {canManage && (
                          <Button size="sm" variant="outline" onClick={() => setOpenTemplate(template)}>
                            {latest?.status === "draft" ? "Continue" : "Start review"}
                          </Button>
                        )}
                        {canManage && template.signature.clinicalReviewRequired
                          && latest?.status === "final" && !latest.clinical_reviewed_at && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={recordClinicalReview.isPending}
                            onClick={async () => {
                              try {
                                await recordClinicalReview.mutateAsync({ reviewId: latest.id, residentId: resident.id });
                                toast({ title: "Clinical review recorded" });
                              } catch (error) {
                                toast({
                                  title: "Could not record the clinical review",
                                  description: error instanceof Error ? error.message : String(error),
                                  variant: "destructive",
                                });
                              }
                            }}
                          >
                            <UserCheck className="mr-1 h-3.5 w-3.5" /> Clinical review
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {openTemplate && (
        <AssessmentReviewDialog
          open={!!openTemplate}
          onOpenChange={(next) => !next && setOpenTemplate(null)}
          residentId={resident.id}
          template={openTemplate}
          existing={(reviews ?? []).find((review) => review.template_key === openTemplate.key && review.status === "draft")}
        />
      )}

    </div>
  );
}
