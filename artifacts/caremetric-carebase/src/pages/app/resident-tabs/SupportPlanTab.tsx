import { ResidentSupportPlanSection } from "@/components/residents/ResidentSupportPlanSection";
import { ServiceUtilizationCard } from "@/components/residents/ServiceUtilizationCard";
import type { ResidentTabProps } from "./types";

export default function SupportPlanTab({ resident, canManage }: ResidentTabProps) {
  return (
    <div className="space-y-6">
      <ResidentSupportPlanSection residentId={resident.id} canManage={canManage} />
      {/* The plan says what care should be; this says what it actually was. They belong on the same
          tab because a mismatch between them is the reason to revise the plan, and it is what a
          survey finds (BACKLOG.md G16.10). */}
      <ServiceUtilizationCard residentId={resident.id} />
    </div>
  );
}
