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
          // Unique tie-break so paging is deterministic: tickets that have had no reply since
          // creation share their creation instant, and Postgres is free to order each page's
          // request differently inside a run of equal keys -- which would repeat tickets on one
          // page and drop them from another, exactly the under-count this loop exists to prevent.
          .order("id", { ascending: false })
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
  /** Only for the attachment path: the bucket policy reads the org from the first folder segment. */
  organizationId: string;
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

// The ticket and its first message go in together, through one SECURITY DEFINER RPC.
//
// They used to be two inserts wrapped in a try/catch whose catch deleted the ticket -- and
// `support_tickets` has no DELETE policy and no DELETE grant, so that compensating delete never
// removed anything. A failed first message left a subject-only ticket in the platform support
// queue, the UI said the submission failed, and the retry made a second one. See BACKLOG.md I19
// and 20260905190000.
//
// The attachment is still a second step and has to be: the storage write policy for
// support-ticket-attachments reverse-joins to support_tickets on the ticket id in the path, so the
// ticket must exist before the file can be uploaded. What changed is the cost of a failure there.
// The ticket and its message are already saved by then, so a failed upload loses the file and
// nothing else -- reported to the person filing, with the ticket they can reply to still intact.
export function useCreateSupportTicket() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ organizationId, subject, category, priority, message, file }: CreateSupportTicketInput) => {
      const { data: ticket, error: ticketError } = await supabase.rpc("create_support_ticket_with_message", {
        p_subject: subject,
        p_category: category,
        p_priority: priority,
        p_body: message,
      });
      if (ticketError) throw ticketError;
      if (!ticket) throw new Error("Support ticket was not created");

      if (file) {
        const attachment = await uploadTicketAttachment(organizationId, ticket.id, file);
        const { error: attachError } = await supabase.rpc("attach_file_to_support_ticket_message", {
          p_ticket_id: ticket.id,
          p_bucket: attachment.attachment_bucket,
          p_path: attachment.attachment_path,
          p_name: attachment.attachment_name,
          p_type: attachment.attachment_type,
          p_size: attachment.attachment_size,
        });
        if (attachError) {
          // The object is orphaned unless it is removed here: nothing references it, and the
          // bucket has no sweeper. A failure to remove it is reported alongside, not swallowed.
          const { error: cleanupError } = await supabase.storage.from(ATTACHMENT_BUCKET).remove([attachment.attachment_path]);
          throw new Error(
            cleanupError
              ? `Ticket created, but the file could not be attached: ${attachError.message} (and the uploaded file could not be removed: ${cleanupError.message})`
              : `Ticket created, but the file could not be attached: ${attachError.message}`,
          );
        }
      }

      return ticket;
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
