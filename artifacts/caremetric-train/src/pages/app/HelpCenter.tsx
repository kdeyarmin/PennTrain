import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import {
  FAQ_CATEGORIES, FAQ_ENTRIES, searchFaqEntries,
  JOB_AIDE_CATEGORIES, JOB_AIDES, searchJobAides, type JobAide,
} from "@/lib/helpCenterContent";
import {
  useListSupportTickets, useCreateSupportTicket,
  SUPPORT_TICKET_CATEGORIES, SUPPORT_TICKET_PRIORITIES,
} from "@/hooks/useSupportTickets";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Search, FileDown, Plus, ChevronRight, Lightbulb, ExternalLink } from "lucide-react";

const STATUS_DISPLAY: Record<string, { color: string; label: string }> = {
  open: { color: "bg-blue-100 text-blue-800", label: "Open" },
  in_progress: { color: "bg-amber-100 text-amber-800", label: "In Progress" },
  resolved: { color: "bg-green-100 text-green-800", label: "Resolved" },
  closed: { color: "bg-gray-100 text-gray-600", label: "Closed" },
};

function FaqTab() {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => searchFaqEntries(query), [query]);
  const isSearching = query.trim().length > 0;

  return (
    <div className="space-y-4">
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search FAQs..." className="pl-9" />
      </div>

      {isSearching ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{filtered.length} result{filtered.length === 1 ? "" : "s"}</CardTitle>
          </CardHeader>
          <CardContent>
            {filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No FAQs match your search.</p>
            ) : (
              <Accordion type="multiple" className="space-y-2">
                {filtered.map((f) => (
                  <AccordionItem key={f.id} value={f.id} className="border rounded-lg px-4">
                    <AccordionTrigger className="text-left text-sm font-medium hover:no-underline">{f.question}</AccordionTrigger>
                    <AccordionContent className="text-sm text-muted-foreground">{f.answer}</AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            )}
          </CardContent>
        </Card>
      ) : (
        <Accordion type="multiple" defaultValue={[FAQ_CATEGORIES[0]]} className="space-y-3">
          {FAQ_CATEGORIES.map((category) => {
            const entries = FAQ_ENTRIES.filter((f) => f.category === category);
            if (!entries.length) return null;
            return (
              <AccordionItem key={category} value={category} className="border rounded-lg px-4">
                <AccordionTrigger className="hover:no-underline">
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    {category}
                    <Badge variant="outline" className="text-xs font-normal">{entries.length}</Badge>
                  </span>
                </AccordionTrigger>
                <AccordionContent>
                  <Accordion type="multiple" className="space-y-2">
                    {entries.map((f) => (
                      <AccordionItem key={f.id} value={f.id} className="border rounded-lg px-3">
                        <AccordionTrigger className="text-left text-sm font-medium hover:no-underline">{f.question}</AccordionTrigger>
                        <AccordionContent className="text-sm text-muted-foreground">{f.answer}</AccordionContent>
                      </AccordionItem>
                    ))}
                  </Accordion>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      )}
    </div>
  );
}

function JobAideItem({ aide }: { aide: JobAide }) {
  return (
    <AccordionItem value={aide.code} className="border rounded-lg px-4">
      <AccordionTrigger className="hover:no-underline text-left">
        <div>
          <p className="text-sm font-semibold">{aide.title}</p>
          <p className="text-xs text-muted-foreground font-normal mt-0.5">{aide.summary}</p>
        </div>
      </AccordionTrigger>
      <AccordionContent>
        <ol className="list-decimal list-inside space-y-1.5 text-sm text-muted-foreground">
          {aide.steps.map((step, i) => <li key={i}>{step}</li>)}
        </ol>
        {!!aide.tips?.length && (
          <div className="mt-3 rounded-md bg-amber-50 border border-amber-200 p-3 space-y-1.5">
            {aide.tips.map((tip, i) => (
              <p key={i} className="flex items-start gap-1.5 text-xs text-amber-900">
                <Lightbulb className="h-3.5 w-3.5 shrink-0 mt-0.5" /> {tip}
              </p>
            ))}
          </div>
        )}
        {aide.relatedRoute && (
          <Link href={aide.relatedRoute.href}>
            <Button variant="outline" size="sm" className="mt-3 gap-1.5">
              {aide.relatedRoute.label} <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          </Link>
        )}
      </AccordionContent>
    </AccordionItem>
  );
}

function JobAidesTab() {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => searchJobAides(query), [query]);
  const isSearching = query.trim().length > 0;

  return (
    <div className="space-y-4">
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search job aides..." className="pl-9" />
      </div>

      {isSearching ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{filtered.length} result{filtered.length === 1 ? "" : "s"}</CardTitle>
          </CardHeader>
          <CardContent>
            {filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No job aides match your search.</p>
            ) : (
              <Accordion type="multiple" className="space-y-2">
                {filtered.map((aide) => <JobAideItem key={aide.code} aide={aide} />)}
              </Accordion>
            )}
          </CardContent>
        </Card>
      ) : (
        <Accordion type="multiple" defaultValue={[JOB_AIDE_CATEGORIES[0]]} className="space-y-3">
          {JOB_AIDE_CATEGORIES.map((category) => {
            const aides = JOB_AIDES.filter((a) => a.category === category);
            if (!aides.length) return null;
            return (
              <AccordionItem key={category} value={category} className="border rounded-lg px-4">
                <AccordionTrigger className="hover:no-underline">
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    {category}
                    <Badge variant="outline" className="text-xs font-normal">{aides.length}</Badge>
                  </span>
                </AccordionTrigger>
                <AccordionContent>
                  <Accordion type="multiple" className="space-y-2">
                    {aides.map((aide) => <JobAideItem key={aide.code} aide={aide} />)}
                  </Accordion>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      )}
    </div>
  );
}

function ManualTab() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileDown className="h-5 w-5" /> User Manual
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground max-w-2xl">
          A complete PDF walkthrough of every module in CareMetric Train -- roles and permissions, facilities and
          employees, scheduling, courses and certificates, compliance tracking, reports, and more. Download it to
          keep on hand or share with a new team member during onboarding.
        </p>
        <Button asChild>
          <a href="/CareMetric-Train-User-Manual.pdf" target="_blank" rel="noopener noreferrer" download>
            <FileDown className="mr-2 h-4 w-4" /> Download User Manual (PDF)
          </a>
        </Button>
      </CardContent>
    </Card>
  );
}

function SupportTab({ base }: { base: string }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [showForm, setShowForm] = useState(false);
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState<string>("general");
  const [priority, setPriority] = useState<string>("normal");
  const [message, setMessage] = useState("");

  const { data: ticketsData, isLoading } = useListSupportTickets();
  const { mutate: createTicket, isPending: creating } = useCreateSupportTicket();

  const tickets = ticketsData ?? [];

  const handleSubmit = () => {
    if (!subject.trim() || !message.trim()) return;
    // organizationId can transiently be null (e.g. mid-provisioning) even for a non-admin profile
    // that has otherwise reached this page -- surface that clearly instead of a silent no-op, since
    // the button itself stays enabled (subject/message are the only things it disables on).
    if (!user?.organizationId) {
      toast({
        title: "Can't submit ticket yet",
        description: "Your account isn't fully linked to an organization yet. Please try again shortly.",
        variant: "destructive",
      });
      return;
    }
    createTicket(
      {
        organizationId: user.organizationId,
        createdBy: user.id,
        subject: subject.trim(),
        category,
        priority,
        message: message.trim(),
      },
      {
        onSuccess: (ticket) => {
          toast({ title: "Ticket submitted", description: "Our team will respond soon." });
          setShowForm(false);
          setSubject("");
          setMessage("");
          setCategory("general");
          setPriority("normal");
          setLocation(`${base}/help/tickets/${ticket.id}`);
        },
        onError: (e: Error) => toast({ title: "Failed to submit ticket", description: e.message, variant: "destructive" }),
      }
    );
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Submit a Ticket</CardTitle>
          {!showForm && (
            <Button size="sm" onClick={() => setShowForm(true)}>
              <Plus className="h-4 w-4 mr-1" /> New Ticket
            </Button>
          )}
        </CardHeader>
        {showForm && (
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Subject</label>
                <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Briefly describe the issue" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Category</label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SUPPORT_TICKET_CATEGORIES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5 max-w-[10rem]">
              <label className="text-sm font-medium">Priority</label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SUPPORT_TICKET_PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Message</label>
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={5}
                placeholder="What's going on? Include any steps to reproduce, or what you expected to happen."
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button onClick={handleSubmit} disabled={creating || !subject.trim() || !message.trim()}>
                Submit Ticket
              </Button>
            </div>
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">My Tickets</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => <div key={i} className="h-14 bg-muted animate-pulse rounded-md" />)}
            </div>
          ) : !tickets.length ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              You haven't submitted any support tickets yet.
            </p>
          ) : (
            <div className="space-y-2">
              {tickets.map((t) => {
                const status = STATUS_DISPLAY[t.status] ?? { color: "bg-gray-100 text-gray-800", label: t.status };
                return (
                  <Link key={t.id} href={`${base}/help/tickets/${t.id}`}>
                    <div className="flex items-center justify-between gap-3 p-3 rounded-lg border hover:bg-accent/5 cursor-pointer">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium text-sm truncate">{t.subject}</p>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${status.color}`}>
                            {status.label}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          {SUPPORT_TICKET_CATEGORIES.find((c) => c.value === t.category)?.label ?? t.category}
                          {" · "}Updated {new Date(t.last_message_at).toLocaleString()}
                        </p>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function HelpCenter() {
  const [location] = useLocation();
  const base = location.startsWith("/me") ? "/me" : "/app";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Help Center</h1>
        <p className="text-muted-foreground">
          Answers to common questions, step-by-step job aides, the full user manual, and support if you're still stuck.
        </p>
      </div>

      <Tabs defaultValue="faq">
        <TabsList>
          <TabsTrigger value="faq">FAQ</TabsTrigger>
          <TabsTrigger value="job-aides">Job Aides</TabsTrigger>
          <TabsTrigger value="manual">User Manual</TabsTrigger>
          <TabsTrigger value="support">Support</TabsTrigger>
        </TabsList>
        <TabsContent value="faq" className="mt-4"><FaqTab /></TabsContent>
        <TabsContent value="job-aides" className="mt-4"><JobAidesTab /></TabsContent>
        <TabsContent value="manual" className="mt-4"><ManualTab /></TabsContent>
        <TabsContent value="support" className="mt-4"><SupportTab base={base} /></TabsContent>
      </Tabs>
    </div>
  );
}
