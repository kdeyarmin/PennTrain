import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Json, Tables } from "@/lib/database.types";

export type ReferralSource = Tables<"referral_sources">;
export type AdmissionProspect = Tables<"admission_prospects">;
export type AdmissionActivity = Tables<"admission_activities">;
export type FacilityBuilding = Tables<"facility_buildings">;
export type ResidentialUnit = Tables<"residential_units">;
export type FacilityRoom = Tables<"facility_rooms">;
export type FacilityBed = Tables<"facility_beds">;
export type ResidentCensusEvent = Tables<"resident_census_events">;
export type MoveInWorkspace = Tables<"move_in_workspaces">;
export type MoveInTask = Tables<"move_in_tasks">;
export type MoveInGuestGrant = Tables<"move_in_guest_grants">;
export type MoveInTaskHistory = Tables<"move_in_task_history">;

export interface AdmissionProspectWithRelations extends AdmissionProspect {
  facility: { id: string; name: string } | null;
  referral_source: { id: string; name: string; source_type: string } | null;
  resident: { id: string; status: string } | null;
}

export interface FacilityBedWithRelations extends FacilityBed {
  room: {
    id: string;
    room_number: string;
    room_type: string;
    gender_restriction: string;
    building: { id: string; name: string; licensed_capacity: number } | null;
    unit: { id: string; name: string } | null;
  } | null;
  prospect: { id: string; first_name: string; last_name: string } | null;
  resident: { id: string; first_name: string; last_name: string; status: string } | null;
}

export interface MoveInWorkspaceWithRelations extends MoveInWorkspace {
  resident: {
    id: string;
    first_name: string;
    last_name: string;
    room: string | null;
    status: string;
  } | null;
  facility: { id: string; name: string } | null;
  template: { id: string; name: string; version: number } | null;
  tasks: MoveInTask[];
}

export interface MoveInTaskWithOwner extends MoveInTask {
  owner: { id: string; first_name: string; last_name: string } | null;
  document: { id: string; file_name: string; document_label: string | null } | null;
}

function invalidateAdmissions(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ["admissions"] });
  queryClient.invalidateQueries({ queryKey: ["residents"] });
  queryClient.invalidateQueries({ queryKey: ["work-items"] });
  queryClient.invalidateQueries({ queryKey: ["closed-loop-compliance"] });
}

export function useListReferralSources(organizationId?: string) {
  return useQuery({
    queryKey: ["admissions", "referral-sources", organizationId],
    queryFn: async () => {
      let query = supabase.from("referral_sources").select("*").order("name");
      if (organizationId) query = query.eq("organization_id", organizationId);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}

export function useListAdmissionProspects(filters: {
  organizationId?: string;
  facilityId?: string;
  stage?: string;
} = {}) {
  return useQuery({
    queryKey: ["admissions", "prospects", filters],
    queryFn: async () => {
      let query = supabase
        .from("admission_prospects")
        .select(`
          *,
          facility:facilities(id, name),
          referral_source:referral_sources(id, name, source_type),
          resident:residents(id, status)
        `)
        .order("created_at", { ascending: false });
      if (filters.organizationId) query = query.eq("organization_id", filters.organizationId);
      if (filters.facilityId) query = query.eq("facility_id", filters.facilityId);
      if (filters.stage) query = query.eq("stage", filters.stage);
      const { data, error } = await query;
      if (error) throw error;
      return data as unknown as AdmissionProspectWithRelations[];
    },
  });
}

export function useListAdmissionActivities(prospectId?: string) {
  return useQuery({
    queryKey: ["admissions", "activities", prospectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("admission_activities")
        .select("*, actor:profiles!admission_activities_actor_profile_id_fkey(id, first_name, last_name)")
        .eq("prospect_id", prospectId!)
        .order("occurred_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!prospectId,
  });
}

export function useCreateReferralSource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      organizationId: string;
      name: string;
      sourceType: string;
      contactName?: string;
      phone?: string;
      email?: string;
    }) => {
      const { data, error } = await supabase.rpc("create_referral_source" as never, {
        p_organization_id: input.organizationId,
        p_name: input.name,
        p_source_type: input.sourceType,
        p_contact_name: input.contactName ?? null,
        p_phone: input.phone ?? null,
        p_email: input.email ?? null,
      } as never);
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admissions", "referral-sources"] }),
  });
}

export function useCreateAdmissionProspect() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      facilityId: string;
      firstName: string;
      lastName: string;
      dateOfBirth?: string;
      phone?: string;
      email?: string;
      referralSourceId?: string;
      expectedMoveInDate?: string;
      primaryContactName?: string;
      primaryContactRelationship?: string;
      primaryContactPhone?: string;
      primaryContactEmail?: string;
      notes?: string;
    }) => {
      const { data, error } = await supabase.rpc("create_admission_prospect" as never, {
        p_facility_id: input.facilityId,
        p_first_name: input.firstName,
        p_last_name: input.lastName,
        p_date_of_birth: input.dateOfBirth || null,
        p_phone: input.phone || null,
        p_email: input.email || null,
        p_referral_source_id: input.referralSourceId || null,
        p_expected_move_in_date: input.expectedMoveInDate || null,
        p_primary_contact_name: input.primaryContactName || null,
        p_primary_contact_relationship: input.primaryContactRelationship || null,
        p_primary_contact_phone: input.primaryContactPhone || null,
        p_primary_contact_email: input.primaryContactEmail || null,
        p_notes: input.notes || null,
      } as never);
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => invalidateAdmissions(queryClient),
  });
}

