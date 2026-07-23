import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { Bot, Lightbulb, MessageSquarePlus, Mic, Send, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth";
import { answerCareMetricCopilot, getCopilotSuggestions, type CopilotAnswer } from "@/lib/caremetricCopilot";
import { voiceAssistantEnabled } from "@/lib/voice/voiceGatewayConfig";
import { cn } from "@/lib/utils";

type ChatMessage =
  | { id: string; role: "user"; content: string }
  | { id: string; role: "assistant"; response: CopilotAnswer; question: string };

// The floating assistant answers from a deterministic, rule-based intent router
// (`answerCareMetricCopilot`) -- it is instant guidance and navigation, not a language
// model. Roles authorized for the grounded, citation-backed AI copilot get an explicit
// hand-off into that experience, which runs a real, tenant-scoped compliance-copilot call.
function groundedCopilotPathForRole(role: string | undefined): string | null {
  if (role === "platform_admin") return "/admin/regulatory-copilot";
  if (role === "org_admin" || role === "facility_manager" || role === "auditor") return "/app/regulatory-copilot";
  return null;
}

function CopilotResponse({
  response,
  aiHandoffHref,
  onNavigate,
}: {
  response: CopilotAnswer;
  aiHandoffHref: string | null;
  onNavigate: () => void;
}) {
  return (
    <div className="space-y-3 rounded-2xl border border-primary/15 bg-primary/5 p-3 text-sm">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
        <p className="font-semibold text-foreground">{response.title}</p>
        <Badge variant="secondary" className="ml-auto capitalize">{response.intent.replace(/-/g, " ")}</Badge>
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
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Related questions</p>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {response.followUpQuestions.map((followUp) => <li key={followUp}>• {followUp}</li>)}
          </ul>
        </div>
      )}
      {response.caution && <p className="rounded-lg bg-background/80 p-2 text-xs text-muted-foreground">{response.caution}</p>}
      {aiHandoffHref && (
        <Button asChild variant="ghost" size="sm" className="h-8 w-full justify-start rounded-lg text-primary hover:bg-primary/10" onClick={onNavigate}>
          <Link href={aiHandoffHref}>
            <Bot className="mr-2 h-4 w-4" aria-hidden="true" />
            Get a citation-backed answer from the AI Compliance Copilot
          </Link>
        </Button>
      )}
      {aiHandoffHref && voiceAssistantEnabled && (
        <Button asChild variant="ghost" size="sm" className="h-8 w-full justify-start rounded-lg text-primary hover:bg-primary/10" onClick={onNavigate}>
          <Link href={aiHandoffHref}>
            <Mic className="mr-2 h-4 w-4" aria-hidden="true" />
            Try the voice assistant (Voice tab on the copilot page)
          </Link>
        </Button>
      )}
    </div>
  );
}

export function CareMetricCopilot() {
  const { user } = useAuth();
  const [location] = useLocation();
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const suggestions = useMemo(() => (user ? getCopilotSuggestions(user.role, location) : []), [location, user]);
  const groundedCopilotPath = groundedCopilotPathForRole(user?.role);

  // Clear chat state when the authenticated user changes (including platform impersonation
  // switches), so guidance asked as one user isn't shown to another user.
  useEffect(() => {
    setMessages([]);
    setQuestion("");
  }, [user?.id]);

  if (!user) return null;

  const ask = (prompt = question) => {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    const response = answerCareMetricCopilot(trimmed, user, location);
    setMessages((current) => [
      ...current,
      { id: crypto.randomUUID(), role: "user", content: trimmed },
      { id: crypto.randomUUID(), role: "assistant", response, question: trimmed },
    ]);
    setQuestion("");
  };

  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-3 sm:bottom-6 sm:right-6">
      {open && (
        <section
          aria-label="CareMetric guide"
          className="flex max-h-[min(720px,calc(100vh-6rem))] w-[calc(100vw-2rem)] max-w-md flex-col overflow-hidden rounded-3xl border bg-card shadow-2xl"
        >
          <div className="flex items-start gap-3 border-b bg-gradient-to-br from-primary/10 via-card to-card p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
              <Sparkles className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-bold">CareMetric guide</h2>
              <p className="text-xs text-muted-foreground">
                Instant, rule-based guidance and page navigation.
                {groundedCopilotPath ? " Hand off to the AI Compliance Copilot for citation-backed regulatory answers." : ""}
              </p>
            </div>
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={() => setOpen(false)} aria-label="Close guide">
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
                  <CopilotResponse
                    key={message.id}
                    response={message.response}
                    aiHandoffHref={groundedCopilotPath ? `${groundedCopilotPath}?q=${encodeURIComponent(message.question)}` : null}
                    onNavigate={() => setOpen(false)}
                  />
                )
              )
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
                placeholder="Ask where to go or what to do next…"
                className="max-h-32 min-h-11 resize-none rounded-2xl"
                aria-label="Ask the CareMetric guide"
              />
              <Button type="submit" size="icon" className="h-11 w-11 shrink-0 rounded-2xl" disabled={!question.trim()} aria-label="Send question">
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
        aria-label={open ? "Hide CareMetric guide" : "Open CareMetric guide"}
      >
        {open ? <X className="mr-2 h-5 w-5" /> : <MessageSquarePlus className="mr-2 h-5 w-5" />}
        Guide
      </Button>
    </div>
  );
}
