import TrainingEnrollmentReport from "@/components/training/TrainingEnrollmentReport";
import { QueryError } from "@/components/QueryState";
import { useTrainingReportOrganizations } from "@/hooks/useTrainingEnrollmentReport";
import { useViewingOrg } from "@/lib/viewingOrg";
import { useAuth } from "@/lib/auth";
import { Link, useLocation, useSearch } from "wouter";

export default function TrainingReports() {
  const { user } = useAuth();
  const { viewingOrgId, setViewingOrgId } = useViewingOrg();
  const organizations = useTrainingReportOrganizations(user?.role === "platform_admin");
  const search = useSearch();
  const [, navigate] = useLocation();
  const requestedOrg = new URLSearchParams(search).get("organizationId");
  if (user?.role !== "platform_admin") return <p role="alert">Platform administrator access is required.</p>;
  const selected = organizations.data?.find(organization => organization.id === (requestedOrg ?? viewingOrgId));
  return <div className="space-y-6">
    <div><h1 className="text-2xl font-bold">Facility training reports</h1><p className="text-muted-foreground">Review enrollment, completion, learner progress and issued certificates for a selected customer.</p></div>
    <Link href="/admin/organizations" className="underline">Set up a training facility or manage access</Link>
    {organizations.isError ? <QueryError what="training organizations" error={organizations.error} onRetry={() => void organizations.refetch()} /> : <label className="block max-w-lg text-sm">Report organization<select aria-label="Report organization" className="mt-1 h-10 w-full rounded-md border bg-background px-3" value={selected?.id || ""} onChange={event => { setViewingOrgId(event.target.value || null); navigate(`/admin/training-reports${event.target.value ? `?organizationId=${encodeURIComponent(event.target.value)}` : ""}`); }} disabled={organizations.isLoading}><option value="">Choose an organization</option>{organizations.data?.map(organization => <option key={organization.id} value={organization.id}>{organization.name}</option>)}</select></label>}
    {selected ? <TrainingEnrollmentReport organizationId={selected.id} /> : <p>Select the facility’s organization to run reports. Reports include only facilities and records accessible to your account.</p>}
  </div>;
}
