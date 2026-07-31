/** CareBase pilot 2026 release keys and cohort identity. */
export const PILOT_COHORT_KEY = "carebase-pilot-2026";

export const PILOT_FEATURE_KEYS = [
  "notifications.expanded_delivery_types",
  "notifications.critical_multichannel",
  "screening.on_hire_exclusion",
  "learning.video_watch_gate",
] as const;

export type PilotFeatureKey = (typeof PILOT_FEATURE_KEYS)[number];

export const PILOT_FEATURE_LABELS: Record<PilotFeatureKey, string> = {
  "notifications.expanded_delivery_types": "Expanded notification delivery (email/SMS)",
  "notifications.critical_multichannel": "Critical multi-channel (email+SMS)",
  "screening.on_hire_exclusion": "On-hire exclusion screening",
  "learning.video_watch_gate": "Video minimum-watch gate",
};

export function isPilotFeatureKey(key: string): key is PilotFeatureKey {
  return (PILOT_FEATURE_KEYS as readonly string[]).includes(key);
}

/** Client-side effective-release estimate from loaded flag + membership rows. */
export function isReleaseActiveForOrg(args: {
  isEnabled: boolean;
  rolloutMode: string;
  expiresAt: string | null | undefined;
  orgEnrolled: boolean;
  killDisabled: boolean;
}): boolean {
  if (args.killDisabled) return false;
  if (!args.isEnabled) return false;
  if (args.expiresAt && new Date(args.expiresAt).getTime() <= Date.now()) return false;
  if (args.rolloutMode === "global") return true;
  if (args.rolloutMode === "cohort") return args.orgEnrolled;
  return false;
}
