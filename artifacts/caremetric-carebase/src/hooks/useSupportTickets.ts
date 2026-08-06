import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables, TablesUpdate } from "@/lib/database.types";
import { containsFilterValue } from "@/lib/utils";

export type SupportTicket = Tables<"support_tickets">;
export type SupportTicketUpdate = TablesUpdate<"support_tickets">;
export type SupportTicketMessage = Tables<"support_ticket_messages">;

export const SUPPORT_TICKET_CATEGORIES = [
  { value: "general", label: "General question" },
  { value: "technical_issue", label: "Technical issue" },
  { value: "billing", label: "Billing" },
  { value: "training_content", label: "Training content" },
  { value: "account_access", label: "Account access" },
  { value: "feature_request", label: "Feature request" },
] as const;

export const SUPPORT_TICKET_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export const SUPPORT_TICKET_STATUSES = ["open", "in_progress", "resolved", "closed"] as const;

export interface ListSupportTicketsFilters {
  status?: string;
  organizationId?: string;
  search?: string;
}

// RLS (support_tickets_select) already scopes this to "my own tickets" for every
// non-platform_admin caller and to every organization's tickets for platform_admin -- callers
// never need to filter by created_by themselves, only by the admin queue's own UI filters.
//
// Unlike notification_deliveries' list (capped at 200 rows, safe to search client-side), this
// query has no .limit()/.range() at all -- for platform_admin it's every ticket ever filed across
// every organization, unbounded and only growing -- so `search` is applied server-side instead of
// fetching the whole table into the browser to filter locally. Matches subject and category, the
// free-text/near-free-text columns that live directly on the ticket row itself.
export function useListSupportTickets(filters: ListSupportTicketsFilters = {}) {
  return useQuery({
    queryKey: ["support_tickets", filters],
    queryFn: async () => {
      // PostgREST caps a single response. Page until exhausted so open-count / analytics / queue
      // views do not silently drop older tickets once the table grows past max-rows.
      const pageSize = 1000;
      const rows: Tables<"support_tickets">[] = [];
      for (let from = 0; ; from += pageSize) {
        let query = supabase
          .from("support_tickets")
          .select("*")
          .order("last_message_at", { ascending: false })
          .range(from, from + pageSize - 1);
        if (filters.status) query = query.eq("status", filters.status);
        if (filters.organizationId) query = query.eq("organization_id", filters.organizationId);
        const search = filters.search?.trim();
        if (search) {
          const like = containsFilterValue(search);
          query = query.or(`subject.ilike.${like},category.ilike.${like}`);
        }
        const { data, error } = await query;
        if (error) throw error;
        rows.push(...(data ?? []));
        if (!data || data.length < pageSize) break;
      }
      return rows;
    },
  });
}

export function useGetSupportTicket(id: string | undefined) {
  return useQuery({
    queryKey: ["support_tickets", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("support_tickets").select("*").eq("id", id!).single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });
}

export interface CreateSupportTicketInput {
  organizationId: string;
  createdBy: string;
  subject: string;
  category: string;
  priority: string;
  message: string;
  file?: File;
}

const ATTACHMENT_BUCKET = "support-ticket-attachments";

// Path convention (org/ticket/uuid-filename) matches the storage RLS write policy's foldername
// parse -- see 20260706170704_support_ticket_attachments.sql. Uploaded before the message row
// exists (the write policy reverse-joins to support_tickets, which already exists by then).
async function uploadTicketAttachment(organizationId: string, ticketId: string, file: File) {
  const path = `${organizationId}/${ticketId}/${crypto.randomUUID()}-${file.name}`;
  const { error } = await supabase.storage.from(ATTACHMENT_BUCKET).upload(path, file);
  if (error) throw error;
  return {
    attachment_bucket: ATTACHMENT_BUCKET,
    attachment_path: path,
    attachment_name: file.name,
    attachment_type: file.type,
    attachment_size: file.size,
  };
}

// Ticket + first message are still two inserts (each with its own RLS). If the message path fails
// after the ticket exists, delete the ticket so the UI's failure does not leave an empty shell
// that a retry then duplicates.
export function useCreateSupportTicket() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ organizationId, createdBy, subject, category, priority, message, file }: CreateSupportTicketInput) => {
      const { data: ticket, error: ticketError } = await supabase
        .from("support_tickets")
        .insert({ organization_id: organizationId, created_by: createdBy, subject, category, priority })
        .select()
        .single();
      if (ticketError) throw ticketError;

      try {
        const attachment = file ? await uploadTicketAttachment(organizationId, ticket.id, file) : {};

        const { error: messageError } = await supabase
          .from("support_ticket_messages")
          .insert({ ticket_id: ticket.id, organization_id: ticket.organization_id, sender_id: createdBy, body: message, ...attachment });
        if (messageError) {
          if ("attachment_path" in attachment && typeof attachment.attachment_path === "string") {
            const { error: cleanupError } = await supabase.storage.from(ATTACHMENT_BUCKET).remove([attachment.attachment_path]);
            if (cleanupError) {
              throw new Error(`${messageError.message} (also failed to remove uploaded file: ${cleanupError.message})`);
            }
          }
          throw messageError;
        }

        return ticket;
      } catch (error) {
        await supabase.from("support_tickets").delete().eq("id", ticket.id);
        throw error;
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["support_tickets"] }),
  });
}

