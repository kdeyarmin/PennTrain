/**
 * Supabase Storage accepts object keys made only of `\w / ! - . * ' ( ) space & $ @ = ; : + , ?`
 * and answers 400 "Invalid key" for anything else -- so a browser file named "CPR card #2.jpg",
 * "Résumé.pdf" or "Policy – v2.pdf" failed to upload before its metadata row was ever written,
 * with a raw storage error as the only explanation. Every upload path derives its key from the
 * browser name through this, keeping the original name for the `file_name` column.
 *
 * The same replacement useComplianceRequirements and useWorkOrders already applied inline.
 */
export function storageSafeFileName(fileName: string): string {
  const safe = fileName.trim().replace(/[^a-zA-Z0-9._-]/g, "_");
  return safe.length > 0 ? safe : "file";
}
