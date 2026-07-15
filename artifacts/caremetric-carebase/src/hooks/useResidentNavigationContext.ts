import { useGetResident } from "@/hooks/useResidents";
import { useUrlState } from "@/hooks/useUrlState";

const RESIDENT_CONTEXT_DEFAULTS = { facility: "", resident: "" };

export function useResidentNavigationContext() {
  const [state, setState] = useUrlState(RESIDENT_CONTEXT_DEFAULTS);
  const linkedResident = useGetResident(state.resident || undefined);
  const facilityId = state.facility || linkedResident.data?.facility_id || "";
  return {
    facilityId,
    residentId: state.resident,
    linkedResident,
    setFacilityId: (nextFacilityId: string) => setState({ facility: nextFacilityId, resident: "" }),
    setResidentId: (nextResidentId: string) => setState({ resident: nextResidentId }),
  };
}
