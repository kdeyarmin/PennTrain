import type { ReactNode } from "react";
import { useParams } from "wouter";
import {
  useEvidenceGuestRoom,
  useAcceptEvidenceGuestTerms,
  useEvidenceGuestDownload,
  type EvidenceGuestArtifact,
} from "@/hooks/useEvidenceRoom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Download, FolderLock, Loader2, ShieldCheck, ShieldX } from "lucide-react";

// Public, session-less evidence room for surveyors. The link token is the whole
// credential: the server re-checks revocation/expiry/scope on every call and logs each
// view and download, so this page only renders what the RPCs already authorized.

function formatBytes(bytes: number | null): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-muted/40 flex items-start justify-center px-4 py-10">
      <div className="w-full max-w-2xl space-y-4">
        <div className="flex items-center gap-2 text-muted-foreground">
          <FolderLock className="h-5 w-5" />
          <span className="font-semibold tracking-tight text-foreground">CareMetric CareBase</span>
          <span className="text-sm">· Evidence Room</span>
        </div>
        {children}
        <p className="text-xs text-muted-foreground text-center">
          Access to this room is logged. Documents are confidential compliance records shared for
          survey and audit purposes only.
        </p>
      </div>
    </div>
  );
}

export default function EvidenceGuestRoom() {
  const { token } = useParams<{ token: string }>();
  const { toast } = useToast();
  const { data: room, isLoading, isError, refetch } = useEvidenceGuestRoom(token);
  const acceptTerms = useAcceptEvidenceGuestTerms();
  const download = useEvidenceGuestDownload();

  if (isLoading) {
    return (
      <Shell>
        <Card>
          <CardContent className="py-16 flex items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> Opening the evidence room…
          </CardContent>
        </Card>
      </Shell>
    );
  }

  if (isError || !room || (!room.authorized && !room.needsTerms)) {
    return (
      <Shell>
        <Card>
          <CardHeader>
            <CardTitle role="heading" aria-level={1} className="flex items-center gap-2">
              <ShieldX className="h-5 w-5 text-red-600" /> This link is no longer available
            </CardTitle>
            <CardDescription>
              {room?.reason === "step_up_required"
                ? "This link requires additional identity verification. Please contact the facility that shared it with you."
                : "The link may have expired or been revoked, or the address may be incomplete. Please contact the facility that shared it with you for a new link."}
            </CardDescription>
          </CardHeader>
          {isError && (
            <CardContent>
              <Button variant="outline" onClick={() => refetch()}>Try again</Button>
            </CardContent>
          )}
        </Card>
      </Shell>
    );
  }

  if (room.needsTerms) {
    return (
      <Shell>
        <Card>
          <CardHeader>
            <CardTitle role="heading" aria-level={1}>{room.collection?.name}</CardTitle>
            <CardDescription>{room.collection?.purpose}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm">
              Hello{room.guestLabel ? ` ${room.guestLabel}` : ""} — you have been granted temporary access to
              confidential compliance records.
            </p>
            <div className="rounded-md border bg-muted/40 p-4 text-sm space-y-2">
              <p className="font-medium">Terms of access ({room.termsVersion})</p>
              <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
                <li>These documents are confidential and shared solely for survey, audit, or inspection purposes.</li>
                <li>Do not redistribute the documents or this link; access is personal to you and expires automatically.</li>
                <li>Every view and download is recorded in an access log the facility retains.</li>
              </ul>
            </div>
            <Button
              className="w-full"
              disabled={acceptTerms.isPending}
              onClick={() =>
                acceptTerms.mutate(token!, {
                  onSuccess: (result) => {
                    if (!result.accepted) {
                      toast({ title: "This link is no longer available", variant: "destructive" });
                    }
                  },
                  onError: () => toast({ title: "Something went wrong", description: "Please try again.", variant: "destructive" }),
                })
              }
            >
              {acceptTerms.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ShieldCheck className="h-4 w-4 mr-2" />}
              Accept terms and open the room
            </Button>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  const artifacts = room.artifacts ?? [];

  const handleDownload = (artifact: EvidenceGuestArtifact) => {
    download.mutate(
      { token: token!, artifactId: artifact.id },
      {
        onSuccess: ({ url }) => {
          window.open(url, "_blank", "noopener,noreferrer");
        },
        onError: (err) =>
          toast({
            title: "Download unavailable",
            description: err instanceof Error ? err.message : "This document is no longer available.",
            variant: "destructive",
          }),
      },
    );
  };

  return (
    <Shell>
      <Card>
        <CardHeader>
          <CardTitle role="heading" aria-level={1}>{room.collection?.name}</CardTitle>
          <CardDescription>{room.collection?.purpose}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {room.guestLabel && <span>Shared with: {room.guestLabel}</span>}
            {room.expiresAt && <span>Access expires {new Date(room.expiresAt).toLocaleDateString()}</span>}
          </div>
          {artifacts.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No documents are currently shared in this room.
            </p>
          ) : (
            <ul className="divide-y rounded-md border">
              {artifacts.map((artifact) => (
                <li key={artifact.id} className="flex items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{artifact.displayName}</p>
                    <p className="text-xs text-muted-foreground">
                      {[
                        artifact.artifactType === "binder" ? "Compliance binder (PDF)" : artifact.artifactType.toUpperCase(),
                        formatBytes(artifact.byteSize),
                      ].filter(Boolean).join(" · ")}
                    </p>
                    {artifact.contentSha256 && (
                      <p className="font-mono text-[10px] text-muted-foreground truncate" title={artifact.contentSha256}>
                        SHA-256 {artifact.contentSha256}
                      </p>
                    )}
                  </div>
                  <Button size="sm" onClick={() => handleDownload(artifact)} disabled={download.isPending}>
                    {download.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />}
                    Download
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </Shell>
  );
}