export function useUpdateAdmissionProspect() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      prospectId: string;
      stage: string;
      clinicalReviewStatus: string;
      financialReviewStatus: string;
      expectedMoveInDate?: string | null;
      decisionReason?: string;
      lostLeadReason?: string;
      notes?: string;
    }) => {
      const { data, error } = await supabase.rpc("update_admission_prospect" as never, {
        p_prospect_id: input.prospectId,
        p_stage: input.stage,
        p_clinical_review_status: input.clinicalReviewStatus,
        p_financial_review_status: input.financialReviewStatus,
        p_expected_move_in_date: input.expectedMoveInDate ?? null,
        p_decision_reason: input.decisionReason ?? null,
        p_lost_lead_reason: input.lostLeadReason ?? null,
        p_notes: input.notes ?? null,
      } as never);
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidateAdmissions(queryClient),
  });
}

export function useRecordAdmissionActivity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      prospectId: string;
      activityType: string;
      scheduledFor?: string;
      outcome?: string;
      notes?: string;
    }) => {
      const { data, error } = await supabase.rpc("record_admission_activity" as never, {
        p_prospect_id: input.prospectId,
        p_activity_type: input.activityType,
        p_scheduled_for: input.scheduledFor || null,
        p_outcome: input.outcome || null,
        p_notes: input.notes || null,
      } as never);
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admissions", "activities"] }),
  });
}

export function useListFacilityBeds(filters: {
  organizationId?: string;
  facilityId?: string;
  status?: string;
} = {}) {
  return useQuery({
    queryKey: ["admissions", "beds", filters],
    queryFn: async () => {
      let query = supabase
        .from("facility_beds")
        .select(`
          *,
          room:facility_rooms(
            id, room_number, room_type, gender_restriction,
            building:facility_buildings(id, name, licensed_capacity),
            unit:residential_units(id, name)
          ),
          prospect:admission_prospects!facility_beds_reserved_for_prospect_id_fkey(id, first_name, last_name),
          resident:residents!facility_beds_occupied_by_resident_id_fkey(id, first_name, last_name, status)
        `)
        .order("created_at");
      if (filters.organizationId) query = query.eq("organization_id", filters.organizationId);
      if (filters.facilityId) query = query.eq("facility_id", filters.facilityId);
      if (filters.status) query = query.eq("status", filters.status);
      const { data, error } = await query;
      if (error) throw error;
      return data as unknown as FacilityBedWithRelations[];
    },
  });
}

