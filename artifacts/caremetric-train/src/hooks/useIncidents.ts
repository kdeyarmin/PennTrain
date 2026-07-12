import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables, TablesInsert, TablesUpdate } from "@/lib/database.types";

export type Incident = Tables<"incidents">;
export type IncidentInsert = TablesInsert<"incidents">;
export type IncidentUpdate = TablesUpdate<"incidents">;
export type IncidentStaffInvolved = Tables<"incident_staff_involved">;
export type IncidentStaffInvolvedInsert = TablesInsert<"incident_staff_involved">;
export type IncidentNotification = Tables<"incident_notifications">;
export type IncidentNotificationInsert = TablesInsert<"incident_notifications">;
export type IncidentNotificationUpdate = TablesUpdate<"incident_notifications">;

export interface ListIncidentsFilters {
  facilityId?: string;
  incidentType?: string;
  severity?: string;
  status?: string;
}

export function useListIncidents(filters: ListIncidentsFilters = {}) {
  return useQuery({
    queryKey: ["incidents", filters],
    queryFn: async () => {
      let query = supabase.from("incidents").select("*").order("occurred_at", { ascending: false });
      if (filters.facilityId) query = query.eq("facility_id", filters.facilityId);
      if (filters.incidentType) query = query.eq("incident_type", filters.incidentType);
      if (filters.severity) query = query.eq("severity", filters.severity);
      if (filters.status) query = query.eq("status", filters.status);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}

export function useGetIncident(id: string | undefined) {
  return useQuery({
    queryKey: ["incidents", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("incidents").select("*").eq("id", id!).single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });
}

export interface CreateIncidentPayload extends IncidentInsert {
  staffInvolved?: Array<Pick<IncidentStaffInvolvedInsert, "employee_id" | "involvement_type" | "statement">>;
  notifications?: Array<Pick<IncidentNotificationInsert, "notification_type" | "due_at">>;
}

// Parent-then-children pattern (mirrors useCreateCompetencyRecord in useCompetencies.ts):
// the incident row is the source of truth, so it's inserted first; if either child batch then
// fails, the incident itself is already saved and the error says exactly what didn't attach.
export function useCreateIncident() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ staffInvolved, notifications, ...incidentPayload }: CreateIncidentPayload) => {
      const { data: incident, error: incidentError } = await supabase
        .from("incidents").insert(incidentPayload).select().single();
      if (incidentError) throw incidentError;

      // organization_id/facility_id are re-derived server-side from incident_id by
      // stamp_scope_from_incident() -- included here only to satisfy the not-null insert types.
      if (staffInvolved?.length) {
        const rows = staffInvolved.map((s) => ({
          incident_id: incident.id, organization_id: incident.organization_id, facility_id: incident.facility_id, ...s,
        }));
        const { error } = await supabase.from("incident_staff_involved").insert(rows);
        if (error) throw new Error(`The incident was saved, but recording staff involvement failed: ${error.message}. Incident id: ${incident.id}.`);
      }
      if (notifications?.length) {
        const rows = notifications.map((n) => ({
          incident_id: incident.id, organization_id: incident.organization_id, facility_id: incident.facility_id, ...n,
        }));
        const { error } = await supabase.from("incident_notifications").insert(rows);
        if (error) throw new Error(`The incident was saved, but scheduling required notifications failed: ${error.message}. Incident id: ${incident.id}.`);
      }
      return incident;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["incidents"] }),
  });
}

export function useUpdateIncident() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: IncidentUpdate & { id: string }) => {
      const { data, error } = await supabase.from("incidents").update(payload).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["incidents"] });
      queryClient.invalidateQueries({ queryKey: ["incidents", variables.id] });
    },
  });
}

export function useListIncidentStaffInvolved(incidentId: string | undefined) {
  return useQuery({
    queryKey: ["incident_staff_involved", incidentId],
    queryFn: async () => {
      const { data, error } = await supabase.from("incident_staff_involved").select("*").eq("incident_id", incidentId!);
      if (error) throw error;
      return data;
    },
    enabled: !!incidentId,
  });
}

