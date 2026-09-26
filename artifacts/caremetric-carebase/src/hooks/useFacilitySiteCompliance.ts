import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables, TablesInsert } from "@/lib/database.types";

export type FacilitySiteReview = Tables<"facility_site_reviews">;
export function useFacilitySiteReviews(facilityId: string) {
  return useQuery({ queryKey: ["facility-site-reviews", facilityId], enabled: !!facilityId, queryFn: async () => {
    const rows: FacilitySiteReview[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.rpc("get_facility_site_reviews", { p_facility_id: facilityId, p_offset: from });
      if (error) throw error;
      rows.push(...(data ?? []));
      if (!data || data.length < 1000) return rows;
    }
  } });
}
export function useFacilitySitePolicy(facilityId: string) {
  return useQuery({ queryKey: ["facility-site-policy", facilityId], enabled: !!facilityId, queryFn: async () => {
    const { data, error } = await supabase.from("facility_site_policies").select("*").eq("facility_id", facilityId).maybeSingle();
    if (error) throw error;
    return data;
  } });
}
export function useSaveFacilitySitePolicy() {
  const client = useQueryClient();
  return useMutation({ mutationFn: async (row: TablesInsert<"facility_site_policies">) => {
    const { error } = await supabase.from("facility_site_policies").upsert(row);
    if (error) throw error;
  }, onSuccess: () => { client.invalidateQueries({ queryKey: ["facility-site-policy"] }); client.invalidateQueries({ queryKey: ["inspection_items"] }); client.invalidateQueries({ queryKey: ["alerts"] }); } });
}
export function useAddFacilitySiteReview() {
  const client = useQueryClient();
  return useMutation({ mutationFn: async (row: TablesInsert<"facility_site_reviews">) => {
    const { error } = await supabase.from("facility_site_reviews").insert(row);
    if (error) throw error;
  }, onSuccess: () => { client.invalidateQueries({ queryKey: ["facility-site-reviews"] }); client.invalidateQueries({ queryKey: ["resident-services-calendar"] }); client.invalidateQueries({ queryKey: ["inspection_items"] }); client.invalidateQueries({ queryKey: ["inspection_events"] }); client.invalidateQueries({ queryKey: ["alerts"] }); } });
}
export function useSiteSupportPlans(residentId?: string) {
  return useQuery({ queryKey: ["site-support-plans", residentId], enabled: !!residentId, queryFn: async () => {
    const { data, error } = await supabase.from("resident_support_plans").select("id,version_number,effective_date,state").eq("resident_id", residentId!).in("state", ["approved", "effective"]).order("version_number", { ascending: false });
    if (error) throw error;
    return data;
  } });
}
export function useSiteDrillRotation(facilityId: string, from: string) {
  return useQuery({ queryKey: ["site-drill-rotation", facilityId, from], enabled: !!facilityId, queryFn: async () => {
    const rows: Array<{ id: string; performed_date: string; result: string; evacuation_time_exceeded: boolean }> = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabase.from("inspection_events").select("id,performed_date,result,evacuation_time_exceeded,inspection_items!inner(facility_id,item_type)").eq("inspection_items.facility_id", facilityId).eq("inspection_items.item_type", "fire_drill_program").gte("performed_date", from).order("performed_date").order("id").range(offset, offset + 999);
      if (error) throw error;
      rows.push(...(data ?? []));
      if (!data || data.length < 1000) return rows;
    }
  } });
}

