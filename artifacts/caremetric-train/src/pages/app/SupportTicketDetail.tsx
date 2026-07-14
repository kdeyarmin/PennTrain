import { useRef, useState } from "react";
import { useParams, useLocation, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Send, RotateCcw, CheckCircle2, Paperclip, X } from "lucide-react";
import {
  useGetSupportTicket, useListSupportTicketMessages, useSendSupportTicketMessage,
  useCloseSupportTicket, useReopenSupportTicket, useTicketAttachmentSignedUrl,
  SUPPORT_TICKET_CATEGORIES, type SupportTicketMessage,
} from "@/hooks/useSupportTickets";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

function MessageAttachment({ message }: { message: SupportTicketMessage }) {
  const { toast } = useToast();
  const { mutate: getSignedUrl, isPending } = useTicketAttachmentSignedUrl();

  if (!message.attachment_bucket || !message.attachment_path) return null;

  const handleOpen = () => {
    getSignedUrl(message, {
      onSuccess: (url) => window.open(url, "_blank", "noopener,noreferrer"),
      onError: (e: Error) => toast({ title: "Failed to open attachment", description: e.message, variant: "destructive" }),
    });
  };

  return (
    <button
      type="button"
      onClick={handleOpen}
      disabled={isPending}
      className="mt-1.5 inline-flex items-center gap-1.5 text-xs underline underline-offset-2 text-inherit"
    >
      <Paperclip className="h-3 w-3" /> {message.attachment_name}
    </button>
  );
}

const STATUS_DISPLAY: Record<string, { color: string; label: string }> = {
  open: { color: "bg-blue-100 text-blue-800", label: "Open" },
  in_progress: { color: "bg-amber-100 text-amber-800", label: "In Progress" },
  resolved: { color: "bg-green-100 text-green-800", label: "Resolved" },
  closed: { color: "bg-gray-100 text-gray-600", label: "Closed" },
};

const PRIORITY_TEXT: Record<string, string> = {
  low: "text-muted-foreground",
  normal: "text-foreground",
  high: "text-orange-600",
  urgent: "text-red-600",
};

export default function SupportTicketDetail() {
  const { id } = useParams<{ id: string }>();
  const [location] = useLocation();
  const base = location.startsWith("/me") ? "/me" : "/app";
  const { user } = useAuth();
  const { toast } = useToast();
  const [reply, setReply] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: ticket, isLoading } = useGetSupportTicket(id);
  const { data: messages, isLoading: messagesLoading } = useListSupportTicketMessages(id);
  const { mutate: sendMessage, isPending: sending } = useSendSupportTicketMessage();
  const { mutate: closeTicket, isPending: closing } = useCloseSupportTicket();
  const { mutate: reopenTicket, isPending: reopening } = useReopenSupportTicket();

  const handleSend = () => {
    if (!id || !user || !ticket || !reply.trim()) return;
    sendMessage(
      { ticketId: id, organizationId: ticket.organization_id, senderId: user.id, body: reply.trim(), file: file ?? undefined },
      {
        onSuccess: () => {
          setReply("");
          setFile(null);
        },
        onError: (e: Error) => toast({ title: "Failed to send reply", description: e.message, variant: "destructive" }),
      }
    );
  };

  const handleClose = () => {
    if (!id) return;
    closeTicket(id, {
      onError: (e: Error) => toast({ title: "Failed to close ticket", description: e.message, variant: "destructive" }),
    });
  };

  const handleReopen = () => {
    if (!id) return;
    reopenTicket(id, {
      onError: (e: Error) => toast({ title: "Failed to reopen ticket", description: e.message, variant: "destructive" }),
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
        <Link href={`${base}/help`}><Button variant="outline" className="mt-4">Back to Help Center</Button></Link>
      </div>
    );
  }

  const statusInfo = STATUS_DISPLAY[ticket.status] ?? { color: "bg-gray-100 text-gray-800", label: ticket.status };
  const isClosed = ticket.status === "closed";

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <Link href={`${base}/help`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-3">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Help Center
        </Link>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-bold">{ticket.subject}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {SUPPORT_TICKET_CATEGORIES.find((c) => c.value === ticket.category)?.label ?? ticket.category}
              {" · "}
              <span className={cn("capitalize font-medium", PRIORITY_TEXT[ticket.priority])}>{ticket.priority} priority</span>
            </p>
          </div>
          <span className={cn("inline-flex items-center px-2.5 py-1 rounded text-xs font-medium", statusInfo.color)}>
            {statusInfo.label}
          </span>
        </div>
      </div>

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
                  className={cn("rounded-lg p-3 max-w-[85%]", m.is_admin_reply ? "bg-muted mr-auto" : "bg-primary/10 ml-auto")}
                >
                  <p className="text-xs font-semibold mb-1">{m.is_admin_reply ? "CareMetric Train Support" : "You"}</p>
                  <p className="text-sm whitespace-pre-wrap">{m.body}</p>
                  <MessageAttachment message={m} />
                  <p className="text-[11px] text-muted-foreground mt-1.5">{new Date(m.created_at).toLocaleString()}</p>
                </div>
              ))}
            </div>
          )}

          {isClosed ? (
            <div className="flex items-center justify-between gap-3 rounded-lg border p-3 bg-muted/30 flex-wrap">
              <p className="text-sm text-muted-foreground">This ticket is closed. Still need help?</p>
              <Button variant="outline" size="sm" onClick={handleReopen} disabled={reopening}>
                <RotateCcw className="h-3.5 w-3.5 mr-1.5" /> Reopen Ticket
              </Button>
            </div>
          ) : (
            <div className="space-y-2 pt-2 border-t">
              <Textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={3} placeholder="Add a reply..." />
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                  <Paperclip className="h-3.5 w-3.5 mr-1.5" /> {file ? "Replace File" : "Attach File"}
                </Button>
                {file && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground bg-muted rounded px-2 py-1">
                    {file.name}
                    <button type="button" onClick={() => setFile(null)} aria-label="Remove attachment">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </div>
              <div className="flex justify-between items-center">
                <Button variant="ghost" size="sm" onClick={handleClose} disabled={closing}>
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> Close Ticket
                </Button>
                <Button size="sm" onClick={handleSend} disabled={sending || !reply.trim()}>
                  <Send className="h-3.5 w-3.5 mr-1.5" /> Send Reply
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
