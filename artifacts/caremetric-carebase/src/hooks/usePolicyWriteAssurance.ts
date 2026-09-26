import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { canWritePolicyDocuments } from "@/lib/policyPermissions";
import { readPolicyWriteAssurance } from "@/lib/policyWriteAssurance";

export function usePolicyWriteAssurance() {
  const { user } = useAuth();
  const canManage = canWritePolicyDocuments(user?.role);
  const query = useQuery({
    queryKey: ["identity_assurance", "policy_document_admin", user?.id],
    queryFn: readPolicyWriteAssurance,
    enabled: canManage,
    staleTime: 0,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
  return { ...query, canManage, canWrite: canManage && !query.isError && query.data === true };
}
