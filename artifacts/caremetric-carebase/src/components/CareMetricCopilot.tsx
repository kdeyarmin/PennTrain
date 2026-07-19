import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { Bot, Lightbulb, Loader2, MessageSquarePlus, Send, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth";
import { answerCareMetricCopilot, getCopilotSuggestions, type CopilotAnswer } from "@/lib/caremetricCopilot";
import { cn } from "@/lib/utils";

type ChatMessage =
  | { id: string; role: "user"; content: string }
  | { id: string; role: "assistant"; response: CopilotAnswer };

function CopilotResponse({ response, onNavigate }: { response: CopilotAnswer; onNavigate: () => void }) {
  return (
    <div className="space-y-3 rounded-2xl border border-primary/15 bg-primary/5 p-3 text-sm">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
        <p className="font-semibold text-foreground">{response.title}</p>
        <div className="ml-auto flex items-center gap-1.5">
          <Badge variant="secondary" className="capitalize">{response.intent.replace(/-/g, " ")}</Badge>
          <Badge variant={response.confidence === "high" ? "default" : "outline"} className="capitalize">{response.confidence} confidence</Badge>
        </div>
      </div>
      <p className="leading-relaxed text-muted-foreground">{response.answer}</p>
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recommended next steps</p>
        <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
          {response.nextSteps.map((step) => <li key={step}>{step}</li>)}
        </ol>
      </div>
      {response.links.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {response.links.map((link) => (
            <Button key={link.href} asChild variant="outline" size="sm" className="h-8 rounded-full bg-background" onClick={onNavigate}>
              <Link href={link.href}>{link.label}</Link>
            </Button>
          ))}
        </div>
      )}
      {response.followUpQuestions.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Smart follow-up questions</p>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {response.followUpQuestions.map((followUp) => <li key={followUp}>• {followUp}</li>)}
          </ul>
        </div>
      )}
      {response.caution && <p className="rounded-lg bg-background/80 p-2 text-xs text-muted-foreground">{response.caution}</p>}
    </div>
  );
}

export function CareMetricCopilot() {
  const { user } = useAuth();
  const [location] = useLocation();
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const pendingTimerRef = useRef<number | null>(null);

  const suggestions = useMemo(() => (user ? getCopilotSuggestions(user.role, location) : []), [location, user]);

  // Clear chat state and cancel pending responses when the authenticated user changes (including
  // platform impersonation switches), so messages asked as one user aren't shown to another user.
  useEffect(() => {
    setMessages([]);
    setQuestion("");
    setIsThinking(false);
    if (pendingTimerRef.current !== null) {
      window.clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = null;
    }
  }, [user?.id]);

  if (!user) return null;

  const ask = (prompt = question) => {
    const trimmed = prompt.trim();
    if (!trimmed || isThinking) return;
    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: "user", content: trimmed };
    setMessages((current) => [...current, userMessage]);
    setQuestion("");
    setIsThinking(true);
    pendingTimerRef.current = window.setTimeout(() => {
      const response = answerCareMetricCopilot(trimmed, user, location);
      setMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", response }]);
      setIsThinking(false);
      pendingTimerRef.current = null;
    }, 350);
  };

  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-3 sm:bottom-6 sm:right-6">
      {open && (
        <section
          aria-label="CareMetric Copilot"
          className="flex max-h-[min(720px,calc(100vh-6rem))] w-[calc(100vw-2rem)] max-w-md flex-col overflow-hidden rounded-3xl border bg-card shadow-2xl"
        >
          <div className="flex items-start gap-3 border-b bg-gradient-to-br from-primary/10 via-card to-card p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
              <Bot className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-bold">CareMetric Copilot</h2>
              <p className="text-xs text-muted-foreground">Ask for workflow guidance, page suggestions, compliance triage, or training help.</p>
            </div>
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={() => setOpen(false)} aria-label="Close Copilot">
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            {messages.length === 0 ? (
              <div className="space-y-3">
                <div className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
                  <div className="mb-2 flex items-center gap-2 font-semibold text-foreground"><Lightbulb className="h-4 w-4 text-primary" /> Try asking:</div>
                  <div className="grid gap-2">
                    {suggestions.map((suggestion) => (
                      <button
                        key={suggestion.prompt}
                        type="button"
                        onClick={() => ask(suggestion.prompt)}
                        className="rounded-xl border bg-background p-3 text-left text-sm transition hover:border-primary/50 hover:bg-primary/5"
                      >
                        <span className="font-medium text-foreground">{suggestion.title}</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">{suggestion.prompt}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              messages.map((message) =>
                message.role === "user" ? (
                  <div key={message.id} className="ml-8 rounded-2xl bg-primary px-3 py-2 text-sm text-primary-foreground shadow-sm">{message.content}</div>
                ) : (
                  <CopilotResponse key={message.id} response={message.response} onNavigate={() => setOpen(false)} />
                )
              )
            )}
            {isThinking && (
              <div className="flex items-center gap-2 rounded-2xl border bg-muted/40 p-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Copilot is reviewing CareMetric workflows…
              </div>
            )}
          </div>

          <form
            className="border-t bg-card p-3"
            onSubmit={(event) => {
              event.preventDefault();
              ask();
            }}
          >
            <div className="flex gap-2">
              <Textarea
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    ask();
                  }
                }}
                placeholder="Ask Copilot what to do next…"
                className="max-h-32 min-h-11 resize-none rounded-2xl"
                aria-label="Ask CareMetric Copilot"
              />
              <Button type="submit" size="icon" className="h-11 w-11 shrink-0 rounded-2xl" disabled={!question.trim() || isThinking} aria-label="Send question">
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </form>
        </section>
      )}

      <Button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={cn("h-14 rounded-full px-4 shadow-xl", open && "bg-muted text-foreground hover:bg-muted/90")}
        aria-expanded={open}
        aria-label={open ? "Hide CareMetric Copilot" : "Open CareMetric Copilot"}
      >
        {open ? <X className="mr-2 h-5 w-5" /> : <MessageSquarePlus className="mr-2 h-5 w-5" />}
        Copilot
      </Button>
    </div>
  );
}
