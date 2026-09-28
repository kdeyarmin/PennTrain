import { useId, useRef, useState, type FormEvent } from "react";
import { Link } from "wouter";
import { ChevronRight, RefreshCw, Send } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { hasDefinitivePostgresWriteRejection } from "@/lib/postgresWriteOutcome";
import { pathAvailableInBuild } from "@/lib/productRoutes";
import { useCreateSupportTicket, useListSupportTickets } from "@/hooks/useSupportTickets";
import { QueryError, QueryLoading } from "@/components/QueryState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const SUBJECT_PREFIX = "Course recommendation: ";
const REQUEST_FILTERS = { category: "training_content", subjectPrefix: SUBJECT_PREFIX };
const EMPTY_FORM = { title: "", audience: "", goals: "", context: "" };
const PAGE_SIZE = 10;
const STATUS_LABELS: Record<string, string> = {
  open: "Submitted", in_progress: "In review", resolved: "Resolved", closed: "Closed",
};

/** Recommendations use the existing private support conversation and its own-role RLS. */
export function CourseRecommendations() {
  const { user } = useAuth();
  const canRecommend = user?.role === "org_admin" || user?.role === "facility_manager";
  const canReview = user?.role === "platform_admin";
  if (!canRecommend && !canReview) return null;
  return <RecommendationWorkspace canRecommend={canRecommend} canReview={canReview} />;
}

