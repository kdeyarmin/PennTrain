import { useState } from "react";
import { useParams, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Send } from "lucide-react";
import {
  useGetSupportTicket, useListSupportTicketMessages, useSendSupportTicketMessage, useUpdateSupportTicket,
  SUPPORT_TICKET_CATEGORIES, SUPPORT_TICKET_PRIORITIES, SUPPORT_TICKET_STATUSES,
} from "@/hooks/useSupportTickets";
import { useOrganizationNameMap } from "@/hooks/useAdminNotificationDeliveries";
import { useProfileNameMap } from "@/hooks/useSecurityAuditLog";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export default function SupportTicketDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { toast } = useToast();
  const [reply, setReply] = useState("");

  const { data: ticket, isLoading } = useGetSupportTicket(id);
  const { data: messages, isLoading: messagesLoading } = useListSupportTicketMessages(id);
  const { data: orgNameMap } = useOrganizationNameMap();
  const { data: profileNameMap } = useProfileNameMap();
  const { mutate: sendMessage, isPending: sending } = useSendSupportTicketMessage();
  const { mutate: updateTicket } = useUpdateSupportTicket();

  const handleSend = () => {
    if (!id || !user || !ticket || !reply.trim()) return;
    sendMessage(
      { ticketId: id, organizationId: ticket.organization_id, senderId: user.id, body: reply.trim() },
      {
        onSuccess: () => setReply(""),
        onError: (e: Error) => toast({ title: "Failed to send reply", description: e.message, variant: "destructive" }),
      }
    );
  };

  const handleStatusChange = (status: string) => {
    if (!id) return;
    updateTicket({ id, status }, {
      onError: (e: Error) => toast({ title: "Failed to update status", description: e.message, variant: "destructive" }),
    });
  };

  const handlePriorityChange = (priority: string) => {
    if (!id) return;
    updateTicket({ id, priority }, {
      onError: (e: Error) => toast({ title: "Failed to update priority", description: e.message, variant: "destructive" }),
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-4 max-w-3xl">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="text-center py-16">
        <p className="text-muted-foreground">Ticket not found.</p>
        <Link href="/admin/support-tickets"><Button variant="outline" className="mt-4">Back to Support Tickets</Button></Link>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <Link href="/admin/support-tickets" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-3">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Support Tickets
        </Link>
        <h1 className="text-xl font-bold">{ticket.subject}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {orgNameMap?.[ticket.organization_id] ?? ticket.organization_id}
          {" · "}{profileNameMap?.[ticket.created_by] ?? "Unknown requester"}
          {" · "}{SUPPORT_TICKET_CATEGORIES.find((c) => c.value === ticket.category)?.label ?? ticket.category}
        </p>
      </div>

      <Card>
        <CardContent className="pt-6 grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Status</label>
            <Select value={ticket.status} onValueChange={handleStatusChange}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {SUPPORT_TICKET_STATUSES.map((s) => (
                  <SelectItem key={s} value={s} className="capitalize">{s.replace("_", " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Priority</label>
            <Select value={ticket.priority} onValueChange={handlePriorityChange}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {SUPPORT_TICKET_PRIORITIES.map((p) => (
                  <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Conversation</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {messagesLoading ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : (
            <div className="space-y-3">
              {messages?.map((m) => (
                <div
                  key={m.id}
                  className={cn("rounded-lg p-3 max-w-[85%]", m.is_admin_reply ? "bg-primary/10 ml-auto" : "bg-muted mr-auto")}
                >
                  <p className="text-xs font-semibold mb-1">
                    {m.is_admin_reply ? "You (Support)" : profileNameMap?.[m.sender_id] ?? "Requester"}
                  </p>
                  <p className="text-sm whitespace-pre-wrap">{m.body}</p>
                  <p className="text-[11px] text-muted-foreground mt-1.5">{new Date(m.created_at).toLocaleString()}</p>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-2 pt-2 border-t">
            <Textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={3} placeholder="Reply to the requester..." />
            <div className="flex justify-end">
              <Button size="sm" onClick={handleSend} disabled={sending || !reply.trim()}>
                <Send className="h-3.5 w-3.5 mr-1.5" /> Send Reply
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
