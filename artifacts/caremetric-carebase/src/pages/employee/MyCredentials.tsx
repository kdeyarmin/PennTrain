import { useAuth } from "@/lib/auth";
import { useGetEmployeeByProfileId } from "@/hooks/useEmployees";
import { useListEmployeeCredentials, type EmployeeCredential } from "@/hooks/useEmployeeCredentials";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { QueryError } from "@/components/QueryState";
import { formatDateForDisplay } from "@/lib/dateUtils";
import { ShieldCheck } from "lucide-react";

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
  const { data: employee, isLoading: employeeLoading } = useGetEmployeeByProfileId(user?.id);
  // Gate on a resolved employee id -- see useListEmployeeCredentials' own comment on why
  // `enabled`, not just the filter, is required to avoid an unscoped fetch-then-refetch.
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

  const isLoading = employeeLoading || credentialsLoading;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">My Credentials</h1>
        <p className="text-muted-foreground">Your background clearances, licensure, and health screening records on file. Contact your facility manager to update or correct any of these.</p>
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
                <div key={c.id} className="flex items-center justify-between p-3 rounded-lg border">
                  <div>
                    <p className="font-medium text-sm">{credentialTitle(c)}</p>
                    <p className="text-xs text-muted-foreground">
                      {c.expiration_date ? `Expires ${formatDateForDisplay(c.expiration_date)}` : "No expiration on file"}
                      {c.issuing_authority ? ` · ${c.issuing_authority}` : ""}
                    </p>
                  </div>
                  <StatusBadge status={c.status} type="training" />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
