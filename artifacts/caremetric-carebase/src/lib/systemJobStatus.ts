// SQL cron publishes connection transitions before execution starts. They still
// represent an in-flight job and must prevent another manual dispatch.
export function isSystemJobActive(status: string): boolean {
  return ["queued", "starting", "connecting", "sending", "running"].includes(status);
}
