import { useState, type ReactNode } from "react";
import { useParams } from "wouter";
import { useSurveyPacketGuestDownload } from "@/hooks/useSurveyEvidencePacket";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Archive, Download, Loader2, ShieldX } from "lucide-react";
import { clearStoredPublicAccessToken, consumePublicAccessToken } from "@/lib/publicAccessToken";

const SESSION_TOKEN_KEY = "carebase-survey-packet-token";

// Public, session-less download page for the survey evidence packet zip. The grant token in
// the link is the whole credential: survey-packet-guest-download re-checks revocation and
// expiry on every call and logs each download, so this page only hands over what the server
// already authorized. Mirrors EvidenceGuestRoom's token handling (consume once, scrub the
// URL, keep the credential tab-scoped).

function formatBytes(bytes: number | undefined): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-muted/40 flex items-start justify-center px-4 py-10">
      <div className="w-full max-w-2xl space-y-4">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Archive className="h-5 w-5" />
          <span className="font-semibold tracking-tight text-foreground">CareMetric CareBase</span>
          <span className="text-sm">· Survey Evidence Packet</span>
        </div>
        {children}
        <p className="text-xs text-muted-foreground text-center">
          Access to this packet is logged. Its contents are confidential compliance records shared
          for survey and audit purposes only.
        </p>
      </div>
    </div>
  );
}

export default function SurveyPacketGuestDownload() {
  const { token: routeToken } = useParams<{ token?: string }>();
  const [token] = useState(() => consumePublicAccessToken(
    routeToken,
    SESSION_TOKEN_KEY,
    "/survey-packet-access",
  ));
  const download = useSurveyPacketGuestDownload();

  if (!token) {
    return (
      <Shell>
        <Card>
          <CardHeader>
            <CardTitle role="heading" aria-level={1} className="flex items-center gap-2">
              <ShieldX className="h-5 w-5 text-red-600" /> This link is incomplete
            </CardTitle>
            <CardDescription>
              The address is missing its access token. Please use the full link the facility shared
              with you, or contact them for a new one.
            </CardDescription>
          </CardHeader>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell>
      <Card>
        <CardHeader>
          <CardTitle role="heading" aria-level={1}>Survey evidence packet</CardTitle>
          <CardDescription>
            You have been granted temporary access to download a packaged set of compliance
            evidence. The download link is generated fresh each time and expires after a few
            minutes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {download.isError && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {download.error instanceof Error
                ? download.error.message
                : "This packet is no longer available."}{" "}
              The grant may have expired or been revoked — contact the facility that shared this
              link if you still need access.
            </div>
          )}
          {download.data ? (
            <div className="space-y-3">
              <p className="text-sm">
                {download.data.guestLabel ? `${download.data.guestLabel} — ` : ""}your download is
                ready{download.data.byteSize ? ` (${formatBytes(download.data.byteSize)})` : ""}.
              </p>
              <Button asChild className="w-full">
                <a href={download.data.downloadUrl} download>
                  <Download className="mr-2 h-4 w-4" /> Download packet (zip)
                </a>
              </Button>
              {download.data.contentSha256 && (
                <p className="break-all text-xs text-muted-foreground">
                  SHA-256 {download.data.contentSha256}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Link expired? Request a fresh one below — each request is re-authorized and logged.
              </p>
            </div>
          ) : null}
          <Button
            className="w-full"
            variant={download.data ? "outline" : "default"}
            disabled={download.isPending}
            onClick={() =>
              download.mutate(token, {
                onError: (error: unknown) => {
                  // A definitive server refusal means the credential is dead -- drop the stored
                  // copy so it is not replayed on the next visit. Network errors from the
                  // invoke path surface differently (FunctionsFetchError), so this only clears
                  // on the endpoint's own denial message.
                  if (error instanceof Error && /no longer available|Access denied/i.test(error.message)) {
                    clearStoredPublicAccessToken(SESSION_TOKEN_KEY);
                  }
                },
              })
            }
          >
            {download.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Preparing download…
              </>
            ) : download.data ? (
              "Request a fresh download link"
            ) : (
              "Prepare my download"
            )}
          </Button>
        </CardContent>
      </Card>
    </Shell>
  );
}