function RecommendationWorkspace({ canRecommend, canReview }: { canRecommend: boolean; canReview: boolean }) {
  const { user } = useAuth();
  const id = useId();
  const [form, setForm] = useState(EMPTY_FORM);
  const [submittedId, setSubmittedId] = useState<string | null>(null);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [needsHistoryCheck, setNeedsHistoryCheck] = useState(false);
  const [page, setPage] = useState(1);
  const submitting = useRef(false);
  const requests = useListSupportTickets(REQUEST_FILTERS);
  const create = useCreateSupportTicket();
  const tickets = requests.data ?? [];
  const pageCount = Math.max(1, Math.ceil(tickets.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visibleTickets = tickets.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const valid = form.title.trim().length >= 3 && !!form.audience.trim() && form.goals.trim().length >= 10;
  const threadHref = (ticketId: string) => `${canReview ? "/admin/support-tickets" : "/app/help/tickets"}/${ticketId}?from=courses`;
  const canOpenReview = !canReview || pathAvailableInBuild("/admin/support-tickets");

  const update = (key: keyof typeof EMPTY_FORM, value: string) => setForm(previous => ({ ...previous, [key]: value }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!canRecommend || !user?.organizationId || !valid || create.isPending || submitting.current || needsHistoryCheck) return;
    submitting.current = true;
    setSubmissionError(null);
    setSubmittedId(null);
    create.mutate({
      organizationId: user.organizationId,
      category: "training_content",
      priority: "normal",
      subject: `${SUBJECT_PREFIX}${form.title.trim()}`,
      message: [
        `Requested course: ${form.title.trim()}`,
        `Intended learners: ${form.audience.trim()}`,
        `Reason and learning goals:\n${form.goals.trim()}`,
        ...(form.context.trim() ? [`Additional context or source material:\n${form.context.trim()}`] : []),
      ].join("\n\n"),
    }, {
      onSuccess: ticket => {
        setSubmittedId(ticket.id);
        setForm(EMPTY_FORM);
        setPage(1);
        setNeedsHistoryCheck(false);
      },
      onError: error => {
        const uncertain = !hasDefinitivePostgresWriteRejection(error);
        setNeedsHistoryCheck(uncertain);
        setSubmissionError(uncertain
          ? "We couldn't confirm whether your recommendation was saved. Refresh your recommendations and check for it before submitting again. Your answers are still here."
          : "Your recommendation could not be submitted. Your answers are still here; please try again.");
      },
      onSettled: () => { submitting.current = false; },
    });
  };

  const refresh = async () => {
    const result = await requests.refetch();
    if (!result.isError) setNeedsHistoryCheck(false);
  };

  return <div className={`grid gap-6 ${canRecommend ? "xl:grid-cols-2" : ""}`}>
    {canRecommend && <section className="premium-card p-4 sm:p-6" aria-labelledby={`${id}-form-heading`}>
      <h2 id={`${id}-form-heading`} className="text-lg font-semibold">Recommend a course</h2>
      <p className="mt-2 text-sm text-muted-foreground">Tell the super admin what your learners need. The super admin reviews recommendations and creates courses. You can enroll learners once a course is published in the catalog.</p>
      {submittedId && <div role="status" className="mt-4 rounded-lg border border-success/30 bg-success/5 p-4 text-sm">
        <p className="font-medium">Recommendation submitted for review.</p>
        <Link className="mt-2 inline-block font-medium text-primary underline underline-offset-4" href={threadHref(submittedId)}>View recommendation and replies</Link>
      </div>}
      {!user?.organizationId ? <p role="alert" className="mt-4 text-sm">Your organization could not be determined. Reload the page before recommending a course.</p> :
        <form onSubmit={submit} className="mt-5 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-topic`}>Course topic or title *</Label>
            <Input id={`${id}-topic`} value={form.title} onChange={event => update("title", event.target.value)} required minLength={3} maxLength={180} disabled={create.isPending} placeholder="For example, supporting residents with dementia" aria-describedby={`${id}-topic-help`} />
            <p id={`${id}-topic-help`} className="text-xs text-muted-foreground">At least 3 characters. Check the catalog first to avoid requesting an existing course.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-audience`}>Who needs this course? *</Label>
            <Input id={`${id}-audience`} value={form.audience} onChange={event => update("audience", event.target.value)} required maxLength={300} disabled={create.isPending} placeholder="For example, new direct care staff" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-goals`}>Why is it needed, and what should learners learn? *</Label>
            <Textarea id={`${id}-goals`} value={form.goals} onChange={event => update("goals", event.target.value)} required minLength={10} maxLength={5000} rows={5} disabled={create.isPending} aria-describedby={`${id}-goals-help`} />
            <p id={`${id}-goals-help`} className="text-xs text-muted-foreground">At least 10 characters. Describe the skills or knowledge the course should cover.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-context`}>Additional context or reference links (optional)</Label>
            <Textarea id={`${id}-context`} value={form.context} onChange={event => update("context", event.target.value)} maxLength={5000} rows={3} disabled={create.isPending} />
          </div>
          {submissionError && <div role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm">
            <p>{submissionError}</p>
            {needsHistoryCheck && <Button type="button" variant="outline" className="mt-3" disabled={requests.isFetching} onClick={() => void refresh()}>Refresh recommendations</Button>}
          </div>}
          <Button type="submit" disabled={!valid || create.isPending || needsHistoryCheck} className="w-full sm:w-auto">
            <Send className="mr-2 h-4 w-4" aria-hidden="true" />{create.isPending ? "Submitting…" : "Submit recommendation"}
          </Button>
        </form>}
    </section>}

    <section className="premium-card min-w-0 p-4 sm:p-6" aria-labelledby={`${id}-list-heading`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={`${id}-list-heading`} className="text-lg font-semibold">{canReview ? "Course recommendations" : "My recommendations"}</h2>
        <Button type="button" variant="outline" size="sm" disabled={requests.isFetching} onClick={() => void refresh()} aria-label="Refresh recommendation history"><RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />Refresh</Button>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{canReview ? "Review facility requests and reply in their conversations. Creating and publishing a course is a separate super admin action." : "Track your requests and read the super admin's replies. A resolved request does not necessarily mean a course has been published."}</p>
      {!canOpenReview && <p className="mt-4 text-sm">Open the <a className="text-primary underline" href="https://cmcarebase.com/admin/courses?section=recommendations">owner console</a> to review recommendation conversations.</p>}
      <div className="mt-5">
        {requests.isError ? <QueryError what="course recommendations" error={requests.error} onRetry={() => void refresh()} /> :
          requests.isLoading ? <QueryLoading what="course recommendations" /> :
            tickets.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">{canReview ? "No course recommendations have been submitted yet." : "You haven't recommended a course yet. Use the form to send your first request."}</p> :
              <ul className="space-y-3">
                {visibleTickets.map(ticket => <li key={ticket.id} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    {canOpenReview ? <Link className="min-w-0 flex-1 basis-44 break-words font-medium text-primary underline-offset-4 hover:underline" href={threadHref(ticket.id)}>{ticket.subject.startsWith(SUBJECT_PREFIX) ? ticket.subject.slice(SUBJECT_PREFIX.length) : ticket.subject}<ChevronRight className="ml-1 inline h-4 w-4" aria-hidden="true" /></Link> : <p className="min-w-0 flex-1 basis-44 break-words font-medium">{ticket.subject.slice(SUBJECT_PREFIX.length)}</p>}
                    <Badge variant="secondary">{STATUS_LABELS[ticket.status] ?? ticket.status.replace(/_/g, " ")}</Badge>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">Updated {new Date(ticket.last_message_at).toLocaleDateString()}</p>
                </li>)}
              </ul>}
        {!requests.isError && !requests.isLoading && pageCount > 1 && <nav aria-label="Recommendation pages" className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <Button type="button" size="sm" variant="outline" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Previous</Button>
          <span className="text-sm text-muted-foreground">Page {currentPage} of {pageCount}</span>
          <Button type="button" size="sm" variant="outline" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>Next</Button>
        </nav>}
      </div>
    </section>
  </div>;
}
