import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AlertTriangle, BedDouble, Building2, CalendarDays, Pencil, ShieldAlert } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/QueryState";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { formatDateOnly } from "@/lib/residentCompliance";
import {
  careHeaderFields, hospitalStateLabel, hospitalStateTone, isCareProfileStale,
  residentDisplayName, residentInitials,
  type CareHeaderTone, type ResidentCareHeader as ResidentCareHeaderData,
} from "@/lib/residentCareHeader";
import { useResidentCareHeader } from "@/hooks/useResidentCareHeader";
import type { ResidentDocument } from "@/hooks/useResidentDocuments";
import { EditResidentCareProfileDialog } from "@/components/residents/EditResidentCareProfileDialog";

const TONE_CLASS: Record<CareHeaderTone, string> = {
  neutral: "border-border",
  attention: "border-amber-500/60 bg-amber-500/5",
  critical: "border-destructive/60 bg-destructive/5",
};

const TONE_TEXT: Record<CareHeaderTone, string> = {
  neutral: "",
  attention: "text-amber-700 dark:text-amber-500",
  critical: "text-destructive",
};

/**
 * Resolves the resident photo to a short-lived signed URL. Reading a resident photo is a PHI access,
 * so it goes through the same logged path as every other resident document -- one logged read per
 * view is the correct audit semantic, not overhead to optimize away. Falls back to initials
 * silently: a broken image must never blank out the header.
 */
function useResidentPhotoUrl(photoDocument?: ResidentDocument) {
  const { user } = useAuth();
  return useQuery({
    // Identity-scoped so a role/org/facility change forces a fresh sign instead of resolving a
    // URL cached from before the change -- see useResidentPhotoUrls in useResidentPhotos.ts. All
    // four identity fields belong in the key: a facility-only transfer changes none of the other three.
    queryKey: [
      "resident-photo-url", photoDocument?.id, user?.id, user?.organizationId, user?.role,
      user?.facilityId,
    ],
    enabled: Boolean(photoDocument),
    // Signed URL lives 60s; refetch just inside that so an open page never shows a dead link.
    staleTime: 45_000,
    retry: false,
    queryFn: async () => {
      const doc = photoDocument!;
      const { error: logError } = await supabase.rpc("log_document_access", {
        p_document_table: "resident_documents",
        p_document_id: doc.id,
      });
      if (logError) throw logError;
      const { data, error } = await supabase.storage.from(doc.storage_bucket).createSignedUrl(doc.storage_path, 60);
      if (error) throw error;
      return data.signedUrl;
    },
  });
}

function HeaderField({ label, value, tone, detail }: { label: string; value: string; tone: CareHeaderTone; detail?: string }) {
  return (
    <div className={`rounded-md border px-2.5 py-1.5 ${TONE_CLASS[tone]}`}>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`text-sm font-medium leading-tight ${TONE_TEXT[tone]}`}>{value}</p>
      {detail ? <p className="mt-0.5 text-[11px] leading-tight text-muted-foreground">{detail}</p> : null}
    </div>
  );
}

export function ResidentCareHeaderPanel({
  residentId,
  documents,
  canManage,
  actions,
}: {
  residentId: string;
  documents: ResidentDocument[];
  canManage: boolean;
  actions?: React.ReactNode;
}) {
  const header = useResidentCareHeader(residentId);
  const [editing, setEditing] = useState(false);
  const data = header.data;
  const photoDocument = data?.resident.photoDocumentId
    ? documents.find((doc) => doc.id === data.resident.photoDocumentId)
    : undefined;
  const photo = useResidentPhotoUrl(photoDocument);

  if (header.isError) {
    return <QueryError what="the resident header" error={header.error} onRetry={() => void header.refetch()} />;
  }
  if (header.isLoading || !data) {
    return <Skeleton className="h-44 w-full" />;
  }

  return (
    <>
      <div className="sticky top-0 z-20 -mx-2 border-b bg-background/95 px-2 pb-3 pt-2 backdrop-blur supports-[backdrop-filter]:bg-background/80 print:static print:border-0 print:bg-transparent">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <Avatar className="h-14 w-14 rounded-lg">
              {photo.data ? <AvatarImage src={photo.data} alt="" /> : null}
              <AvatarFallback className="rounded-lg bg-primary/10 text-primary">
                {residentInitials(data.resident)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-bold">{residentDisplayName(data.resident)}</h1>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Building2 className="h-3.5 w-3.5" />
                  {data.facility?.name ?? "Facility not available"}
                </span>
                <span className="inline-flex items-center gap-1">
                  <BedDouble className="h-3.5 w-3.5" />
                  {data.resident.room ? `Room ${data.resident.room}` : "No room assigned"}
                </span>
                <span className="inline-flex items-center gap-1">
                  <CalendarDays className="h-3.5 w-3.5" />
                  Admitted {formatDateOnly(data.resident.admissionDate)}
                </span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <Badge variant={data.resident.status === "active" ? "secondary" : "outline"}>
                  {data.resident.status === "active" ? "Active" : "Discharged"}
                </Badge>
                <Badge
                  variant="outline"
                  className={hospitalStateTone(data.hospital.state) === "critical"
                    ? "border-destructive text-destructive"
                    : hospitalStateTone(data.hospital.state) === "attention"
                      ? "border-amber-500 text-amber-700 dark:text-amber-500"
                      : undefined}
                >
                  {hospitalStateLabel(data.hospital.state)}
                  {data.hospital.destination ? ` · ${data.hospital.destination}` : ""}
                </Badge>
                {data.resident.hospice ? <Badge variant="outline">Hospice</Badge> : null}
                {data.resident.sdcu ? <Badge variant="outline">SDCU</Badge> : null}
                <Badge variant="outline">
                  {data.lastAssessment
                    ? `Last assessment ${formatDateOnly(data.lastAssessment.completedOn)}`
                    : "No assessment on file"}
                </Badge>
                <Badge variant="outline">
                  {data.supportPlan
                    ? `Support plan v${data.supportPlan.versionNumber} · ${data.supportPlan.state.replace(/_/g, " ")}`
                    : "No support plan"}
                </Badge>
              </div>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2 print:hidden">
            {canManage && (
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                <Pencil className="mr-2 h-3.5 w-3.5" /> Edit care header
              </Button>
            )}
            {actions}
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {careHeaderFields(data).map((field) => (
            <HeaderField key={field.key} label={field.label} value={field.value} tone={field.tone} detail={field.detail} />
          ))}
        </div>

        {isCareProfileStale(data.care.asOf) && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-500">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            {data.care.asOf
              ? `Care header last reviewed ${formatDateOnly(data.care.asOf.slice(0, 10))} — confirm it still matches the resident.`
              : "Care header has never been reviewed — the values above are defaults, not assessed findings."}
          </p>
        )}

        {data.hospital.state === "out_at_hospital" && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-destructive">
            <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
            Out of facility since {new Date(data.hospital.since ?? "").toLocaleString()}
            {data.hospital.expectedReturnAt ? ` · expected back ${new Date(data.hospital.expectedReturnAt).toLocaleString()}` : ""}.
            <Link href={`/app/residents/${residentId}?tab=timeline`} className="underline">Open transfer record</Link>
          </p>
        )}
      </div>

      {canManage && (
        <EditResidentCareProfileDialog
          open={editing}
          onOpenChange={setEditing}
          residentId={residentId}
          current={data as ResidentCareHeaderData}
        />
      )}
    </>
  );
}
