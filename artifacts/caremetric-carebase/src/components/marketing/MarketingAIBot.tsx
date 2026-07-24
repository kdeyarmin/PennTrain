import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link } from "wouter";
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  FileCheck2,
  MessageCircle,
  Minimize2,
  Send,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  CONTEXT_CHIPS,
  answerQuestion,
  buildDemoMailtoHref,
  buildProspectEmail,
  getFollowUpPrompts,
  leadProfileSummary,
  type ContextChip,
  type LeadProfile,
  type Message,
} from "@/lib/marketingAIBotSales";

export function MarketingAIBot() {
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [input, setInput] = useState("");
  const [leadProfile, setLeadProfile] = useState<LeadProfile>({});
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content:
        "Hi — I’m the CareBase Guide. Ask what the platform does, how pricing works, or what a rollout would look like for your facility, and I’ll answer from our product guide.",
      bullets: [
        "I can walk you through the platform, explain the savings model, compare CareBase with a basic LMS, or help you prepare for a demo.",
      ],
      closer: "Start with one question, choose a context, or tap a prompt below.",
      cta: { label: "Start your free trial", href: "/signup" },
    },
  ]);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const hasOpenedRef = useRef(false);

  // Focus management: move focus into the panel when it opens, and return it to the
  // launcher when it closes (but never steal focus on initial page load).
  useEffect(() => {
    if (open) {
      hasOpenedRef.current = true;
      panelRef.current?.focus();
    } else if (hasOpenedRef.current) {
      launcherRef.current?.focus();
    }
  }, [open]);

  const profileLabel = leadProfileSummary(leadProfile);
  const followUpPrompts = useMemo(() => getFollowUpPrompts(leadProfile), [leadProfile]);
  const demoMailtoHref = useMemo(() => buildDemoMailtoHref(leadProfile), [leadProfile]);
  const prospectEmail = useMemo(() => buildProspectEmail(leadProfile), [leadProfile]);

  const ask = (question: string, profileOverride = leadProfile) => {
    const trimmed = question.trim();
    if (!trimmed) return;
    setOpen(true);
    setMinimized(false);
    setMessages((current) => [...current, { role: "user", content: trimmed }, answerQuestion(trimmed, profileOverride)]);
    setInput("");
    window.setTimeout(
      () => transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: "smooth" }),
      0,
    );
  };

  const selectContext = (chip: ContextChip) => {
    const nextProfile = { ...leadProfile, [chip.field]: chip.value };
    setLeadProfile(nextProfile);
    ask(chip.prompt, nextProfile);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    ask(input);
  };

  const handlePanelKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      setOpen(false);
    }
  };

  if (!open) {
    return (
      <aside className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-3 sm:right-6" aria-label="CareBase Guide">
        <Button
          ref={launcherRef}
          className="h-11 rounded-full px-4 text-sm shadow-lg"
          onClick={() => setOpen(true)}
          data-testid="button-open-marketing-ai-bot"
        >
          <MessageCircle className="mr-2 h-4 w-4" /> Ask the CareBase Guide
        </Button>
      </aside>
    );
  }

  return (
    <aside
      ref={panelRef}
      tabIndex={-1}
      onKeyDown={handlePanelKeyDown}
      className="fixed inset-x-3 bottom-3 z-50 max-h-[calc(100dvh-1.5rem)] overflow-hidden rounded-3xl border border-border/70 bg-background shadow-2xl outline-none sm:inset-x-auto sm:right-6 sm:bottom-4 sm:w-[28rem] md:w-[30rem]"
      aria-label="CareBase Guide"
    >
      <div className="flex items-center justify-between gap-3 bg-gradient-to-r from-[#071626] to-[#2552b8] p-3 text-white sm:p-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/12">
            <BookOpen className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="truncate font-semibold">CareBase Guide</div>
            <div className="truncate text-xs text-white/70">Instant answers from our product guide</div>
          </div>
        </div>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-white hover:bg-white/10"
            onClick={() => setMinimized((value) => !value)}
            aria-label={minimized ? "Expand the CareBase Guide" : "Minimize the CareBase Guide"}
          >
            <Minimize2 className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-white hover:bg-white/10"
            onClick={() => setOpen(false)}
            aria-label="Close the CareBase Guide"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
      {!minimized && (
        <>
          {profileLabel ? (
            <div className="flex items-center justify-between gap-3 border-b border-border/60 bg-primary/5 px-3 py-2 text-xs">
              <div className="truncate text-muted-foreground">
                Your context: <span className="font-medium text-foreground">{profileLabel}</span>
              </div>
              <button
                type="button"
                className="shrink-0 font-medium text-muted-foreground hover:text-foreground"
                onClick={() => setLeadProfile({})}
              >
                Clear
              </button>
            </div>
          ) : null}
          <div
            ref={transcriptRef}
            aria-live="polite"
            className="max-h-[min(48dvh,28rem)] space-y-3 overflow-y-auto overscroll-contain p-3 sm:p-4"
          >
            {messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={cn(
                  "rounded-2xl p-3 text-sm",
                  message.role === "user" ? "ml-10 bg-primary text-primary-foreground" : "mr-6 border bg-card",
                )}
              >
                <p className="leading-6">{message.content}</p>
                {message.bullets ? (
                  <ul className="mt-2 space-y-1">
                    {message.bullets.map((bullet) => (
                      <li key={bullet} className="flex gap-2 text-xs leading-5">
                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                        <span>{bullet}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {message.closer ? (
                  <p className="mt-3 rounded-xl bg-primary/10 p-2 text-xs font-medium leading-5 text-primary">
                    {message.closer}
                  </p>
                ) : null}
                {message.cta ? (
                  <Button asChild size="sm" variant="outline" className="mt-3 h-8">
                    <Link href={message.cta.href}>
                      {message.cta.label}
                      <ArrowRight className="ml-1 h-3.5 w-3.5" />
                    </Link>
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
          <div className="space-y-2 border-t border-border/60 p-3">
            <div className="flex gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible">
              {CONTEXT_CHIPS.map((chip) => (
                <button
                  key={chip.label}
                  type="button"
                  onClick={() => selectContext(chip)}
                  className="shrink-0 rounded-full bg-primary/10 px-3 py-1 text-left text-xs font-medium text-primary hover:bg-primary/15"
                >
                  {chip.label}
                </button>
              ))}
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible">
              {followUpPrompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => ask(prompt)}
                  className="shrink-0 rounded-full border bg-card px-3 py-1 text-left text-xs text-muted-foreground hover:border-primary/50 hover:text-foreground"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
          <div className="border-t border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">Next steps:</span>
            <Button asChild variant="link" size="sm" className="ml-1 h-auto p-0 text-xs">
              <Link href="/signup">Start your free trial</Link>
            </Button>
            <Button asChild variant="link" size="sm" className="ml-2 h-auto p-0 text-xs">
              <a href={demoMailtoHref}>Email us your context</a>
            </Button>
            <Button asChild variant="link" size="sm" className="ml-2 h-auto p-0 text-xs">
              <a href={prospectEmail.mailtoHref}>Email a summary</a>
            </Button>
          </div>
          <form onSubmit={submit} className="flex gap-2 border-t border-border/60 p-2 sm:p-3">
            <Input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask about features, pricing, rollout, security..."
              aria-label="Ask the CareBase Guide"
            />
            <Button type="submit" size="icon" aria-label="Send question">
              <Send className="h-4 w-4" />
            </Button>
          </form>
          <div className="flex items-start gap-2 bg-muted/30 px-3 py-2 text-[11px] leading-4 text-muted-foreground sm:px-4">
            <FileCheck2 className="h-3.5 w-3.5" /> Answers come from our product guide. This guidance is
            informational; CareBase helps organize documentation but does not replace your regulator,
            counsel, or compliance advisor.
          </div>
        </>
      )}
    </aside>
  );
}
