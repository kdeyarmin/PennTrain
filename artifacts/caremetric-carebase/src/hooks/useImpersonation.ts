import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { queryClient } from "@/lib/queryClient";

// Exported so useSignOut() (auth.tsx) can clear a stale record on every sign-out -- otherwise a
// regular "Log out" during impersonation leaves the admin's origin tokens sitting in
// sessionStorage, reusable by whoever uses that browser tab next (see the P1 fix this comment
// documents: sign-out must always clear this, impersonating or not).
export const STORAGE_KEY = "cmtrain.impersonation";
export const CHANGE_EVENT = "cmtrain:impersonation-change";

export interface ImpersonationTarget {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  organizationId: string | null;
}

interface ImpersonationRecord {
  originSession: { access_token: string; refresh_token: string };
  target: ImpersonationTarget;
  impersonationId?: string;
  contextSecret?: string;
  startedAt: string;
}

function readImpersonationRecord(): ImpersonationRecord | null {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ImpersonationRecord;
  } catch {
    return null;
  }
}

export function useImpersonationStatus() {
  const [record, setRecord] = useState<ImpersonationRecord | null>(() => readImpersonationRecord());

  useEffect(() => {
    const onChange = () => setRecord(readImpersonationRecord());
    window.addEventListener(CHANGE_EVENT, onChange);
    return () => window.removeEventListener(CHANGE_EVENT, onChange);
  }, []);

  return {
    isImpersonating: !!record,
    target: record?.target ?? null,
    startedAt: record?.startedAt ?? null,
  };
}

export function useStartImpersonation() {
  return useMutation({
    mutationFn: async (vars: { targetUserId: string; reason: string }) => {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) throw new Error("No active session");

      const { data, error } = await supabase.functions.invoke("impersonate-user", {
        body: { action: "start", target_user_id: vars.targetUserId, reason: vars.reason },
      });
      if (error) throw error;
      if (!data?.token_hash || !data?.target?.id || !data?.impersonation_id || !data?.context_secret) {
        throw new Error("The impersonation service returned an incomplete session response");
      }

      const record: ImpersonationRecord = {
        originSession: {
          access_token: sessionData.session.access_token,
          refresh_token: sessionData.session.refresh_token,
        },
        target: data.target,
        impersonationId: data.impersonation_id,
        contextSecret: data.context_secret,
        startedAt: new Date().toISOString(),
      };
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(record));

      // Swaps the live session to the target user via their one-time magic-link token.
      const { error: otpError } = await supabase.auth.verifyOtp({ token_hash: data.token_hash, type: "magiclink" });
      if (otpError) {
        // The origin tokens are persisted before the swap so they cannot be lost if verifyOtp
        // succeeds. If the swap fails, remove that provisional record or a refresh will falsely
        // present the still-admin session as an active impersonation session.
        sessionStorage.removeItem(STORAGE_KEY);
        throw otpError;
      }

      const { error: bindError } = await supabase.functions.invoke("impersonate-user", {
        body: {
          action: "bind",
          impersonation_id: record.impersonationId,
          context_secret: record.contextSecret,
        },
      });
      if (bindError) {
        await supabase.auth.signOut({ scope: "local" });
        await supabase.auth.setSession(record.originSession);
        sessionStorage.removeItem(STORAGE_KEY);
        throw new Error(`The impersonated session could not be bounded: ${bindError.message}`);
      }

      window.dispatchEvent(new Event(CHANGE_EVENT));
      // Full clear, not just ["profile"] -- queries with keys unscoped by user/org (e.g.
      // useListOrganizations()'s ["organizations"], used on /app/reports) would otherwise keep
      // showing platform_admin-visible cached data after swapping into a lower-privileged
      // session.
      queryClient.clear();
      return data.target as ImpersonationTarget;
    },
  });
}

export function useStopImpersonation() {
  return useMutation({
    mutationFn: async () => {
      const record = readImpersonationRecord();
      if (!record) return null;

      const { originSession, target } = record;
      if (!record.impersonationId || !record.contextSecret) {
        // Sessions started before the bounded-context rollout have no server context row. Revoke
        // that target Auth session directly before restoring the saved administrator session.
        const { error: legacyRevokeError } = await supabase.auth.signOut({ scope: "local" });
        if (legacyRevokeError) throw legacyRevokeError;
        const { error: legacyRestoreError } = await supabase.auth.setSession(originSession);
        if (legacyRestoreError) throw legacyRestoreError;
        sessionStorage.removeItem(STORAGE_KEY);
        window.dispatchEvent(new Event(CHANGE_EVENT));
        queryClient.clear();
        return target;
      }
      // End while the target JWT is still active. The service verifies that this is the exact
      // bound Auth session and revokes its refresh session before the admin session is restored.
      const { error: endError } = await supabase.functions.invoke("impersonate-user", {
        body: {
          action: "end",
          impersonation_id: record.impersonationId,
          context_secret: record.contextSecret,
        },
      });
      if (endError) throw endError;

      const { error } = await supabase.auth.setSession({
        access_token: originSession.access_token,
        refresh_token: originSession.refresh_token,
      });
      if (error) {
        sessionStorage.removeItem(STORAGE_KEY);
        throw error;
      }

      sessionStorage.removeItem(STORAGE_KEY);
      window.dispatchEvent(new Event(CHANGE_EVENT));
      // Full clear, not just ["profile"] -- same cross-role cache-bleed risk as useStartImpersonation.
      queryClient.clear();
      return target;
    },
  });
}