export function useCreateRoomWithBeds() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      facilityId: string;
      buildingName: string;
      unitName?: string;
      roomNumber: string;
      roomType: string;
      bedCount: number;
      genderRestriction: string;
      licensedCapacity?: number | null;
    }) => {
      const { data, error } = await supabase.rpc("create_room_with_beds" as never, {
        p_facility_id: input.facilityId,
        p_building_name: input.buildingName,
        p_unit_name: input.unitName ?? "",
        p_room_number: input.roomNumber,
        p_room_type: input.roomType,
        p_bed_count: input.bedCount,
        p_gender_restriction: input.genderRestriction,
        p_licensed_capacity: input.licensedCapacity ?? null,
      } as never);
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admissions", "beds"] }),
  });
}

export function useSetBedAvailability() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      bedId: string;
      status: string;
      holdReason?: string;
      expectedVacancyDate?: string;
    }) => {
      const { data, error } = await supabase.rpc("set_bed_availability" as never, {
        p_bed_id: input.bedId,
        p_status: input.status,
        p_hold_reason: input.holdReason ?? null,
        p_expected_vacancy_date: input.expectedVacancyDate || null,
      } as never);
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admissions", "beds"] }),
  });
}

export function useReserveBedForProspect() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ prospectId, bedId }: { prospectId: string; bedId: string }) => {
      const { data, error } = await supabase.rpc("reserve_bed_for_prospect" as never, {
        p_prospect_id: prospectId,
        p_bed_id: bedId,
      } as never);
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidateAdmissions(queryClient),
  });
}

export function useListMoveInWorkspaces(filters: {
  organizationId?: string;
  facilityId?: string;
  state?: string;
} = {}) {
  return useQuery({
    queryKey: ["admissions", "move-ins", filters],
    queryFn: async () => {
      let query = supabase
        .from("move_in_workspaces")
        .select(`
          *,
          resident:residents(id, first_name, last_name, room, status),
          facility:facilities(id, name),
          template:move_in_templates(id, name, version),
          tasks:move_in_tasks(*)
        `)
        .order("target_move_in_date");
      if (filters.organizationId) query = query.eq("organization_id", filters.organizationId);
      if (filters.facilityId) query = query.eq("facility_id", filters.facilityId);
      if (filters.state) query = query.eq("state", filters.state);
      const { data, error } = await query;
      if (error) throw error;
      return data as unknown as MoveInWorkspaceWithRelations[];
    },
  });
}

export function useGetMoveInWorkspace(id?: string) {
  return useQuery({
    queryKey: ["admissions", "move-in", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("move_in_workspaces")
        .select(`
          *,
          resident:residents(id, first_name, last_name, room, status),
          facility:facilities(id, name),
          template:move_in_templates(id, name, version),
          tasks:move_in_tasks(
            *,
            owner:profiles!move_in_tasks_owner_profile_id_fkey(id, first_name, last_name),
            document:resident_documents(id, file_name, document_label)
          )
        `)
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data as unknown as Omit<MoveInWorkspaceWithRelations, "tasks"> & { tasks: MoveInTaskWithOwner[] };
    },
    enabled: !!id,
  });
}

export function useListMoveInTaskHistory(workspaceId?: string) {
  return useQuery({
    queryKey: ["admissions", "move-in-history", workspaceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("move_in_task_history")
        .select("*, actor:profiles!move_in_task_history_actor_profile_id_fkey(id, first_name, last_name)")
        .eq("workspace_id", workspaceId!)
        .order("occurred_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!workspaceId,
  });
}

export function useListMoveInGuestGrants(workspaceId?: string) {
  return useQuery({
    queryKey: ["admissions", "move-in-guests", workspaceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("move_in_guest_grants")
        .select("*")
        .eq("workspace_id", workspaceId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!workspaceId,
  });
}

export function useStartMoveInWorkspace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (prospectId: string) => {
      const { data, error } = await supabase.rpc("start_move_in_workspace" as never, {
        p_prospect_id: prospectId,
      } as never);
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => invalidateAdmissions(queryClient),
  });
}

export function useAssignMoveInTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { taskId: string; ownerProfileId?: string | null; dueAt?: string | null }) => {
      const { data, error } = await supabase.rpc("assign_move_in_task" as never, {
        p_task_id: input.taskId,
        p_owner_profile_id: input.ownerProfileId ?? null,
        p_due_at: input.dueAt ?? null,
      } as never);
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidateAdmissions(queryClient),
  });
}

