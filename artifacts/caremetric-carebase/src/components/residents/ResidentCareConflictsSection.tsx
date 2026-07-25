import { ResidentCareConflictsPanel } from "@/components/residents/ResidentCareConflicts";
import { useResidentCareHeader } from "@/hooks/useResidentCareHeader";
import { useResidentAssessmentReviews } from "@/hooks/useResidentAssessmentReviews";
import { useResidentConflictDispositions } from "@/hooks/useResidentCareConflicts";
import { useResidentSupportPlans } from "@/hooks/useResidentCareDelivery";
import { useResidentServiceExceptions } from "@/hooks/useFloorMode";
import { comparableAnswers, getTemplate } from "@/lib/assessmentTemplates";
import { applyConflictDispositions, detectResidentCareConflicts } from "@/lib/residentCareConflicts";

/**
 * Self-contained so it loads as its own chunk. Detection pulls in the whole template catalog, which
 * has no business sitting in the resident shell's eager bundle -- the shell is the header, the
 * attention panel, and the tab bar, and its budget exists to keep it that way.
 *
 * Every query below shares a key with the shell or a tab, so this costs no extra fetches.
 */
export default function ResidentCareConflictsSection({
  residentId, residentHref,
}: {
  residentId: string;
  residentHref: string;
}) {
  const careHeader = useResidentCareHeader(residentId);
  const { data: assessmentReviews } = useResidentAssessmentReviews(residentId);
  const { data: conflictDispositions } = useResidentConflictDispositions(residentId);
  const { data: supportPlans } = useResidentSupportPlans(residentId);
  const { data: serviceExceptions } = useResidentServiceExceptions(residentId);

  // Conflicts are derived from current records on every render rather than stored, so a
  // disagreement that returns after being resolved reappears instead of staying dismissed. Only the
  // human's disposition is persisted, keyed to the exact disagreement.
  const latestFinalReview = (assessmentReviews ?? []).find((review) => review.status === "final");
  const latestReviewTemplate = latestFinalReview ? getTemplate(latestFinalReview.template_key) : undefined;
  const activePlan = (supportPlans ?? []).find((plan) => plan.state === "active") ?? null;

  const conflicts = careHeader.data
    ? applyConflictDispositions(
      detectResidentCareConflicts({
        residentId,
        residentHref,
        header: {
          transferAssistance: careHeader.data.care.transferAssistance,
          fallRisk: careHeader.data.care.fallRisk,
          dietTexture: careHeader.data.diet?.textureConsistency ?? null,
          dietAsOf: careHeader.data.diet?.asOf ?? null,
        },
        reviewAnswers: latestFinalReview && latestReviewTemplate
          ? comparableAnswers(latestReviewTemplate, (latestFinalReview.answers ?? {}) as Record<string, unknown>)
          : [],
        reviewLabel: latestReviewTemplate?.title ?? null,
        reviewDate: latestFinalReview?.review_date ?? null,
        activePlan,
        // Structured exception documentation now exists (Phase 4b), so the detector reads real
        // records rather than an empty array. `assistance_level` is the denormalized column, which
        // is why this does not have to unpack exception_details client-side.
        serviceExceptions: (serviceExceptions ?? []).map((exception) => ({
          status: exception.completion_response ?? exception.status,
          service_name: exception.service_name,
          at: exception.performed_at ?? exception.scheduled_start,
          assistance_level: exception.documented_assistance_level,
        })),
        hospitalReturn: careHeader.data.hospital.state === "returned_reconciliation_incomplete"
          && careHeader.data.hospital.episodeId
          ? {
            episodeId: careHeader.data.hospital.episodeId,
            returnedAt: careHeader.data.hospital.since,
            recordedChanges: true,
          }
          : null,
      }),
      conflictDispositions ?? [],
    )
    : [];

  return (
    <ResidentCareConflictsPanel
      residentId={residentId}
      conflicts={conflicts}
      isLoading={careHeader.isLoading}
    />
  );
}
