import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  useAddSurveyEvidencePacketItem,
  useAssembleSurveyEvidencePacket,
  useIssueSurveyPacketGuestGrant,
  useRevokeSurveyPacketGuestGrant,
  useSurveyPacketGuestGrants,
  usePackageSurveyEvidencePacket,
  useRemoveSurveyEvidencePacketItem,
  useSurveyEvidencePacketExports,
  useSurveyEvidencePacketItems,
} from "@/hooks/useSurveyEvidencePacket";
import {
  surveyEvidencePacketManifest,
  extractSurveyEvidencePacketCitation,
  type SurveyEvidencePacketJob,
} from "@/lib/surveyEvidencePacket";

/**
 * Lazy Survey Day section: packet selection, zip package, and surveyor guest grant.
 * Split from SurveyDay.tsx so the route shell stays under the route budget while
 * packaging UI only loads when a binder is pinned.
 */
/**
 * Who currently holds guest access to this packet.
 *
 * Listing it at all is half the fix: before this, a grant was issued, its token shown once, and
 * then it was invisible. Somebody auditing who could reach a compliance packet had nowhere to look,
 * and `revoke_survey_packet_guest_grant` -- which exists and is complete -- had no caller.
 *
 * Revoked and expired grants stay on the list rather than disappearing. Who *used to* have access,
 * and why it was taken away, is the part an auditor asks about.
 */
