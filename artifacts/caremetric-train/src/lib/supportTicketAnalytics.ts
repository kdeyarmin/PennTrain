export interface SupportTicketAnalyticsRecord {
  id: string;
  status: string;
  priority: string;
  created_at: string;
  last_message_at: string;
}

export interface SupportTicketAnalyticsSummary {
  total: number;
  open: number;
  inProgress: number;
  urgentOpen: number;
  staleOpen: number;
  averageAgeDays: number;
  oldestOpenTicketId: string | null;
}

function ageDays(iso: string, today: string): number {
  const start = Date.parse(iso);
  const end = Date.parse(`${today}T23:59:59Z`);
  return Math.max(0, Math.floor((end - start) / 86_400_000));
}

export function summarizeSupportTicketAnalytics(tickets: SupportTicketAnalyticsRecord[], today: string): SupportTicketAnalyticsSummary {
  const activeTickets = tickets.filter((ticket) => ticket.status === "open" || ticket.status === "in_progress");
  const openTickets = tickets.filter((ticket) => ticket.status === "open");
  const ages = activeTickets.map((ticket) => ageDays(ticket.created_at, today));
  const oldestOpenTicketId = [...activeTickets]
    .sort((a, b) => a.created_at.localeCompare(b.created_at))[0]?.id ?? null;

  return {
    total: tickets.length,
    open: openTickets.length,
    inProgress: tickets.filter((ticket) => ticket.status === "in_progress").length,
    urgentOpen: activeTickets.filter((ticket) => ticket.priority === "urgent").length,
    staleOpen: activeTickets.filter((ticket) => ageDays(ticket.last_message_at, today) >= 3).length,
    averageAgeDays: ages.length ? Math.round(ages.reduce((sum, age) => sum + age, 0) / ages.length) : 0,
    oldestOpenTicketId,
  };
}