export function useListSupportTicketMessages(ticketId: string | undefined) {
  return useQuery({
    queryKey: ["support_tickets", "messages", ticketId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("support_ticket_messages")
        .select("*")
        .eq("ticket_id", ticketId!)
        .order("created_at");
      if (error) throw error;
      return data;
    },
    enabled: !!ticketId,
    refetchInterval: 20_000,
  });
}

export interface SendSupportTicketMessageInput {
  ticketId: string;
  organizationId: string;
  senderId: string;
  body: string;
  file?: File;
}

// organization_id is required in the generated Insert type (the column is NOT NULL with no DB
// default) even though stamp_support_ticket_message() always overwrites it server-side from the
// parent ticket -- same "pass it anyway, the trigger is authoritative" convention as
// useCreateTrainingRecord/TrainingRecordInsert elsewhere in this codebase.
export function useSendSupportTicketMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ ticketId, organizationId, senderId, body, file }: SendSupportTicketMessageInput) => {
      const attachment = file ? await uploadTicketAttachment(organizationId, ticketId, file) : {};
      const { data, error } = await supabase
        .from("support_ticket_messages")
        .insert({ ticket_id: ticketId, organization_id: organizationId, sender_id: senderId, body, ...attachment })
        .select()
        .single();
      if (error) {
        if ("attachment_path" in attachment && typeof attachment.attachment_path === "string") {
          const { error: cleanupError } = await supabase.storage
            .from(ATTACHMENT_BUCKET)
            .remove([attachment.attachment_path]);
          if (cleanupError) {
            throw new Error(`${error.message} (also failed to remove uploaded file: ${cleanupError.message})`);
          }
        }
        throw error;
      }
      return data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["support_tickets", "messages", variables.ticketId] });
      queryClient.invalidateQueries({ queryKey: ["support_tickets"] });
    },
  });
}

// 60-second signed URL, matching useIncidentDocumentSignedUrl/useCredentialDocumentSignedUrl's
// convention exactly. No read-access-logging RPC here (unlike credential-/incident-documents) --
// a ticket attachment isn't the HIPAA/credentialing-grade sensitive document those logs exist for.
export function useTicketAttachmentSignedUrl() {
  return useMutation({
    mutationFn: async (message: SupportTicketMessage) => {
      if (!message.attachment_bucket || !message.attachment_path) {
        throw new Error("This message has no attachment.");
      }
      const { data, error } = await supabase.storage
        .from(message.attachment_bucket)
        .createSignedUrl(message.attachment_path, 60);
      if (error) throw error;
      return data.signedUrl;
    },
  });
}

// Admin-only direct update (status/priority/assigned_to) -- gated by support_tickets_update RLS
// (is_platform_admin() only). Ticket owners self-serve close/reopen via the RPCs below instead.
export function useUpdateSupportTicket() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: SupportTicketUpdate & { id: string }) => {
      const { data, error } = await supabase.from("support_tickets").update(payload).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["support_tickets"] });
      queryClient.invalidateQueries({ queryKey: ["support_tickets", data.id] });
    },
  });
}

export function useCloseSupportTicket() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ticketId: string) => {
      const { error } = await supabase.rpc("close_own_support_ticket", { p_ticket_id: ticketId });
      if (error) throw error;
    },
    onSuccess: (_data, ticketId) => {
      queryClient.invalidateQueries({ queryKey: ["support_tickets"] });
      queryClient.invalidateQueries({ queryKey: ["support_tickets", ticketId] });
    },
  });
}

export function useReopenSupportTicket() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ticketId: string) => {
      const { error } = await supabase.rpc("reopen_own_support_ticket", { p_ticket_id: ticketId });
      if (error) throw error;
    },
    onSuccess: (_data, ticketId) => {
      queryClient.invalidateQueries({ queryKey: ["support_tickets"] });
      queryClient.invalidateQueries({ queryKey: ["support_tickets", ticketId] });
    },
  });
}