function GuestGrantList({
  packetExportId, revoking, reason, pending,
  onStartRevoke, onCancelRevoke, onReasonChange, onConfirmRevoke,
}: {
  packetExportId: string;
  revoking: string | null;
  reason: string;
  pending: boolean;
  onStartRevoke: (id: string) => void;
  onCancelRevoke: () => void;
  onReasonChange: (value: string) => void;
  onConfirmRevoke: (id: string) => void;
}) {
  const grants = useSurveyPacketGuestGrants(packetExportId);
  if (!grants.data?.length) return null;

  const now = Date.now();
  return (
    <div className="space-y-1 border-t pt-2">
      <p className="text-sm font-medium">Guest access ({grants.data.length})</p>
      {grants.data.map((grant) => {
        const expired = new Date(grant.expires_at).getTime() <= now;
        const state = grant.revoked_at ? "revoked" : expired ? "expired" : "active";
        return (
          <div key={grant.id} className="rounded border p-2">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-medium">
                  {grant.guest_label}{" "}
                  <span className={state === "active" ? "text-emerald-700 dark:text-emerald-500" : "text-muted-foreground"}>
                    · {state}
                  </span>
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {state === "revoked"
                    ? `Revoked — ${grant.revocation_reason ?? "no reason recorded"}`
                    : `Expires ${new Date(grant.expires_at).toLocaleString()}`}
                  {" · downloaded "}{grant.download_count ?? 0}×
                  {grant.last_downloaded_at ? ` (last ${new Date(grant.last_downloaded_at).toLocaleDateString()})` : ""}
                </p>
              </div>
              {state === "active" && revoking !== grant.id && (
                <Button size="sm" variant="outline" onClick={() => onStartRevoke(grant.id)}>
                  Revoke
                </Button>
              )}
            </div>
            {revoking === grant.id && (
              <div className="mt-2 space-y-1">
                <Input
                  className="h-8"
                  aria-label={`Why access for ${grant.guest_label} is being revoked`}
                  value={reason}
                  onChange={(e) => onReasonChange(e.target.value)}
                  placeholder="Why access is being withdrawn"
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    disabled={reason.trim().length < 5 || pending}
                    onClick={() => onConfirmRevoke(grant.id)}
                  >
                    {pending ? "Revoking…" : "Confirm revoke"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={onCancelRevoke}>Cancel</Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  At least five characters — the reason is kept on the grant.
                </p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function SurveyDayPacketSection({
  sessionId,
  facilityId,
  pinnedBinderJobId,
  pinnedBinder,
}: {
  sessionId: string;
  facilityId: string;
  pinnedBinderJobId: string;
  pinnedBinder: SurveyEvidencePacketJob;
}) {
  const { toast } = useToast();
  const packetItems = useSurveyEvidencePacketItems({
    surveyDaySessionId: sessionId,
    binderExportJobId: pinnedBinderJobId,
  });
  const packetExports = useSurveyEvidencePacketExports({
    surveyDaySessionId: sessionId,
    binderExportJobId: pinnedBinderJobId,
  });
  const addPacketItem = useAddSurveyEvidencePacketItem();
  const removePacketItem = useRemoveSurveyEvidencePacketItem();
  const assemblePacket = useAssembleSurveyEvidencePacket();
  const packagePacket = usePackageSurveyEvidencePacket();
  const issueGuest = useIssueSurveyPacketGuestGrant();
  const revokeGuest = useRevokeSurveyPacketGuestGrant();
  const [revokingGrantId, setRevokingGrantId] = useState<string | null>(null);
  const [revokeReason, setRevokeReason] = useState("");
  const [packetNote, setPacketNote] = useState("");
  const [packetCitation, setPacketCitation] = useState("");
  const [assembledManifest, setAssembledManifest] = useState<Record<string, unknown> | null>(null);
  const [guestLabel, setGuestLabel] = useState("Surveyor packet access");
  const [lastGuestToken, setLastGuestToken] = useState<string | null>(null);

  const packetManifest = surveyEvidencePacketManifest(pinnedBinder);
  const latestExport = (packetExports.data ?? [])[0] ?? null;

  return (
    <div className="mt-3 rounded-md bg-muted/40 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Badge
          variant={packetManifest.readiness === "failed" ? "destructive" : "outline"}
          className={
            packetManifest.readiness === "ready"
              ? "border-emerald-200 text-emerald-700"
              : packetManifest.readiness === "stale"
                ? "border-amber-200 text-amber-800"
                : ""
          }
        >
          {packetManifest.readinessLabel}
        </Badge>
        <span className="text-xs text-muted-foreground">Survey documentation packet manifest</span>
      </div>
      <p className="text-sm text-muted-foreground">{packetManifest.readinessDetail}</p>
      <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
        <div>
          <dt className="font-medium text-foreground">Facility scope</dt>
          <dd className="text-muted-foreground">{packetManifest.facilityScopeLabel}</dd>
        </div>
        <div>
          <dt className="font-medium text-foreground">Checksum</dt>
          <dd className="text-muted-foreground">{packetManifest.checksumLabel}</dd>
        </div>
        <div>
          <dt className="font-medium text-foreground">Packet size</dt>
          <dd className="text-muted-foreground">{packetManifest.sizeLabel}</dd>
        </div>
        <div>
          <dt className="font-medium text-foreground">Attempts</dt>
          <dd className="text-muted-foreground">{packetManifest.attemptsLabel}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="font-medium text-foreground">Correlation ID</dt>
          <dd className="break-all text-muted-foreground">{packetManifest.correlationId}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="font-medium text-foreground">Storage</dt>
          <dd className="break-all text-muted-foreground">{packetManifest.storageLabel}</dd>
        </div>
      </dl>
      {packetManifest.errorDetail && (
        <p className="mt-2 text-xs text-destructive">{packetManifest.errorDetail}</p>
      )}
      <p className="mt-3 text-xs text-muted-foreground">{packetManifest.accessControlNote}</p>
      <p className="mt-1 text-xs text-muted-foreground">{packetManifest.auditTrailNote}</p>

      <div className="mt-4 space-y-3 border-t pt-3">
        <p className="text-sm font-medium">Selected evidence for this survey packet</p>
        <p className="text-xs text-muted-foreground">
          Add binder export or notes, assemble a selection manifest, then package a downloadable zip.
          Prefer the citation field (for example 2800.64) for entrance-conference order; labels still
          parse as a fallback. Issue a time-limited surveyor guest link for that package only.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={addPacketItem.isPending}
            onClick={() => {
              void addPacketItem
                .mutateAsync({
                  sourceType: "binder_export",
                  label: "Pinned compliance binder",
                  sourceId: pinnedBinderJobId,
                  facilityId,
                  surveyDaySessionId: sessionId,
                  binderExportJobId: pinnedBinderJobId,
                })
                .catch((e: Error) => {
                  toast({ title: "Could not add binder", description: e.message, variant: "destructive" });
                });
            }}
          >
            Include binder
          </Button>
          <Input
            className="max-w-[9rem]"
            placeholder="Citation e.g. 2800.64"
            value={packetCitation}
            onChange={(e) => setPacketCitation(e.target.value)}
            aria-label="Regulation citation"
          />
          <Input
            className="max-w-xs"
            placeholder="Note label"
            value={packetNote}
            onChange={(e) => setPacketNote(e.target.value)}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={packetNote.trim().length < 2 || addPacketItem.isPending}
            onClick={() => {
              const citation = packetCitation.trim() || extractSurveyEvidencePacketCitation(packetNote.trim()) || null;
              void addPacketItem
                .mutateAsync({
                  sourceType: "note",
                  label: packetNote.trim(),
                  facilityId,
                  surveyDaySessionId: sessionId,
                  binderExportJobId: pinnedBinderJobId,
                  citationRef: citation,
                })
                .then(() => {
                  setPacketNote("");
                  setPacketCitation("");
                })
                .catch((e: Error) => {
                  toast({ title: "Could not add note", description: e.message, variant: "destructive" });
                });
            }}
          >
            Add note
          </Button>
          <Button
            size="sm"
            disabled={assemblePacket.isPending || (packetItems.data?.length ?? 0) === 0}
            onClick={() => {
              void assemblePacket
                .mutateAsync({
                  surveyDaySessionId: sessionId,
                  binderExportJobId: pinnedBinderJobId,
                })
                .then((manifest) => {
                  setAssembledManifest(manifest);
                  toast({ title: "Packet manifest assembled" });
                })
                .catch((e: Error) => {
                  toast({ title: "Assemble failed", description: e.message, variant: "destructive" });
                });
            }}
          >
            Assemble packet manifest
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={packagePacket.isPending || (packetItems.data?.length ?? 0) === 0}
            onClick={() => {
              void packagePacket
                .mutateAsync({
                  surveyDaySessionId: sessionId,
                  binderExportJobId: pinnedBinderJobId,
                  facilityId,
                })
                .then((result) => {
                  toast({
                    title: "Survey packet packaged",
                    description: `${result.itemCount} item(s) · ${(result.byteSize / 1024).toFixed(0)} KB`,
                  });
                  if (result.downloadUrl) window.open(result.downloadUrl, "_blank", "noopener");
                })
                .catch((e: Error) => {
                  toast({ title: "Package failed", description: e.message, variant: "destructive" });
                });
            }}
          >
            Package zip
          </Button>
        </div>
        {latestExport && (
          <div className="space-y-2 rounded border bg-background p-2 text-xs">
            <p className="text-sm font-medium">Latest package</p>
            <p className="text-muted-foreground">
              {new Date(latestExport.created_at).toLocaleString()} · {latestExport.item_count} items ·{" "}
              {latestExport.content_sha256.slice(0, 12)}…
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                className="h-8 max-w-xs"
                value={guestLabel}
                onChange={(e) => setGuestLabel(e.target.value)}
                placeholder="Guest label"
              />
              <Button
                size="sm"
                variant="outline"
                disabled={issueGuest.isPending || guestLabel.trim().length < 2}
                onClick={() => {
                  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
                  void issueGuest
                    .mutateAsync({
                      packetExportId: latestExport.id,
                      guestLabel: guestLabel.trim(),
                      expiresAt: expires,
                    })
                    .then((grant) => {
                      setLastGuestToken(grant.token);
                      toast({
                        title: "Guest grant issued",
                        description: "Copy the token now — it is shown once.",
                      });
                    })
                    .catch((e: Error) => {
                      toast({ title: "Guest grant failed", description: e.message, variant: "destructive" });
                    });
                }}
              >
                Issue surveyor guest link
              </Button>
            </div>
            {lastGuestToken && (
              <p className="break-all rounded bg-amber-50 p-2 font-mono text-[11px] text-amber-800">
                Token (copy now): {lastGuestToken}
              </p>
            )}
            <GuestGrantList
              packetExportId={latestExport.id}
              revoking={revokingGrantId}
              reason={revokeReason}
              pending={revokeGuest.isPending}
              onStartRevoke={(id) => { setRevokingGrantId(id); setRevokeReason(""); }}
              onCancelRevoke={() => setRevokingGrantId(null)}
              onReasonChange={setRevokeReason}
              onConfirmRevoke={(id) => {
                void revokeGuest
                  .mutateAsync({ grantId: id, reason: revokeReason.trim() })
                  .then(() => {
                    setRevokingGrantId(null);
                    setRevokeReason("");
                    toast({ title: "Guest access revoked", description: "The link stops working immediately." });
                  })
                  .catch((e: Error) => {
                    toast({ title: "Could not revoke access", description: e.message, variant: "destructive" });
                  });
              }}
            />
          </div>
        )}
        <ul className="space-y-1 text-sm">
          {(packetItems.data ?? []).map((item) => {
            const citation = item.citation_ref ?? extractSurveyEvidencePacketCitation(item.label);
            return (
              <li key={item.id} className="flex items-center justify-between gap-2 rounded border px-2 py-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground">{item.source_type}</span>
                  {citation && <Badge variant="outline" className="text-[11px]">{citation}</Badge>}
                  <span>{item.label}</span>
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={removePacketItem.isPending}
                  onClick={() => {
                    void removePacketItem.mutateAsync(item.id).catch((e: Error) => {
                      toast({ title: "Remove failed", description: e.message, variant: "destructive" });
                    });
                  }}
                >
                  Remove
                </Button>
              </li>
            );
          })}
        </ul>
        {assembledManifest && (
          <pre className="max-h-40 overflow-auto rounded bg-muted/40 p-2 text-xs">
            {JSON.stringify(assembledManifest, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}
