import { ResidentTimelineCard } from "@/components/residents/Resident360Summary";
import type { ResidentTabProps } from "./types";

export default function TimelineTab({ resident }: ResidentTabProps) {
  return <ResidentTimelineCard residentId={resident.id} />;
}
