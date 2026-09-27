import { supabase } from "@/lib/supabase";
import { hasDefinitivePostgresWriteRejection } from "./postgresWriteOutcome";

const BUCKET = "org-branding";
const EXTENSIONS: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/svg+xml": "svg" };
const message = (error: unknown) => error && typeof error === "object" && "message" in error
  ? String(error.message) : "Could not save the organization logo";

function ownedPath(path: string, organizationId: string): boolean {
  return path.startsWith(`${organizationId}/`) && !/[\\%?#]/.test(path)
    && path.split("/").every(segment => segment !== "" && segment !== "." && segment !== "..");
}

/** Publish new bytes only after the settings pointer is saved; never overwrite the live object. */
export async function replaceOrganizationLogo({ file, organizationId, previousPath, savePointer }: {
  file: File;
  organizationId: string;
  previousPath: string | null;
  savePointer: (path: string) => Promise<unknown>;
}): Promise<{ path: string; cleanupWarning: string | null }> {
  const extension = EXTENSIONS[file.type];
  if (!extension) throw new Error("Choose a PNG, JPG, or SVG image.");
  const path = `${organizationId}/logo-${crypto.randomUUID()}.${extension}`;
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file);
  if (uploadError) throw uploadError;
  try {
    await savePointer(path);
  } catch (saveError) {
    // A lost response may have committed the pointer. Read back before deleting staged bytes.
    const { data, error } = await supabase.from("organization_settings").select("branding_logo_path")
      .eq("organization_id", organizationId).maybeSingle();
    if (error) throw new Error(`${message(saveError)}. Could not confirm which logo is saved; the uploaded file was retained. Refresh settings before trying again.`);
    if (data?.branding_logo_path !== path) {
      // An old/empty read can finish before an in-flight write commits. Only an explicit
      // statement rejection proves the staged object cannot become the live logo later.
      if (!hasDefinitivePostgresWriteRejection(saveError)) throw new Error(`${message(saveError)}. Could not confirm which logo is saved; the uploaded file was retained. Refresh settings before trying again.`);
      const { error: cleanupError } = await supabase.storage.from(BUCKET).remove([path]);
      if (cleanupError) throw new Error(`${message(saveError)}. Uploaded-file cleanup also failed: ${cleanupError.message}`);
      throw saveError;
    }
  }
  let cleanupWarning: string | null = null;
  if (previousPath && previousPath !== path && ownedPath(previousPath, organizationId)) {
    try {
      const { error } = await supabase.storage.from(BUCKET).remove([previousPath]);
      if (error) throw error;
    } catch (error) {
      cleanupWarning = `The new logo is saved, but the previous file could not be removed: ${message(error)}`;
    }
  }
  return { path, cleanupWarning };
}
