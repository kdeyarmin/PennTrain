import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { usePolicyWriteAssurance } from "@/hooks/usePolicyWriteAssurance";
import { useRequestIdentityVerification } from "@/lib/identityReverification";

export function PolicyWriteAssurance() {
  const assurance = usePolicyWriteAssurance();
  const requestVerification = useRequestIdentityVerification();
  if (!assurance.canManage || assurance.canWrite) return null;
  return <div role="status" className="flex flex-wrap items-center gap-3 rounded-md border p-3 text-sm">
    <span>{assurance.isLoading ? "Checking permission to change policies…" : assurance.isError
      ? "Session verification is unavailable. Policy changes are disabled until it succeeds."
      : "Verify your identity to change policies. Your current page and form entries will stay open."}</span>
    {assurance.isError && <Button size="sm" variant="outline" onClick={() => void assurance.refetch()}>Retry verification</Button>}
    {!assurance.isLoading && !assurance.isError && (requestVerification
      ? <Button size="sm" onClick={requestVerification}>Verify identity</Button>
      : <Button size="sm" asChild><Link href="/account/security">Verify identity</Link></Button>)}
  </div>;
}
