import { useState } from "react";
<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/ComplianceBinder.tsx
import { useGenerateComplianceBinder } from "@/hooks/useComplianceBinder";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileArchive, Download, Loader2 } from "lucide-react";

export default function ComplianceBinder() {
  const { toast } = useToast();
  const [result, setResult] = useState<{ url: string; expiresIn: number } | null>(null);

  const { mutate: generateBinder, isPending } = useGenerateComplianceBinder();
=======
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { useAuth, type Role } from "@/lib/auth";
import { useListFacilities } from "@/hooks/useFacilities";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileArchive, Download, Loader2 } from "lucide-react";

interface GenerateBinderResult {
  url: string;
  expiresIn: number;
}

interface GenerateBinderResponse extends GenerateBinderResult {
  success?: boolean;
  path?: string;
  error?: string;
}

const FACILITY_ALL = "all";

// Matches generate-compliance-binder/index.ts's own role gate: facility_manager already gets an
// auto-derived facility scope from facility_assignments server-side (that file's `facilityScope`
// block), which this picker must never override, so facility_manager isn't offered the control at
// all. platform_admin doesn't reach this page (see REPORTS_VIEW_ROLES in App.tsx) -- the edge
// function's facility_id/facility_ids handling is org_admin/auditor only to match.
const FACILITY_PICKER_ROLES: Role[] = ["org_admin", "auditor"];

export default function ComplianceBinder() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [result, setResult] = useState<{ url: string; expiresIn: number } | null>(null);
  const [facilityId, setFacilityId] = useState<string>(FACILITY_ALL);

  const canScopeFacility = !!user && FACILITY_PICKER_ROLES.includes(user.role);
  const { data: facilities } = useListFacilities({}, canScopeFacility);

  // Calls the edge function directly rather than the shared useGenerateComplianceBinder hook in
  // useComplianceBinder.ts (also used by OrganizationDetail.tsx/InspectionReadiness.tsx for their
  // own org-wide-only binder/packet requests) since this page is the one caller that also needs to
  // pass an optional facility_id.
  const { mutate: generateBinder, isPending } = useMutation({
    mutationFn: async (payload: { facilityId?: string }): Promise<GenerateBinderResult> => {
      const body: { facility_id?: string } = {};
      if (payload.facilityId) body.facility_id = payload.facilityId;
      const { data, error } = await supabase.functions.invoke<GenerateBinderResponse>(
        "generate-compliance-binder",
        { body },
      );
      if (error) throw error;
      if (!data || data.success === false || !data.url) {
        throw new Error(data?.error ?? "Failed to generate compliance binder");
      }
      return { url: data.url, expiresIn: data.expiresIn };
    },
  });
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/ComplianceBinder.tsx

  const handleGenerate = () => {
    setResult(null);
    generateBinder(
<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/ComplianceBinder.tsx
      {},
      {
        onSuccess: (data) => {
          setResult({ url: data.url, expiresIn: data.expiresIn });
          toast({ title: "Compliance binder generated" });
=======
      { facilityId: canScopeFacility && facilityId !== FACILITY_ALL ? facilityId : undefined },
      {
        onSuccess: (data) => {
          setResult({ url: data.url, expiresIn: data.expiresIn });
          toast({ title: "Compliance binder generated", variant: "success" });
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/ComplianceBinder.tsx
        },
        onError: (err: Error) =>
          toast({ title: "Failed to generate binder", description: err.message, variant: "destructive" }),
      },
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Compliance Binder</h1>
        <p className="text-muted-foreground">Generate a compliance summary PDF for your organization.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileArchive className="h-5 w-5" />
            Full Facility Compliance Binder
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/ComplianceBinder.tsx
            Includes facility roster, staff training compliance status, overdue/due-soon training records and
            practicums, certificates issued, and open alerts -- generated fresh from current data each time.
          </p>
          <div className="flex items-center gap-3">
=======
            Generates a single PDF, rebuilt from live data every time, covering roughly a dozen compliance areas:
            a citation-weighted DHS readiness summary, the facility roster and resident census (including resident
            names and other PII), staff training and practicum compliance with overdue detail, certificates
            issued, open alerts, policy attestation status with a signed ESIGN/UETA audit trail (who signed what,
            when, and from where), employee credentials &amp; clearances, a reportable incidents log, inspection
            items/equipment with open corrective actions, and resident RASP compliance.
          </p>
          <p className="text-xs text-muted-foreground">
            Because it includes resident-identifying information, confirm who it's being shared with before
            handing a copy to a surveyor.
          </p>
          {canScopeFacility && (
            <div className="flex flex-col gap-1.5 max-w-xs">
              <label className="text-sm font-medium">Facility</label>
              <Select value={facilityId} onValueChange={setFacilityId}>
                <SelectTrigger className="w-64">
                  <SelectValue placeholder="All Facilities" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={FACILITY_ALL}>All Facilities (org-wide)</SelectItem>
                  {facilities?.map(f => (
                    <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Choose one facility for a site-specific binder instead of the full organization -- useful when
                only one site is being surveyed.
              </p>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/ComplianceBinder.tsx
            <Button onClick={handleGenerate} disabled={isPending}>
              {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileArchive className="mr-2 h-4 w-4" />}
              {isPending ? "Generating..." : "Generate Binder PDF"}
            </Button>
            {result && (
              <Button variant="outline" asChild>
                <a href={result.url} target="_blank" rel="noopener noreferrer">
                  <Download className="mr-2 h-4 w-4" />
                  Download PDF
                </a>
              </Button>
            )}
          </div>
          {result && (
            <p className="text-xs text-muted-foreground">
              This link expires in {Math.round(result.expiresIn / 60)} minutes. Generate a new binder if it expires.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
