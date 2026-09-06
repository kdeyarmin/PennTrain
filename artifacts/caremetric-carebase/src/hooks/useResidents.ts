import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables, TablesInsert } from "@/lib/database.types";

export type Resident = Tables<"residents">;
export type ResidentInsert = TablesInsert<"residents">;

export interface ListResidentsFilters {
  facilityId?: string;
  status?: string;
}

export interface ListResidentsOptions {
  enabled?: boolean;
}

/**
 * The full resident roster, paged.
 *
 * An unpaginated select is silently cut off at PostgREST's max-rows (1000 by default) and the
 * truncation is never an error, only a short list -- the same shape as useListResidentNames and
 * useListAllResidentComplianceItems, both of which were paged for exactly this reason. This one
 * backs the State Forms Center queue (one row per regulatory deadline, joined against this roster
 * to resolve the resident and to drop discharged ones), the dashboard census and every resident
 * picker, so past 1000 residents a deadline could disappear from a compliance queue with nothing on
 * screen saying the list was incomplete. `id` tie-breaks `last_name`, which is not unique, so a
 * page boundary inside a run of equal names cannot drop or repeat a row. BACKLOG.md J74.
 */
export function useListResidents(filters: ListResidentsFilters = {}, options: ListResidentsOptions = {}) {
  return useQuery({
    queryKey: ["residents", filters],
    queryFn: async () => {
      const pageSize = 1000;
      const all: Resident[] = [];
      for (let from = 0; ; from += pageSize) {
        let query = supabase
          .from("residents")
          .select("*")
          .order("last_name")
          .order("id", { ascending: true })
          .range(from, from + pageSize - 1);
        if (filters.facilityId) query = query.eq("facility_id", filters.facilityId);
        if (filters.status) query = query.eq("status", filters.status);
        const { data, error } = await query;
        if (error) throw error;
        const batch = (data ?? []) as Resident[];
        all.push(...batch);
        if (batch.length < pageSize || all.length >= 50000) break;
      }
      return all;
    },
    enabled: options.enabled ?? true,
  });
}

/** The columns a name lookup needs, and nothing else. */
export type ResidentNameRow = Pick<Resident, "id" | "facility_id" | "first_name" | "last_name" | "room" | "status">;

/**
 * Every resident's name, for surfaces that only resolve an id to a person (the facility-wide
 * compliance report, e.g.) rather than rendering resident records.
 *
 * Paged, for the reason useListAllResidentComplianceItems is: an unpaginated select is silently cut
 * off at PostgREST's max-rows (1000 by default), and the truncation is never an error, only a short
 * list. The compliance report joined its rows against an unpaginated useListResidents(), so past
 * 1000 residents the later rows rendered "—" for the resident name on a regulatory-deadline report
 * with nothing on screen to say the lookup was incomplete. Selecting six columns instead of `*`
 * also keeps the payload proportionate to what a name lookup actually reads.
 */
export function useListResidentNames(filters: ListResidentsFilters = {}, options: ListResidentsOptions = {}) {
  return useQuery({
    queryKey: ["residents", "names", filters],
    queryFn: async () => {
      const pageSize = 1000;
      const all: ResidentNameRow[] = [];
      for (let from = 0; ; from += pageSize) {
        let query = supabase
          .from("residents")
          .select("id,facility_id,first_name,last_name,room,status")
          .order("last_name")
          .order("id")
          .range(from, from + pageSize - 1);
        if (filters.facilityId) query = query.eq("facility_id", filters.facilityId);
        if (filters.status) query = query.eq("status", filters.status);
        const { data, error } = await query;
        if (error) throw error;
        const batch = (data ?? []) as ResidentNameRow[];
        all.push(...batch);
        if (batch.length < pageSize || all.length >= 50000) break;
      }
      return all;
    },
    enabled: options.enabled ?? true,
  });
}

export function useGetResident(id: string | undefined) {
  return useQuery({
    queryKey: ["residents", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("residents").select("*").eq("id", id!).single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });
}

// instantiate_resident_compliance_items() fires server-side via
// trigger_instantiate_resident_compliance_on_insert() -- the caller never populates the
// compliance checklist itself, just the resident row.
export function useCreateResident() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: ResidentInsert) => {
      const { data, error } = await supabase.from("residents").insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["residents"] }),
  });
}

// There is deliberately no generic `useUpdateResident`. The one caller it had was the resident
// page's status control, which wrote residents.status directly and so discharged a resident without
// releasing their bed, without a discharge reason, and without the resident_census_events row --
// leaving a bed set_bed_availability then refused to release ("Occupied or reserved beds must be
// released through census workflow"). Census changes go through transition_resident_census
// (useTransitionResidentCensus); the care profile goes through save_resident_care_profile. A bare
// table-update hook here is how that bug comes back.
