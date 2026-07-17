import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import {
  cacheCourseBundle, getOfflineDeviceMetadata, getOfflineProgressCheckpoint, initializeOfflineDevice,
  listCachedCourseBundles, markOfflineProgressAttempt, queueOfflineProgress, readCachedCourseBundle,
  removeCachedCourseBundle, saveOfflineDeviceId, wipeOfflineLearning,
} from "@/lib/offlineCourseCache";

function rpc() { return supabase as any; }

export function useOfflineCourseLibrary() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["offline-course-library", user?.id],
    enabled: Boolean(user?.id && user.role === "employee" && typeof indexedDB !== "undefined"),
    queryFn: listCachedCourseBundles,
  });
}

export function useOfflineCourseBundle(assignmentId: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["offline-course-bundle", user?.id, assignmentId],
    enabled: Boolean(user?.id && user.organizationId && user.role === "employee" && assignmentId && typeof indexedDB !== "undefined"),
    queryFn: async () => {
      if (!user?.id || !user.organizationId || user.role !== "employee") throw new Error("Offline learning requires an employee account.");
      const record = (await listCachedCourseBundles()).find((item) => item.assignmentId === assignmentId);
      if (!record) throw new Error("This course has not been downloaded to this device.");
      if (new Date(record.expiresAt).getTime() <= Date.now()) throw new Error("This offline course copy has expired. Reconnect and download a fresh copy.");
      const bundle = await readCachedCourseBundle(record, { organizationId: user.organizationId, profileId: user.id, role: user.role });
      return { record, bundle };
    },
  });
}

export function useOfflineProgress(assignmentId: string) {
  return useQuery({
    queryKey: ["offline-course-progress", assignmentId],
    enabled: Boolean(assignmentId && typeof indexedDB !== "undefined"),
    queryFn: () => getOfflineProgressCheckpoint(assignmentId),
  });
}

export function useQueueOfflineProgress() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: queueOfflineProgress,
    onSuccess: (checkpoint) => queryClient.setQueryData(["offline-course-progress", checkpoint.assignmentId], checkpoint),
  });
}

export function useSyncOfflineProgress() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (assignmentId: string) => {
      const [metadata, checkpoint] = await Promise.all([
        getOfflineDeviceMetadata(),
        getOfflineProgressCheckpoint(assignmentId),
      ]);
      if (!metadata?.deviceId) throw new Error("This device is not registered for offline learning.");
      if (!checkpoint || checkpoint.percentComplete <= checkpoint.syncedPercent) return checkpoint;
      const { data, error } = await rpc().rpc("sync_offline_learning_action", {
        p_device_id: metadata.deviceId,
        p_assignment_id: assignmentId,
        p_idempotency_key: checkpoint.idempotencyKey,
        p_client_sequence: checkpoint.clientSequence,
        p_client_base_version: checkpoint.baseVersion,
        p_action_type: "progress",
        p_client_occurred_at: checkpoint.occurredAt,
        p_payload: { percentComplete: checkpoint.percentComplete },
      });
      if (error) throw error;
      const result = data as { outcome: string; serverVersion: number };
      return markOfflineProgressAttempt(assignmentId, result.outcome, result.serverVersion);
    },
    onSuccess: (checkpoint, assignmentId) => {
      queryClient.setQueryData(["offline-course-progress", assignmentId], checkpoint);
      queryClient.invalidateQueries({ queryKey: ["course_progress", assignmentId] });
    },
  });
}

export function useDownloadCourseForOffline() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ assignmentId, title }: { assignmentId: string; title: string }) => {
      if (!user?.id || !user.organizationId || user.role !== "employee") throw new Error("Offline learning requires an employee account.");
      const identity = { organizationId: user.organizationId, profileId: user.id, role: user.role };
      const initialized = await initializeOfflineDevice(identity);
      let deviceId = initialized.metadata.deviceId;
      if (!deviceId) {
        const { data, error } = await rpc().rpc("register_offline_learning_device", {
          p_device_public_key: initialized.metadata.publicMarker,
          p_device_fingerprint_sha256: initialized.metadata.fingerprintSha256,
        });
        if (error) throw error;
        deviceId = data as string;
        await saveOfflineDeviceId(deviceId);
      }
      const { data, error } = await rpc().rpc("prepare_offline_course_bundle", {
        p_device_id: deviceId, p_assignment_id: assignmentId,
        p_encrypted_content_key: `device-bound:${initialized.metadata.fingerprintSha256}`,
      });
      if (error) throw error;
      const bundle = data as any;
      const versionId = String(bundle.bundle?.version?.id ?? "");
      if (!versionId) throw new Error("The offline course version was not returned.");
      return cacheCourseBundle({ identity, assignmentId, title, versionId, manifestId: bundle.manifestId, expiresAt: bundle.expiresAt, bundle: bundle.bundle });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["offline-course-library"] }),
  });
}

export function useRemoveOfflineCourse() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: removeCachedCourseBundle,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["offline-course-library"] }),
  });
}

export function useWipeOfflineCourses() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const metadata = await getOfflineDeviceMetadata();
      if (metadata?.deviceId) {
        const { error } = await rpc().rpc("revoke_offline_learning_device", { p_device_id: metadata.deviceId });
        if (error) throw error;
      }
      await wipeOfflineLearning();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["offline-course-library"] }),
  });
}
