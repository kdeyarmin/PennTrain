import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Json, Tables } from "@/lib/database.types";
import type { ResidentDocument } from "./useResidentDocuments";

export type ResidentContact = Tables<"resident_contacts">;
export type ResidentPropertyItem = Tables<"resident_property_items">;
export type ResidentLegalRecord = Tables<"resident_legal_records">;
export type ResidentAdministrativeHistory = Tables<"resident_administrative_history">;
export type ResidentCensusEvent = Tables<"resident_census_events">;

export interface ResidentAdministrativeMasterData {
  contacts: ResidentContact[];
  propertyItems: ResidentPropertyItem[];
  legalRecords: ResidentLegalRecord[];
  history: ResidentAdministrativeHistory[];
  censusEvents: ResidentCensusEvent[];
}

const invalidateMaster = (queryClient: ReturnType<typeof useQueryClient>, residentId: string) => {
  queryClient.invalidateQueries({ queryKey: ["resident-administrative-master", residentId] });
  queryClient.invalidateQueries({ queryKey: ["residents", residentId] });
  queryClient.invalidateQueries({ queryKey: ["residents"] });
};

export function useResidentAdministrativeMaster(residentId: string | undefined) {
  return useQuery({
    queryKey: ["resident-administrative-master", residentId],
    queryFn: async (): Promise<ResidentAdministrativeMasterData> => {
      const [contacts, propertyItems, legalRecords, history, censusEvents] = await Promise.all([
        supabase.from("resident_contacts").select("*").eq("resident_id", residentId!).eq("active", true).order("sort_order"),
        supabase.from("resident_property_items").select("*").eq("resident_id", residentId!).order("created_at", { ascending: false }),
        supabase.from("resident_legal_records").select("*").eq("resident_id", residentId!).order("created_at", { ascending: false }),
        supabase.from("resident_administrative_history").select("*").eq("resident_id", residentId!).order("occurred_at", { ascending: false }).limit(25),
        supabase.from("resident_census_events").select("*").eq("resident_id", residentId!).order("effective_at", { ascending: false }),
      ]);
      const error = contacts.error ?? propertyItems.error ?? legalRecords.error ?? history.error ?? censusEvents.error;
      if (error) throw error;
      return {
        contacts: contacts.data ?? [],
        propertyItems: propertyItems.data ?? [],
        legalRecords: legalRecords.data ?? [],
        history: history.data ?? [],
        censusEvents: censusEvents.data ?? [],
      };
    },
    enabled: !!residentId,
  });
}

export function useSaveResidentAdministrativeMaster() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { residentId: string; profile: Json; contacts: Json }) => {
      const { data, error } = await supabase.rpc("save_resident_administrative_master", {
        p_resident_id: input.residentId,
        p_profile: input.profile,
        p_contacts: input.contacts,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, input) => invalidateMaster(queryClient, input.residentId),
  });
}

export function useUpsertResidentPropertyItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      residentId: string;
      itemId?: string;
      itemName: string;
      quantity: number;
      description?: string;
      conditionAtReceipt?: string;
      receivedOn?: string;
      releasedOn?: string;
      disposition?: string;
      residentAcknowledgedAt?: string;
      documentId?: string;
      notes?: string;
      active?: boolean;
    }) => {
      const { data, error } = await supabase.rpc("upsert_resident_property_item", {
        p_resident_id: input.residentId,
        p_item_id: input.itemId,
        p_item_name: input.itemName,
        p_quantity: input.quantity,
        p_description: input.description,
        p_condition_at_receipt: input.conditionAtReceipt,
        p_received_on: input.receivedOn,
        p_released_on: input.releasedOn,
        p_disposition: input.disposition,
        p_resident_acknowledged_at: input.residentAcknowledgedAt,
        p_document_id: input.documentId,
        p_notes: input.notes,
        p_active: input.active ?? true,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, input) => invalidateMaster(queryClient, input.residentId),
  });
}

export function useUpsertResidentLegalRecord() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      residentId: string;
      recordId?: string;
      recordType: string;
      title: string;
      status: string;
      authorityName?: string;
      summary?: string;
      effectiveDate?: string;
      expirationDate?: string;
      acknowledgedAt?: string;
      documentId?: string;
    }) => {
      const { data, error } = await supabase.rpc("upsert_resident_legal_record", {
        p_resident_id: input.residentId,
        p_record_id: input.recordId,
        p_record_type: input.recordType,
        p_title: input.title,
        p_status: input.status,
        p_authority_name: input.authorityName,
        p_summary: input.summary,
        p_effective_date: input.effectiveDate,
        p_expiration_date: input.expirationDate,
        p_acknowledged_at: input.acknowledgedAt,
        p_document_id: input.documentId,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, input) => invalidateMaster(queryClient, input.residentId),
  });
}

export function useResidentPhotoUrl(document: ResidentDocument | undefined) {
  return useQuery({
    queryKey: ["resident-photo", document?.id],
    queryFn: async () => {
      const { error: logError } = await supabase.rpc("log_document_access", {
        p_document_table: "resident_documents",
        p_document_id: document!.id,
      });
      if (logError) throw logError;
      const { data, error } = await supabase.storage
        .from(document!.storage_bucket)
        .createSignedUrl(document!.storage_path, 300);
      if (error) throw error;
      return data.signedUrl;
    },
    enabled: !!document,
    staleTime: 240_000,
  });
}
