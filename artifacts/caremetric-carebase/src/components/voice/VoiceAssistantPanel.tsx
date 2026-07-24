// Voice assistant panel — mounted on the Regulatory Copilot page behind the
// VITE_VOICE_GATEWAY_URL feature flag. Talks to the shared voice gateway
// (artifacts/voice-gateway); all data access happens server-side through the
// voice-tools edge function under the caller's own RLS scope.

import { useEffect, useRef } from "react";
import { Loader2, Mic, Square, Volume2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useVoiceSession } from "@/hooks/useVoiceSession";
import { useListPlatformSettings } from "@/hooks/usePlatformSettings";

const TOOL_BUSY_TEXT: Record<string, string> = {
  ask_compliance_question: "Checking the grounded compliance copilot…",
  get_facility_readiness: "Checking the readiness score…",
  get_upcoming_deadlines: "Checking upcoming deadlines…",
};

export function VoiceAssistantPanel({
  facilityId,
  facilityName,
}: {
  facilityId: string;
  facilityName?: string;
}) {
  const session = useVoiceSession(facilityId);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  // Platform kill-switch (voice_assistant_enabled). platform_settings is
  // platform_admin-only under RLS, so non-admin roles simply don't see the
  // row (empty list, no error) and the panel stays visible for them — the
  // real fail-closed enforcement is server-side: voice-tools re-checks the
  // setting on every call. This read hides the UI wherever the row IS
  // readable and explicitly false.
  const { data: platformSettings } = useListPlatformSettings();
  const disabledByPlatform = (platformSettings ?? []).some(
    (setting) => setting.key === "voice_assistant_enabled" && setting.value === false,
  );

  useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [session.turns, session.livePartial]);

  if (disabledByPlatform) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Volume2 className="h-5 w-5" />
            Voice assistant
          </CardTitle>
          <CardDescription>
            The voice assistant is currently disabled by the platform
            administrator. It can be re-enabled from Platform Settings.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const live = session.status === "active";
  const starting =
    session.status === "requesting" || session.status === "connecting";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <Volume2 className="h-5 w-5" />
            Voice assistant
          </CardTitle>
          {live && (
            <Badge variant="secondary" className="animate-pulse">
              Live
            </Badge>
          )}
        </div>
        <CardDescription>
          Talk through compliance for {facilityName ?? "this facility"} —
          readiness, upcoming deadlines, and grounded regulatory answers for
          Personal Care Homes and Assisted Living Facilities (ALFs). Regulatory
          answers run through the citation-backed copilot and appear in its
          immutable history.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!facilityId && (
          <p className="text-sm text-muted-foreground">
            Select a facility on the Ask tab to start a voice session.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          {!live && !starting && (
            <Button onClick={() => void session.start()} disabled={!facilityId}>
              <Mic className="mr-2 h-4 w-4" />
              Start voice session
            </Button>
          )}
          {starting && (
            <Button disabled>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {session.status === "requesting"
                ? "Requesting microphone…"
                : "Connecting…"}
            </Button>
          )}
          {live && (
            <Button variant="destructive" onClick={session.stop}>
              <Square className="mr-2 h-4 w-4" />
              End session
            </Button>
          )}
          {live && session.busyTool && (
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {TOOL_BUSY_TEXT[session.busyTool] ?? "Looking that up…"}
            </span>
          )}
        </div>

        {session.error && (
          <Alert variant="destructive">
            <AlertTitle>Voice session problem</AlertTitle>
            <AlertDescription>{session.error}</AlertDescription>
          </Alert>
        )}
        {session.notice && !session.error && (
          <Alert>
            <AlertDescription>{session.notice}</AlertDescription>
          </Alert>
        )}
        {session.endMessage && session.status === "ended" && (
          <p className="text-sm text-muted-foreground">{session.endMessage}</p>
        )}

        {(session.turns.length > 0 || session.livePartial) && (
          <div
            ref={transcriptRef}
            className="max-h-72 space-y-2 overflow-y-auto rounded-lg border p-3"
          >
            {session.turns.map((turn, index) => (
              <p key={index} className="text-sm leading-6">
                <span className="font-medium">
                  {turn.role === "assistant" ? "Assistant: " : "You: "}
                </span>
                {turn.text}
              </p>
            ))}
            {session.livePartial && (
              <p className="text-sm italic leading-6 text-muted-foreground">
                <span className="font-medium">
                  {session.livePartial.role === "assistant"
                    ? "Assistant: "
                    : "You: "}
                </span>
                {session.livePartial.text}
              </p>
            )}
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          AI assistance — verify answers before acting. Audio is never
          recorded; the transcript above disappears when this page closes.
        </p>
      </CardContent>
    </Card>
  );
}
