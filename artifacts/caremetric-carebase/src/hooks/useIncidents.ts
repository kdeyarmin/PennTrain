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
  residentId?: string;
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
      if (filters.residentId) query = query.eq("resident_id", filters.residentId);
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
  idempotencyKey?: string;
  staffInvolved?: Array<Pick<IncidentStaffInvolvedInsert, "employee_id" | "involvement_type" | "statement">>;
  notifications?: Array<Pick<IncidentNotificationInsert, "notification_type" | "due_at">>;
}

// One RPC persists the parent, staff, and required-notification rows in a single transaction.
// The idempotency key belongs to the mutation variables so React Query retries reuse it.
export function useCreateIncident() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ staffInvolved, notifications, idempotencyKey, ...incidentPayload }: CreateIncidentPayload) => {
      const rpc = supabase.rpc as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data: Incident | null; error: { message: string } | null }>;
      const residentId = "resident_id" in incidentPayload && typeof incidentPayload.resident_id === "string"
        ? incidentPayload.resident_id
        : typeof incidentPayload.resident_identifier === "string" && /^[0-9a-f-]{36}$/iu.test(incidentPayload.resident_identifier)
          ? incidentPayload.resident_identifier
          : null;
      const { data: incident, error } = await rpc("create_incident_atomic", {
        p_organization_id: incidentPayload.organization_id,
        p_facility_id: incidentPayload.facility_id,
        p_incident_type: incidentPayload.incident_type,
        p_occurred_at: incidentPayload.occurred_at,
        p_resident_id: residentId,
        p_resident_identifier_snapshot: residentId ? null : incidentPayload.resident_identifier ?? null,
        p_location_detail: incidentPayload.location_detail ?? null,
        p_narrative: incidentPayload.narrative,
        p_severity: incidentPayload.severity ?? "moderate",
        p_staff_involved: staffInvolved ?? [],
        p_notifications: notifications ?? [],
        p_idempotency_key: idempotencyKey ?? `incident:${crypto.randomUUID()}`,
      });
      if (error) throw new Error(error.message);
      if (!incident) throw new Error("The incident transaction completed without returning a record.");
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
// register, the reconciliation view an inspector uses to diff CareMetric CareBase's log against the
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

export interface GenerateIncidentStateFormPdfResult {
  url: string;
  fieldsFilled: number;
  sourceLabel: string;
  sourceUrl: string;
  expiresIn: number;
}

interface GenerateIncidentStateFormPdfResponse extends GenerateIncidentStateFormPdfResult {
  success?: boolean;
  error?: string;
}

// Same "always regenerates" posture as useGenerateIncidentReportPdf -- the official DHS form is
// filled from whatever's currently on the incident, so re-running after an update is expected.
export function useGenerateIncidentStateFormPdf() {
  return useMutation({
    mutationFn: async (incidentId: string): Promise<GenerateIncidentStateFormPdfResult> => {
      const { data, error } = await supabase.functions.invoke<GenerateIncidentStateFormPdfResponse>(
        "generate-incident-state-form-pdf",
        { body: { incidentId } },
      );
      if (error) throw error;
      if (!data || data.success === false || !data.url) {
        throw new Error(data?.error ?? "Failed to generate the DHS reportable incident form");
      }
      return {
        url: data.url, fieldsFilled: data.fieldsFilled,
        sourceLabel: data.sourceLabel, sourceUrl: data.sourceUrl, expiresIn: data.expiresIn,
      };
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
