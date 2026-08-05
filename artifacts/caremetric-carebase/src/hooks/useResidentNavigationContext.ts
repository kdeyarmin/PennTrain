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
    /**
     * A user CHOOSING a facility. Clears the resident, because a resident from the previous
     * facility is not in this one.
     */
    setFacilityId: (nextFacilityId: string) => setState({ facility: nextFacilityId, resident: "" }),
    setResidentId: (nextResidentId: string) => setState({ resident: nextResidentId }),
    /**
     * Seeding the facility for a page that opened with nothing chosen -- the single-facility
     * convenience three pages implement as `if (!facilityId && facilities.length === 1)`.
     *
     * Deliberately NOT setFacilityId, and this is the whole bug it exists to close. `facilityId`
     * above resolves to `state.facility || linkedResident.data?.facility_id`, and on a deep link
     * of the form `?resident=X` with no facility, that second term is undefined until the resident
     * query returns -- so on the first render `facilityId` is empty, the convenience effect fired,
     * and `setFacilityId` cleared `resident` as a user-initiated facility change should. The
     * deep-linked resident was gone before the page finished loading, on the single-facility orgs
     * where the convenience applies at all.
     *
     * Refusing whenever anything is already in the URL is the general form of that: a seeded
     * default has no business overwriting state the caller arrived with.
     */
    adoptDefaultFacility: (nextFacilityId: string) => {
      if (state.facility || state.resident) return;
      setState({ facility: nextFacilityId });
    },
  };
}