export function useUpdateMoveInTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      taskId: string;
      targetState: string;
      documentId?: string | null;
      signatureEvidence?: Json | null;
      reason?: string | null;
    }) => {
      const { data, error } = await supabase.rpc("update_move_in_task" as never, {
        p_task_id: input.taskId,
        p_target_state: input.targetState,
        p_document_id: input.documentId ?? null,
        p_signature_evidence: input.signatureEvidence ?? null,
        p_reason: input.reason ?? null,
      } as never);
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidateAdmissions(queryClient),
  });
}

export function useIssueMoveInGuestGrant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      workspaceId: string;
      guestLabel: string;
      taskIds: string[];
      expiresAt: string;
    }) => {
      const { data, error } = await supabase.rpc("issue_move_in_guest_grant" as never, {
        p_workspace_id: input.workspaceId,
        p_guest_label: input.guestLabel,
        p_task_ids: input.taskIds,
        p_expires_at: input.expiresAt,
        p_terms_version: "v1",
      } as never);
      if (error) throw error;
      return data as unknown as { grantId: string; token: string };
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admissions", "move-in-guests"] }),
  });
}

export function useRevokeMoveInGuestGrant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ grantId, reason }: { grantId: string; reason: string }) => {
      const { data, error } = await supabase.rpc("revoke_move_in_guest_grant" as never, {
        p_grant_id: grantId,
        p_reason: reason,
      } as never);
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admissions", "move-in-guests"] }),
  });
}

export function useCompleteMoveInAdmission() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ workspaceId, reason }: { workspaceId: string; reason: string }) => {
      const { data, error } = await supabase.rpc("complete_move_in_admission" as never, {
        p_workspace_id: workspaceId,
        p_reason: reason,
      } as never);
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => invalidateAdmissions(queryClient),
  });
}

export function useListCensusEvents(filters: { organizationId?: string; facilityId?: string } = {}) {
  return useQuery({
    queryKey: ["admissions", "census-events", filters],
    queryFn: async () => {
      let query = supabase
        .from("resident_census_events")
        .select("*, resident:residents(id, first_name, last_name, room)")
        .order("effective_at", { ascending: false });
      if (filters.organizationId) query = query.eq("organization_id", filters.organizationId);
      if (filters.facilityId) query = query.eq("facility_id", filters.facilityId);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}

export function useTransitionResidentCensus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      residentId: string;
      targetStatus: string;
      bedId?: string | null;
      reason: string;
    }) => {
      const { data, error } = await supabase.rpc("transition_resident_census" as never, {
        p_resident_id: input.residentId,
        p_target_status: input.targetStatus,
        p_bed_id: input.bedId ?? null,
        p_reason: input.reason,
      } as never);
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidateAdmissions(queryClient),
  });
}

export function useMoveInGuestWorkspace(token?: string) {
  return useQuery({
    queryKey: ["move-in-guest", token],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_move_in_guest_workspace" as never, {
        p_token: token,
      } as never);
      if (error) throw error;
      return data as unknown as {
        guestLabel: string;
        residentName: string;
        expiresAt: string;
        termsVersion: string;
        tasks: {
          id: string;
          title: string;
          state: string;
          requiresSignature: boolean;
          requiresDocument: boolean;
          signed: boolean;
        }[];
      };
    },
    enabled: !!token,
    retry: false,
  });
}

export function useAcceptMoveInGuestTerms() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (token: string) => {
      const { data, error } = await supabase.rpc("accept_move_in_guest_terms" as never, {
        p_token: token,
        p_fingerprint: null,
      } as never);
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["move-in-guest"] }),
  });
}

export function useSignMoveInGuestTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      token: string;
      taskId: string;
      signerName: string;
      relationship: string;
      attestation: string;
    }) => {
      const { data, error } = await supabase.rpc("sign_move_in_guest_task" as never, {
        p_token: input.token,
        p_task_id: input.taskId,
        p_signer_name: input.signerName,
        p_relationship: input.relationship,
        p_attestation: input.attestation,
      } as never);
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["move-in-guest"] }),
  });
}
