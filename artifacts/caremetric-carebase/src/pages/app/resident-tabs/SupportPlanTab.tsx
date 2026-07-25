import { ResidentSupportPlanSection } from "@/components/residents/ResidentSupportPlanSection";
import type { ResidentTabProps } from "./types";

export default function SupportPlanTab({ resident, canManage }: ResidentTabProps) {
  return <ResidentSupportPlanSection residentId={resident.id} canManage={canManage} />;
}
