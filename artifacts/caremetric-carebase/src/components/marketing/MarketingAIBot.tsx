import { useMemo, useRef, useState, type FormEvent } from "react";
import { Link } from "wouter";
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  FileCheck2,
  Handshake,
  MessageCircle,
  Minimize2,
  Send,
  Sparkles,
  Target,
  TrendingUp,
  X,
  type LucideIcon,
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
  leadScore,
  leadStage,
  type ContextChip,
  type LeadProfile,
  type Message,
} from "@/lib/marketingAIBotSales";

const QUICK_PROMPTS = [
  "Sell me on CareBase in 30 seconds",
  "What problems do you solve for my facility?",
  "Show me the ROI for replacing spreadsheets",
  "Why should I buy this instead of a basic LMS?",
  "How fast can we roll this out?",
  "What would a demo prove to my team?",
];

const SALES_CARDS: { icon: LucideIcon; label: string; detail: string }[] = [
  {
    icon: Target,
    label: "Find the pain",
    detail: "Missed renewals, survey panic, duplicated records, and binders that are never truly ready.",
  },
  {
    icon: TrendingUp,
    label: "Show the upside",
    detail: "Less admin chasing, faster manager action, cleaner evidence, and stronger survey confidence.",
  },
  {
    icon: Handshake,
    label: "Close the next step",
    detail: "Route serious buyers to a trial, demo, rollout plan, or savings conversation.",
  },
];

export function MarketingAIBot() {
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [input, setInput] = useState("");
  const [leadProfile, setLeadProfile] = useState<LeadProfile>({});
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content:
        "Hi — I’m the CareBase customer service assistant. Tell me what you are trying to fix, and I’ll show how CareBase can reduce admin work, strengthen survey readiness, and prove value to your team.",
      bullets: [
        "I can walk you through the platform, answer questions, explain ROI, compare against an LMS, or help you prepare for a demo.",
      ],
      closer: "Start with one question, choose a context, or tap a prompt below.",
      cta: { label: "Start your free trial", href: "/signup" },
    },
  ]);
  const transcriptRef = useRef<HTMLDivElement>(null);

  const smartPrompt = useMemo(
    () => QUICK_PROMPTS[Math.floor(messages.length % QUICK_PROMPTS.length)],
    [messages.length],
  );
  const profileLabel = leadProfileSummary(leadProfile);
  const currentLeadScore = leadScore(leadProfile, messages.length);
  const currentLeadStage = leadStage(currentLeadScore);
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

  if (!open) {
    return (
      <aside className="fixed bottom-5 right-4 z-50 flex flex-col items-end gap-3 sm:right-6" aria-label="CareBase customer service assistant">
        <div className="hidden max-w-xs rounded-2xl border border-primary/20 bg-background/95 p-3 text-sm shadow-2xl backdrop-blur sm:block">
          <div className="flex items-center gap-2 font-semibold">
            <Sparkles className="h-4 w-4 text-primary" /> Ask CareBase Customer Service
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{smartPrompt}</p>
        </div>
        <Button
          size="lg"
          className="h-14 rounded-full px-5 shadow-2xl"
          onClick={() => setOpen(true)}
          data-testid="button-open-marketing-ai-bot"
        >
          <MessageCircle className="mr-2 h-5 w-5" /> Ask Customer Service
        </Button>
      </aside>
    );
  }

  return (
    <aside
      className="fixed inset-x-3 bottom-3 z-50 max-h-[calc(100dvh-1.5rem)] overflow-hidden rounded-3xl border border-border/70 bg-background shadow-2xl sm:inset-x-auto sm:right-6 sm:bottom-4 sm:w-[28rem] md:w-[30rem]"
      aria-label="CareBase customer service assistant"
    >
      <div className="flex items-center justify-between gap-3 bg-gradient-to-r from-[#071626] to-[#2552b8] p-3 text-white sm:p-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/12">
            <Bot className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="truncate font-semibold">CareBase Customer Service AI</div>
            <div className="truncate text-xs text-white/70">Answers to help you get the most from CareBase</div>
          </div>
        </div>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-white hover:bg-white/10"
            onClick={() => setMinimized((value) => !value)}
            aria-label="Minimize AI guide"
          >
            <Minimize2 className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-white hover:bg-white/10"
            onClick={() => setOpen(false)}
            aria-label="Close AI guide"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
      {!minimized && (
        <>
          <div className="border-b border-border/60 bg-primary/5 px-3 py-2 text-xs">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold text-primary">{currentLeadStage.label}</div>
                <div className="truncate text-muted-foreground">
                  {profileLabel ? `Your context: ${profileLabel}` : currentLeadStage.detail}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="rounded-full bg-background px-2 py-1 font-mono text-[10px] text-muted-foreground">
                  {Math.min(currentLeadScore, 100)}% fit
                </span>
                {profileLabel ? (
                  <button
                    type="button"
                    className="font-medium text-muted-foreground hover:text-foreground"
                    onClick={() => setLeadProfile({})}
                  >
                    Clear
                  </button>
                ) : null}
              </div>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-background">
              <div
                className="h-full rounded-full bg-gradient-to-r from-primary to-[#59b2ff] transition-all"
                style={{ width: `${Math.min(currentLeadScore, 100)}%` }}
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 border-b border-border/60 bg-muted/30 p-2 sm:p-3">
            {SALES_CARDS.map((card) => (
              <div key={card.label} className="rounded-xl bg-background p-2 text-[11px] sm:text-xs">
                <card.icon className="mb-1 h-4 w-4 text-primary" />
                <div className="font-semibold">{card.label}</div>
                <div className="mt-1 hidden text-muted-foreground sm:line-clamp-3 sm:block">{card.detail}</div>
              </div>
            ))}
          </div>
          <div ref={transcriptRef} className="max-h-[min(48dvh,28rem)] space-y-3 overflow-y-auto overscroll-contain p-3 sm:p-4">
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
            <span className="font-semibold text-foreground">Next best action:</span> {currentLeadStage.detail}.
            <Button asChild variant="link" size="sm" className="ml-1 h-auto p-0 text-xs">
              <Link href="/signup">Start your free trial</Link>
            </Button>
            <Button asChild variant="link" size="sm" className="ml-2 h-auto p-0 text-xs">
              <a href={demoMailtoHref}>Email your context</a>
            </Button>
            <Button asChild variant="link" size="sm" className="ml-2 h-auto p-0 text-xs">
              <a href={prospectEmail.mailtoHref}>Send prospect email</a>
            </Button>
          </div>
          <form onSubmit={submit} className="flex gap-2 border-t border-border/60 p-2 sm:p-3">
            <Input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask customer service about ROI, fit, demo, rollout..."
              aria-label="Ask the CareBase customer service assistant"
            />
            <Button type="submit" size="icon" aria-label="Send question">
              <Send className="h-4 w-4" />
            </Button>
          </form>
          <div className="flex items-start gap-2 bg-muted/30 px-3 py-2 text-[11px] leading-4 text-muted-foreground sm:px-4">
            <FileCheck2 className="h-3.5 w-3.5" /> This guidance is informational; CareBase helps organize
            evidence but does not replace your regulator, counsel, or compliance advisor.
          </div>
        </>
      )}
    </aside>
  );
}
