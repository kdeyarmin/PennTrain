import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables } from "@/lib/database.types";

export type ComplianceRequirement = Tables<"compliance_requirements">;
export type ComplianceInstance = Tables<"compliance_requirement_instances">;
export type ComplianceEvent = Tables<"compliance_requirement_events">;
export type ComplianceDocument = Tables<"compliance_requirement_documents">;

// supabase-js types rpc() against the generated Functions map; these workflow RPCs are registered in
// the migration and called by name (mirrors the cast used in useIncidents.ts).
const rpc = supabase.rpc as unknown as (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

async function callRpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export interface ListRequirementsOptions {
  /** "live" (facility requirements), "template", or "all". Defaults to live. */
  scope?: "live" | "template" | "all";
  includeArchived?: boolean;
}

export function useComplianceRequirements(options: ListRequirementsOptions = {}) {
  const { scope = "live", includeArchived = false } = options;
  return useQuery({
    queryKey: ["compliance-requirements", { scope, includeArchived }],
    queryFn: async () => {
      let query = supabase
        .from("compliance_requirements")
        .select("*")
        .order("title");
      if (scope === "live") query = query.eq("is_template", false);
      else if (scope === "template") query = query.eq("is_template", true);
      if (!includeArchived) query = query.eq("is_active", true);
      const { data, error } = await query;
      if (error) throw error;
      return data as ComplianceRequirement[];
    },
  });
}

export function useComplianceInstances() {
  return useQuery({
    queryKey: ["compliance-instances"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("compliance_requirement_instances")
        .select("*")
        .order("due_date", { ascending: true })
        .limit(5000);
      if (error) throw error;
      return data as ComplianceInstance[];
    },
  });
}

export interface RequirementDetail {
  requirement: ComplianceRequirement;
  instances: ComplianceInstance[];
  events: ComplianceEvent[];
  documents: ComplianceDocument[];
}

export function useComplianceRequirementDetail(requirementId: string | undefined) {
  return useQuery({
    queryKey: ["compliance-requirement", requirementId],
    enabled: !!requirementId,
    queryFn: async (): Promise<RequirementDetail> => {
      const [requirement, instances, events, documents] = await Promise.all([
        supabase.from("compliance_requirements").select("*").eq("id", requirementId!).single(),
        supabase.from("compliance_requirement_instances").select("*").eq("requirement_id", requirementId!).order("due_date", { ascending: false }),
        supabase.from("compliance_requirement_events").select("*").eq("requirement_id", requirementId!).order("created_at", { ascending: false }).limit(200),
        supabase.from("compliance_requirement_documents").select("*").eq("requirement_id", requirementId!).order("created_at", { ascending: false }),
      ]);
      if (requirement.error) throw requirement.error;
      if (instances.error) throw instances.error;
      if (events.error) throw events.error;
      if (documents.error) throw documents.error;
      return {
        requirement: requirement.data as ComplianceRequirement,
        instances: (instances.data ?? []) as ComplianceInstance[],
        events: (events.data ?? []) as ComplianceEvent[],
        documents: (documents.data ?? []) as ComplianceDocument[],
      };
    },
  });
}

/** Buildings for a facility, for the requirement editor's building selector. */
export function useComplianceFacilityBuildings(facilityId: string | undefined) {
  return useQuery({
    queryKey: ["facility-buildings", facilityId],
    enabled: !!facilityId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("facility_buildings")
        .select("*")
        .eq("facility_id", facilityId!)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data as Tables<"facility_buildings">[];
    },
  });
}

export interface UpsertRequirementInput {
  id?: string | null;
  facilityId?: string | null;
  buildingId?: string | null;
  category: string;
  title: string;
  description?: string | null;
  regulationCitation?: string | null;
  regulationChapter?: string | null;
  responsibleProfileId?: string | null;
  recurrence: string;
  customIntervalDays?: number | null;
  anchorDate?: string | null;
  warningDays?: number;
  requiresEvidence?: boolean;
  requiresReview?: boolean;
  isTemplate?: boolean;
  organizationId?: string | null;
}

function invalidateAll(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ["compliance-requirements"] });
  queryClient.invalidateQueries({ queryKey: ["compliance-instances"] });
  queryClient.invalidateQueries({ queryKey: ["compliance-requirement"] });
}