export function useAddIncidentStaffInvolved() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: IncidentStaffInvolvedInsert) => {
      const { data, error } = await supabase.from("incident_staff_involved").insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, variables) => queryClient.invalidateQueries({ queryKey: ["incident_staff_involved", variables.incident_id] }),
  });
}

export function useRemoveIncidentStaffInvolved() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; incidentId: string }) => {
      const { error } = await supabase.from("incident_staff_involved").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_data, variables) => queryClient.invalidateQueries({ queryKey: ["incident_staff_involved", variables.incidentId] }),
  });
}

// Unfiltered (RLS-scoped) lookup of every notification's parent incident_id -- used to resolve
// an alerts.incident_notification_id into a "View Incident" deep-link without a per-alert fetch.
export function useListAllIncidentNotifications() {
  return useQuery({
    queryKey: ["incident_notifications", "all"],
    queryFn: async () => {
      const { data, error } = await supabase.from("incident_notifications").select("id, incident_id");
      if (error) throw error;
      return data;
    },
  });
}

// Full (RLS-scoped) rows across every incident -- used by Reports.tsx's incident notification
// register, the reconciliation view an inspector uses to diff CareMetric Train's log against the
// regional office's own. useListAllIncidentNotifications() above stays minimal (id, incident_id
// only) for its existing deep-link-resolution use.
export function useListAllIncidentNotificationsDetailed() {
  return useQuery({
    queryKey: ["incident_notifications", "all", "detailed"],
    queryFn: async () => {
      const { data, error } = await supabase.from("incident_notifications").select("*").order("due_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

export function useListIncidentNotifications(incidentId: string | undefined) {
  return useQuery({
    queryKey: ["incident_notifications", incidentId],
    queryFn: async () => {
      const { data, error } = await supabase.from("incident_notifications").select("*").eq("incident_id", incidentId!).order("due_at");
      if (error) throw error;
      return data;
    },
    enabled: !!incidentId,
  });
}

export function useAddIncidentNotification() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: IncidentNotificationInsert) => {
      const { data, error } = await supabase.from("incident_notifications").insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, variables) => queryClient.invalidateQueries({ queryKey: ["incident_notifications", variables.incident_id] }),
  });
}

export interface GenerateIncidentReportPdfResult {
  url: string;
  path: string;
  expiresIn: number;
}

interface GenerateIncidentReportPdfResponse extends GenerateIncidentReportPdfResult {
  success?: boolean;
  error?: string;
}

// Always regenerates (no client-visible caching) -- an incident report evolves as the
// investigation progresses, so re-running this after adding findings is the expected flow.
export function useGenerateIncidentReportPdf() {
  return useMutation({
    mutationFn: async (incidentId: string): Promise<GenerateIncidentReportPdfResult> => {
      const { data, error } = await supabase.functions.invoke<GenerateIncidentReportPdfResponse>(
        "generate-incident-report-pdf",
        { body: { incidentId } },
      );
      if (error) throw error;
      if (!data || data.success === false || !data.url) {
        throw new Error(data?.error ?? "Failed to generate incident report PDF");
      }
      return { url: data.url, path: data.path, expiresIn: data.expiresIn };
    },
  });
}

export function useCompleteIncidentNotification() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, incidentId, completedByProfileId, notificationMethod, recipient, referenceNumber }: {
      id: string; incidentId: string; completedByProfileId: string; notificationMethod?: string; recipient?: string; referenceNumber?: string;
    }) => {
      const { data, error } = await supabase
        .from("incident_notifications")
        .update({
          completed_at: new Date().toISOString(),
          completed_by_profile_id: completedByProfileId,
          status: "completed",
          notification_method: notificationMethod ?? null,
          recipient: recipient ?? null,
          reference_number: referenceNumber ?? null,
        })
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, variables) => queryClient.invalidateQueries({ queryKey: ["incident_notifications", variables.incidentId] }),
  });
}
