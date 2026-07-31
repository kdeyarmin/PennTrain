import { useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useGetEmployeeByProfileId } from "@/hooks/useEmployees";
import { useListEmployeeCredentials, type EmployeeCredential } from "@/hooks/useEmployeeCredentials";
import { useUploadCredentialDocument } from "@/hooks/useCredentialDocuments";
import { useCreateCredentialRenewalSubmission } from "@/hooks/useCredentialRenewals";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { QueryError } from "@/components/QueryState";
import { Button } from "@/components/ui/button";
import { formatDateForDisplay } from "@/lib/dateUtils";
import { useToast } from "@/hooks/use-toast";
import { ShieldCheck, Upload } from "lucide-react";

const CREDENTIAL_TYPE_LABELS: Record<string, string> = {
  act34_criminal_history: "Act 34 Criminal History Clearance",
  act73_fbi_fingerprint: "Act 73 FBI Fingerprint Clearance",
  act33_child_abuse: "Act 33 Child Abuse Clearance",
  rn_license: "RN License",
  lpn_license: "LPN License",
  nurse_aide_registry: "Nurse Aide Registry Status",
  tb_screening: "TB Screening",
  immunization: "Immunization",
  i9_employment_eligibility: "I-9 Employment Eligibility",
  other: "Other",
};

function credentialTitle(c: EmployeeCredential): string {
  return c.credential_label || CREDENTIAL_TYPE_LABELS[c.credential_type] || c.credential_type.replace(/_/g, " ");
}

export default function MyCredentials() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: employee, isLoading: employeeLoading } = useGetEmployeeByProfileId(user?.id);
  const {
    data: credentials,
    isLoading: credentialsLoading,
    isError: credentialsError,
    error: credentialsErrorDetail,
    refetch: refetchCredentials,
  } = useListEmployeeCredentials(
    { employeeId: employee?.id },
    { enabled: !!employee?.id },
  );
  const uploadDoc = useUploadCredentialDocument();
  const createRenewal = useCreateCredentialRenewalSubmission();
  const [busyId, setBusyId] = useState<string | null>(null);
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const isLoading = employeeLoading || credentialsLoading;

  const handleRenew = async (credential: EmployeeCredential, file: File) => {
    if (!employee) return;
    const allowed = ["application/pdf", "image/jpeg", "image/png"];
    if (!allowed.includes(file.type) || file.size > 10 * 1024 * 1024) {
      toast({
        title: "Unsupported file",
        description: "Use PDF, JPEG, or PNG under 10 MB.",
        variant: "destructive",
      });
      return;
    }
    try {
      setBusyId(credential.id);
      const doc = await uploadDoc.mutateAsync({
        file,
        organizationId: credential.organization_id,
        facilityId: credential.facility_id,
        employeeId: employee.id,
        credentialId: credential.id,
        documentLabel: "Renewal submission",
      });
      await createRenewal.mutateAsync({
        employeeId: employee.id,
        credentialId: credential.id,
        credentialDocumentId: doc.id,
        credentialType: credential.credential_type,
      });
      toast({
        title: "Renewal submitted",
        description: "Your manager will review the uploaded document.",
      });
    } catch (e) {
      toast({
        title: "Could not submit renewal",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">My Credentials</h1>
        <p className="text-muted-foreground">
          Your background clearances, licensure, and health screening records on file.
          Upload a PDF or image to submit a renewal for manager review.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" /> Credentials ({credentials?.length ?? 0})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {credentialsError ? (
            <QueryError what="your credentials" error={credentialsErrorDetail} onRetry={() => refetchCredentials()} />
          ) : isLoading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => <div key={i} className="h-12 bg-muted animate-pulse rounded" />)}
            </div>
          ) : !credentials?.length ? (
            <p className="text-muted-foreground text-sm text-center py-8">No credentials on file yet.</p>
          ) : (
            <div className="space-y-2">
              {credentials.map((c) => (
                <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg border">
                  <div>
                    <p className="font-medium text-sm">{credentialTitle(c)}</p>
                    <p className="text-xs text-muted-foreground">
                      {c.expiration_date ? `Expires ${formatDateForDisplay(c.expiration_date)}` : "No expiration on file"}
                      {c.issuing_authority ? ` · ${c.issuing_authority}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={c.status} type="training" />
                    <input
                      ref={(el) => { fileRefs.current[c.id] = el; }}
                      type="file"
                      accept="application/pdf,image/jpeg,image/png"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (file) void handleRenew(c, file);
                      }}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyId === c.id}
                      onClick={() => fileRefs.current[c.id]?.click()}
                    >
                      <Upload className="mr-1.5 h-3.5 w-3.5" />
                      {busyId === c.id ? "Submitting…" : "Submit renewal"}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