export function useUpsertComplianceRequirement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpsertRequirementInput) =>
      callRpc<ComplianceRequirement>("upsert_compliance_requirement", {
        p_id: input.id ?? null,
        p_facility_id: input.facilityId ?? null,
        p_building_id: input.buildingId ?? null,
        p_category: input.category,
        p_title: input.title,
        p_description: input.description ?? null,
        p_regulation_citation: input.regulationCitation ?? null,
        p_regulation_chapter: input.regulationChapter ?? null,
        p_responsible_profile_id: input.responsibleProfileId ?? null,
        p_recurrence: input.recurrence,
        p_custom_interval_days: input.customIntervalDays ?? null,
        p_anchor_date: input.anchorDate ?? null,
        p_warning_days: input.warningDays ?? 14,
        p_requires_evidence: input.requiresEvidence ?? true,
        p_requires_review: input.requiresReview ?? false,
        p_is_template: input.isTemplate ?? false,
        p_organization_id: input.organizationId ?? null,
      }),
    onSuccess: () => invalidateAll(queryClient),
  });
}

export function useSetComplianceRequirementActive() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ requirementId, active, note }: { requirementId: string; active: boolean; note?: string }) =>
      callRpc<ComplianceRequirement>("set_compliance_requirement_active", {
        p_requirement_id: requirementId,
        p_active: active,
        p_note: note ?? null,
      }),
    onSuccess: () => invalidateAll(queryClient),
  });
}

export function useGenerateComplianceInstancesNow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (requirementId: string) =>
      callRpc<number>("generate_compliance_instances_now", { p_requirement_id: requirementId }),
    onSuccess: () => invalidateAll(queryClient),
  });
}

export function useCopyComplianceRequirement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ templateId, facilityIds }: { templateId: string; facilityIds: string[] }) =>
      callRpc<number>("copy_compliance_requirement", { p_template_id: templateId, p_facility_ids: facilityIds }),
    onSuccess: () => invalidateAll(queryClient),
  });
}

export type InstanceAction =
  | "start"
  | "submit_review"
  | "complete"
  | "approve_review"
  | "mark_not_applicable"
  | "approve_exception"
  | "reopen";

export function useTransitionComplianceInstance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ instanceId, action, note }: { instanceId: string; action: InstanceAction; note?: string }) =>
      callRpc<ComplianceInstance>("transition_compliance_instance", {
        p_instance_id: instanceId,
        p_action: action,
        p_note: note ?? null,
      }),
    onSuccess: () => invalidateAll(queryClient),
  });
}

export function useAssignComplianceInstance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ instanceId, profileId, note }: { instanceId: string; profileId: string | null; note?: string }) =>
      callRpc<ComplianceInstance>("assign_compliance_instance", {
        p_instance_id: instanceId,
        p_profile_id: profileId,
        p_note: note ?? null,
      }),
    onSuccess: () => invalidateAll(queryClient),
  });
}

export function useAddComplianceNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ requirementId, instanceId, note }: { requirementId: string; instanceId?: string | null; note: string }) =>
      callRpc<ComplianceEvent>("add_compliance_note", {
        p_requirement_id: requirementId,
        p_instance_id: instanceId ?? null,
        p_note: note,
      }),
    onSuccess: () => invalidateAll(queryClient),
  });
}

/** Uploads a file to the private compliance-evidence bucket, then registers it against the occurrence. */
export function useUploadComplianceEvidence() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ instance, file, label }: { instance: ComplianceInstance; file: File; label?: string }) => {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${instance.organization_id}/${instance.facility_id}/${instance.id}/${Date.now()}_${safeName}`;
      const upload = await supabase.storage.from("compliance-evidence").upload(path, file, { upsert: false });
      if (upload.error) throw new Error(upload.error.message);
      return callRpc<ComplianceDocument>("attach_compliance_evidence", {
        p_instance_id: instance.id,
        p_storage_path: path,
        p_file_name: file.name,
        p_file_type: file.type || "application/octet-stream",
        p_file_size: file.size,
        p_document_label: label ?? null,
      });
    },
    onSuccess: () => invalidateAll(queryClient),
  });
}

export function useRemoveComplianceEvidence() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (document: ComplianceDocument) => {
      // Delete the stored file first so a sensitive evidence object never orphans in the private
      // bucket; only if that succeeds do we drop the metadata row + evidence count via the RPC.
      const del = await supabase.storage.from(document.storage_bucket).remove([document.storage_path]);
      if (del.error) throw new Error(del.error.message);
      return callRpc<boolean>("remove_compliance_evidence", { p_document_id: document.id });
    },
    onSuccess: () => invalidateAll(queryClient),
  });
}

/** Short-lived signed URL to view/download a stored evidence file. */
export async function getComplianceEvidenceUrl(document: ComplianceDocument): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(document.storage_bucket)
    .createSignedUrl(document.storage_path, 300);
  if (error) return null;
  return data?.signedUrl ?? null;
}
