import { useQuery } from "@tanstack/react-query";
import { getMfaStatus, mfaStatusIsVerified } from "@/lib/mfaSecurity";

/**
 * Whether this session belongs to an account that verifies by text message and has not entered a
 * code yet. Such a session reads nothing until it does (`current_session_unlocked()` gates
 * `current_org_id()` and every tenant read), so callers ask only once a read has already failed.
 * `get_my_mfa_status` itself is not gated.
 */
export function useSessionNeedsSmsVerification(enabled: boolean, userId: string | undefined) {
  const active = enabled && !!userId;
  const status = useQuery({
    queryKey: ["sms-session-gate", userId],
    queryFn: getMfaStatus,
    enabled: active,
    staleTime: 0,
    retry: false,
  });
  return {
    isLoading: active && status.isLoading,
    needsSms: active && !!status.data && status.data.smsRequired && !mfaStatusIsVerified(status.data),
  };
}
